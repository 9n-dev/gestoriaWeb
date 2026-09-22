import { Prisma } from '@prisma/client';
import { prisma, tenantDb } from '@/lib/db';
import { addDays, toDateOnly, todayInMadrid } from '@/lib/dates';
import { validateTaxId } from '@/lib/tax-id';
import { recordAudit } from '@/modules/audit/service';
import { refreshChecklist } from '@/modules/checklists/sync';
import { checklistPeriodType } from '@/modules/checklists/sync';
import {
  extractionSchema,
  type DocumentExtractor,
  type Extraction,
  type ExtractorInput,
} from './types';

// Payrolls and bank statements have no supplier/number/VAT to extract.
const EXTRACTABLE = [
  'ISSUED_INVOICE',
  'RECEIVED_INVOICE',
  'RECEIPT',
  'RENT_RECEIPT',
  'OTHER',
] as const;
const EXTRACTABLE_MIME = ['application/pdf', 'image/jpeg', 'image/png'];

/** Business checks on top of the JSON shape. Each problem is fed back to the model on the retry. */
export function validateExtraction(extraction: Extraction, today = todayInMadrid()): string[] {
  const problems: string[] = [];
  if (extraction.date !== null) {
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(extraction.date) && !Number.isNaN(Date.parse(extraction.date));
    if (!valid) problems.push(`date "${extraction.date}" is not a valid ISO date (YYYY-MM-DD).`);
    else if (extraction.date > addDays(today, 1))
      problems.push(`date ${extraction.date} is in the future; check day/month order.`);
    else if (extraction.date < '2000-01-01')
      problems.push(`date ${extraction.date} is implausibly old.`);
  }
  const { taxBase, vatAmount, total } = extraction;
  if (taxBase !== null && vatAmount !== null && total !== null && total + 0.02 < taxBase) {
    problems.push(`total ${total} is lower than taxBase ${taxBase}; amounts look swapped.`);
  }
  if (
    [taxBase, vatAmount, total].some(
      (n) => n !== null && (!Number.isFinite(n) || Math.abs(n) > 99_999_999),
    )
  ) {
    problems.push('an amount is not a plausible number.');
  }
  const lines = extraction.vatBreakdown ?? [];
  const close = (a: number, b: number) => Math.abs(a - b) <= 0.05 + lines.length * 0.01;
  if (lines.length > 0) {
    const sum = (key: 'base' | 'vat') => lines.reduce((acc, line) => acc + line[key], 0);
    if (taxBase !== null && !close(sum('base'), taxBase))
      problems.push(
        `the bases of vatBreakdown add up to ${sum('base').toFixed(2)}, not to taxBase ${taxBase}.`,
      );
    if (vatAmount !== null && !close(sum('vat'), vatAmount))
      problems.push(
        `the VAT of vatBreakdown adds up to ${sum('vat').toFixed(2)}, not to vatAmount ${vatAmount}.`,
      );
    for (const line of lines) {
      if (line.rate < 0 || line.rate > 100)
        problems.push(`VAT rate ${line.rate} is not a percentage.`);
      else if (!close(line.vat, (line.base * line.rate) / 100))
        problems.push(`${line.vat} is not ${line.rate} % of ${line.base} in vatBreakdown.`);
    }
    if (new Set(lines.map((line) => line.rate)).size !== lines.length)
      problems.push('vatBreakdown repeats a rate; merge the lines of the same rate.');
  }
  if (extraction.confidence < 0 || extraction.confidence > 1)
    problems.push('confidence must be between 0 and 1.');
  if (extraction.date === null && extraction.total === null)
    problems.push('neither date nor total were found; look again.');
  return problems;
}

const quarterOf = (iso: string, type: 'MONTH' | 'QUARTER') => {
  const month = Number(iso.slice(5, 7));
  return {
    year: Number(iso.slice(0, 4)),
    type,
    ordinal: type === 'MONTH' ? month : Math.ceil(month / 3),
  };
};

/**
 * Extraction job of one document (§6.4). Asks the extractor, validates shape (Zod) and content,
 * retries once with the list of problems, and gives up to FAILED so a manager does it by hand.
 * Never overwrites what a manager already typed or confirmed. Token usage is logged per tenant.
 */
export async function extractDocument(
  tenantId: string,
  documentId: string,
  deps: { extractor: DocumentExtractor; getBytes(key: string): Promise<Uint8Array> },
): Promise<'done' | 'failed' | 'skipped'> {
  const db = tenantDb(tenantId);
  const document = await db.document.findFirst({
    where: { id: documentId, deletedAt: null, extractionStatus: { in: ['PENDING', 'PROCESSING'] } },
    include: { file: true, client: { select: { taxProfile: { select: { rules: true } } } } },
  });
  if (!document || document.file.status !== 'CLEAN') return 'skipped';

  const touchedByManager =
    document.extractionConfirmed || document.supplierTaxId !== null || document.total !== null;
  const extractable =
    (EXTRACTABLE as readonly string[]).includes(document.type) &&
    EXTRACTABLE_MIME.includes(document.file.mimeType) &&
    document.status !== 'DUPLICATE' &&
    document.status !== 'REJECTED';
  if (touchedByManager || !extractable) {
    await db.document.update({
      where: { id: documentId },
      data: { extractionStatus: 'NOT_APPLICABLE' },
    });
    return 'skipped';
  }

  await db.document.update({ where: { id: documentId }, data: { extractionStatus: 'PROCESSING' } });
  const input: ExtractorInput = {
    bytes: await deps.getBytes(document.file.storageKey),
    mimeType: document.file.mimeType as ExtractorInput['mimeType'],
  };

  let accepted: Extraction | null = null;
  let raw: unknown = null;
  let problems: string[] | undefined;
  for (let attempt = 1; attempt <= 2 && !accepted; attempt++) {
    const result = await deps.extractor.extract(input, problems);
    raw = result.raw;
    await db.aiUsageLog.create({ data: { tenantId, documentId, ...result.usage } });

    const parsed = extractionSchema.safeParse(result.extraction);
    problems = parsed.success
      ? validateExtraction(parsed.data)
      : ['the answer was not valid JSON for the requested schema.'];
    if (parsed.success && problems.length === 0) accepted = parsed.data;
  }

  if (!accepted) {
    await db.document.update({
      where: { id: documentId },
      data: {
        extractionStatus: 'FAILED',
        extractionRaw: { problems, raw } as Prisma.InputJsonValue,
      },
    });
    return 'failed';
  }

  // A NIF that does not pass the control letter is kept as read, but it costs confidence.
  const taxId = accepted.supplierTaxId ? validateTaxId(accepted.supplierTaxId) : null;
  const supplierTaxId = taxId?.valid ? taxId.normalized : accepted.supplierTaxId;
  const confidence =
    taxId && !taxId.valid ? Math.min(accepted.confidence, 0.5) : accepted.confidence;

  // §6.3: the period is suggested by the extracted date when nobody chose one.
  let periodId = document.periodId;
  if (!periodId && accepted.date) {
    const period = quarterOf(accepted.date, checklistPeriodType(document.client.taxProfile?.rules));
    periodId = (
      await prisma.period.upsert({
        where: { year_type_ordinal: period },
        create: period,
        update: {},
      })
    ).id;
  }

  // §6.3: second duplicate check, now that supplier, number and date are known.
  const twin =
    supplierTaxId && accepted.invoiceNumber && accepted.date
      ? await db.document.findFirst({
          where: {
            id: { not: documentId },
            clientId: document.clientId,
            deletedAt: null,
            status: { notIn: ['REJECTED', 'DUPLICATE'] },
            supplierTaxId,
            invoiceNumber: { equals: accepted.invoiceNumber, mode: 'insensitive' },
            invoiceDate: toDateOnly(accepted.date),
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
      : null;

  await db.document.update({
    where: { id: documentId },
    data: {
      extractionStatus: 'DONE',
      supplierName: accepted.supplierName,
      supplierTaxId,
      invoiceNumber: accepted.invoiceNumber,
      invoiceDate: accepted.date ? toDateOnly(accepted.date) : null,
      taxBase: accepted.taxBase,
      vatRate: accepted.vatRate,
      vatAmount: accepted.vatAmount,
      total: accepted.total,
      // One rate is what the scalars already say; only a real breakdown is worth keeping.
      vatBreakdown:
        accepted.vatBreakdown && accepted.vatBreakdown.length > 1
          ? (accepted.vatBreakdown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      currency: accepted.currency ?? 'EUR',
      confidence,
      extractionRaw: raw as Prisma.InputJsonValue,
      periodId,
      duplicateOfId: twin?.id ?? document.duplicateOfId,
    },
  });
  if (periodId !== document.periodId)
    await refreshChecklist(tenantId, document.clientId, [periodId]);
  await recordAudit({
    tenantId,
    action: 'document.extracted',
    entity: 'Document',
    entityId: documentId,
    diff: { confidence, possibleDuplicateOfId: twin?.id ?? null },
  });
  return 'done';
}

/** Tokens spent by the tenant in a month (§6.4: to bill the extra). */
export async function aiUsageOfMonth(tenantId: string, month = todayInMadrid().slice(0, 7)) {
  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  const usage = await tenantDb(tenantId).aiUsageLog.aggregate({
    where: { createdAt: { gte: from, lt: to } },
    _sum: { inputTokens: true, outputTokens: true },
    _count: true,
  });
  return {
    month,
    calls: usage._count,
    inputTokens: usage._sum.inputTokens ?? 0,
    outputTokens: usage._sum.outputTokens ?? 0,
  };
}
