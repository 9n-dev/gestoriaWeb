import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type InvoiceStatus, type PaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { prisma, tenantDb } from '@/lib/db';
import { addDays, isoDate, toDateOnly, todayInMadrid, type IsoDate } from '@/lib/dates';
import { AppError } from '@/lib/errors';
import { putObject } from '@/lib/storage/objects';
import { recordAudit } from '@/modules/audit/service';
import {
  assertCan,
  can,
  requireTenantId,
  scopeFor,
  type Resource,
  type SessionUser,
} from '@/modules/auth/permissions';
import { loadForStaff } from '@/modules/clients/service';
import { notifyClientUsers } from '@/modules/messaging/notifications';
import { hashChainCompliance, type InvoiceCompliance } from './compliance';
import { invoicePdf, type Party } from './pdf';
import { feeInputSchema, invoiceInputSchema, parseBillingSettings } from './schema';
import { computeTotals, type LineInput } from './totals';

const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  CARD: 'Tarjeta',
  SEPA_DEBIT: 'Domiciliación SEPA',
  BANK_TRANSFER: 'Transferencia bancaria',
  OTHER: 'Otro',
};

const invoiceSelect = {
  id: true,
  tenantId: true,
  clientId: true,
  fullNumber: true,
  status: true,
  billingMonth: true,
  issueDate: true,
  dueDate: true,
  paidAt: true,
  paymentMethod: true,
  subtotal: true,
  vatAmount: true,
  irpfAmount: true,
  total: true,
  rectifiesId: true,
  pdfFile: { select: { id: true } },
  lines: { orderBy: { sortOrder: 'asc' as const } },
  client: { select: { id: true, legalName: true, assignedManagerId: true, status: true } },
} satisfies Prisma.InvoiceSelect;
export type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>;

const notFound = () => new AppError('NOT_FOUND', 'No encontramos esa factura.');

export const invoiceResource = (invoice: InvoiceRow): Resource => ({
  tenantId: invoice.tenantId,
  clientId: invoice.clientId ?? undefined,
  assignedManagerId: invoice.client?.assignedManagerId,
  clientStatus: invoice.client?.status,
});

/** An invoice the user may read. Clients never see drafts. */
export async function getInvoice(user: SessionUser, id: string): Promise<InvoiceRow> {
  const invoice = await tenantDb(requireTenantId(user)).invoice.findFirst({
    where: { id },
    select: invoiceSelect,
  });
  const hidden = invoice?.status === 'DRAFT' && scopeFor(user, 'invoice.read') === 'own';
  if (!invoice || hidden || !can(user, 'invoice.read', invoiceResource(invoice))) throw notFound();
  return invoice;
}

export async function listInvoices(
  user: SessionUser,
  filters: { clientId?: string; status?: InvoiceStatus } = {},
): Promise<InvoiceRow[]> {
  assertCan(user, 'invoice.read');
  const scope = scopeFor(user, 'invoice.read');
  return tenantDb(requireTenantId(user)).invoice.findMany({
    where: {
      clientId: filters.clientId,
      status: filters.status ?? (scope === 'own' ? { not: 'DRAFT' } : undefined),
      client:
        scope === 'own'
          ? { id: { in: user.clientIds } }
          : scope === 'assigned'
            ? { assignedManagerId: user.id }
            : undefined,
    },
    select: invoiceSelect,
    orderBy: [{ issueDate: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
    take: 300,
  });
}

// ─────────────────────────── Recurring fees ───────────────────────────

export async function listFees(user: SessionUser, clientId: string) {
  assertCan(user, 'recurringFee.manage');
  const client = await loadForStaff(user, clientId);
  return tenantDb(client.tenantId).recurringFee.findMany({
    where: { clientId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function saveFee(
  user: SessionUser,
  clientId: string,
  input: z.input<typeof feeInputSchema>,
  id?: string,
) {
  assertCan(user, 'recurringFee.manage');
  const client = await loadForStaff(user, clientId);
  const { startsOn, endsOn, ...fee } = feeInputSchema.parse(input);
  const data = {
    ...fee,
    startsOn: toDateOnly(startsOn),
    endsOn: endsOn ? toDateOnly(endsOn) : null,
  };
  const db = tenantDb(client.tenantId);
  if (id) await db.recurringFee.updateMany({ where: { id, clientId }, data });
  else await db.recurringFee.create({ data: { tenantId: client.tenantId, clientId, ...data } });
  await recordAudit({
    tenantId: client.tenantId,
    actor: user,
    action: 'recurringFee.save',
    entity: 'Client',
    entityId: clientId,
    diff: fee,
  });
}

export async function setFeeActive(user: SessionUser, id: string, active: boolean): Promise<void> {
  assertCan(user, 'recurringFee.manage');
  const tenantId = requireTenantId(user);
  await tenantDb(tenantId).recurringFee.updateMany({ where: { id }, data: { active } });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'recurringFee.setActive',
    entity: 'RecurringFee',
    entityId: id,
    diff: { active },
  });
}

// ─────────────────────────── Drafting and issuing ───────────────────────────

async function createDraft(
  tenantId: string,
  input: {
    clientId: string;
    lines: LineInput[];
    paymentMethod: PaymentMethod;
    seriesCode: string;
    billingMonth?: string;
    rectifiesId?: string;
  },
): Promise<string> {
  const totals = computeTotals(input.lines);
  const db = tenantDb(tenantId);
  const series = await db.invoiceSeries.upsert({
    where: { tenantId_code: { tenantId, code: input.seriesCode } },
    create: { tenantId, code: input.seriesCode },
    update: {},
  });
  const invoice = await db.invoice.create({
    data: {
      tenantId,
      clientId: input.clientId,
      seriesId: series.id,
      billingMonth: input.billingMonth,
      rectifiesId: input.rectifiesId,
      paymentMethod: input.paymentMethod,
      subtotal: totals.subtotal,
      vatAmount: totals.vatAmount,
      irpfAmount: totals.irpfAmount,
      total: totals.total,
    },
  });
  await db.invoiceLine.createMany({
    data: totals.lines.map((line, sortOrder) => ({
      tenantId,
      invoiceId: invoice.id,
      sortOrder,
      ...line,
    })),
  });
  return invoice.id;
}

export async function createInvoice(
  user: SessionUser,
  input: z.input<typeof invoiceInputSchema>,
): Promise<string> {
  assertCan(user, 'invoice.manage');
  const tenantId = requireTenantId(user);
  const data = invoiceInputSchema.parse(input);
  await loadForStaff(user, data.clientId);
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { settings: true },
  });
  const id = await createDraft(tenantId, {
    ...data,
    seriesCode: parseBillingSettings(tenant.settings).seriesCode,
  });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'invoice.create',
    entity: 'Invoice',
    entityId: id,
  });
  return id;
}

const address = (p: {
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
}) =>
  [p.addressLine, [p.postalCode, p.city].filter(Boolean).join(' '), p.province]
    .filter(Boolean)
    .join(', ');

/**
 * Issues a draft: number, dates, frozen legal data, compliance seal and PDF.
 *
 * Numbering (§6.11) is gap-free and duplicate-free because the series row is locked with
 * SELECT … FOR UPDATE for the whole transaction: concurrent issuers queue up, each takes the next
 * number, and a rollback gives the number back. The hash chain is computed under the same lock, so
 * "previous invoice" is unambiguous.
 */
export async function issueInvoiceById(
  tenantId: string,
  invoiceId: string,
  options: { today?: IsoDate; compliance?: InvoiceCompliance } = {},
): Promise<InvoiceRow> {
  const today = options.today ?? todayInMadrid();
  const compliance = options.compliance ?? hashChainCompliance;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (!tenant.legalName || !tenant.taxId || !tenant.addressLine) {
    throw new AppError(
      'VALIDATION',
      'Completa la razón social, el NIF y la dirección de la gestoría (Ajustes → Gestoría) antes de emitir facturas.',
    );
  }
  const settings = parseBillingSettings(tenant.settings);

  const issued = await prisma.$transaction(
    async (tx) => {
      const draft = await tx.invoice.findFirst({
        where: { id: invoiceId, tenantId, status: 'DRAFT' },
        include: {
          lines: { orderBy: { sortOrder: 'asc' } },
          client: true,
          series: true,
          rectifies: { select: { fullNumber: true } },
        },
      });
      if (!draft?.client) throw new AppError('CONFLICT', 'Esta factura ya está emitida.');
      if (!draft.client.addressLine) {
        throw new AppError(
          'VALIDATION',
          `Falta la dirección de ${draft.client.legalName}: es obligatoria en la factura.`,
        );
      }

      const [series] = await tx.$queryRaw<Array<{ nextNumber: number }>>`
        SELECT "nextNumber" FROM "invoice_series" WHERE "id" = ${draft.seriesId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const number = series!.nextNumber;
      const previous = await tx.invoice.findFirst({
        where: { seriesId: draft.seriesId, number: { not: null } },
        orderBy: { number: 'desc' },
        select: { hash: true },
      });

      const fullNumber = `${draft.series.code}-${today.slice(0, 4)}-${String(number).padStart(5, '0')}`;
      const dueDate = addDays(today, settings.paymentDays);
      const issuer: Party = {
        name: tenant.legalName!,
        taxId: tenant.taxId!,
        address: address(tenant),
      };
      const recipient: Party = {
        name: draft.client.legalName,
        taxId: draft.client.taxId,
        address: address(draft.client),
      };
      const totals = computeTotals(
        draft.lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          vatRate: Number(line.vatRate),
          irpfRate: Number(line.irpfRate),
        })),
      );
      const seal = compliance.seal({
        issuerTaxId: issuer.taxId,
        fullNumber,
        issueDate: today,
        total: totals.total,
        vatAmount: totals.vatAmount,
        previousHash: previous?.hash ?? null,
      });

      const pdf = invoicePdf({
        fullNumber,
        issueDate: today,
        dueDate,
        rectifies: draft.rectifies?.fullNumber,
        issuer,
        recipient,
        totals,
        paymentMethod: PAYMENT_METHOD[draft.paymentMethod ?? 'BANK_TRANSFER'],
        ...seal,
      });
      const storageKey = `${tenantId}/invoices/${randomUUID()}.pdf`;
      await putObject(storageKey, pdf, 'application/pdf');
      const file = await tx.storedFile.create({
        data: {
          tenantId,
          kind: 'INVOICE_PDF',
          status: 'CLEAN', // generated by us from text: nothing to scan
          scannedAt: new Date(),
          storageKey,
          originalName: `factura-${fullNumber}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: pdf.length,
          sha256: createHash('sha256').update(pdf).digest('hex'),
        },
      });

      await tx.invoiceSeries.update({
        where: { id: draft.seriesId },
        data: { nextNumber: number + 1 },
      });
      return tx.invoice.update({
        where: { id: draft.id },
        data: {
          number,
          fullNumber,
          status: 'ISSUED',
          issueDate: toDateOnly(today),
          dueDate: toDateOnly(dueDate),
          issuerSnapshot: issuer,
          recipientSnapshot: recipient,
          previousHash: previous?.hash ?? null,
          hash: seal.hash,
          qrData: seal.qrData,
          pdfFileId: file.id,
        },
        select: invoiceSelect,
      });
    },
    { timeout: 20_000 },
  );

  await recordAudit({
    tenantId,
    action: 'invoice.issue',
    entity: 'Invoice',
    entityId: invoiceId,
    diff: { fullNumber: issued.fullNumber, total: Number(issued.total) },
  });
  if (issued.clientId) {
    await notifyClientUsers(tenantId, issued.clientId, {
      type: 'INVOICE_ISSUED',
      title: `Nueva factura ${issued.fullNumber}`,
      body: `Importe: ${Number(issued.total).toFixed(2).replace('.', ',')} €. Vence el ${isoDate(issued.dueDate!).split('-').reverse().join('/')}.`,
      link: '/facturas',
    });
  }
  return issued;
}

export async function issueInvoice(user: SessionUser, id: string): Promise<InvoiceRow> {
  assertCan(user, 'invoice.manage');
  const invoice = await getInvoice(user, id);
  return issueInvoiceById(invoice.tenantId, id);
}

/** Paid by hand (transfer, cash) or by a payment webhook. Clears the client's DELINQUENT state when nothing else is overdue. */
export async function markInvoicePaid(
  tenantId: string,
  invoiceId: string,
  method?: PaymentMethod,
): Promise<boolean> {
  const db = tenantDb(tenantId);
  const { count } = await db.invoice.updateMany({
    where: { id: invoiceId, status: { in: ['ISSUED', 'OVERDUE'] } },
    data: { status: 'PAID', paidAt: new Date(), ...(method ? { paymentMethod: method } : {}) },
  });
  if (count === 0) return false;

  const invoice = await db.invoice.findFirstOrThrow({
    where: { id: invoiceId },
    select: { clientId: true },
  });
  if (invoice.clientId) {
    const stillOverdue = await db.invoice.count({
      where: { clientId: invoice.clientId, status: 'OVERDUE' },
    });
    if (stillOverdue === 0) {
      await db.client.updateMany({
        where: { id: invoice.clientId, status: 'DELINQUENT' },
        data: { status: 'ACTIVE' },
      });
    }
  }
  await recordAudit({
    tenantId,
    action: 'invoice.paid',
    entity: 'Invoice',
    entityId: invoiceId,
    diff: { method: method ?? null },
  });
  return true;
}

export async function markPaid(
  user: SessionUser,
  id: string,
  method: PaymentMethod,
): Promise<void> {
  assertCan(user, 'invoice.manage');
  const invoice = await getInvoice(user, id);
  if (!(await markInvoicePaid(invoice.tenantId, id, method))) {
    throw new AppError('CONFLICT', 'Solo se pueden cobrar facturas emitidas.');
  }
}

/**
 * Drafts are simply deleted. An issued invoice is never edited or removed (it would leave a gap):
 * it is cancelled by issuing a rectifying invoice with the same lines in negative, in the "R" series.
 */
export async function cancelInvoice(user: SessionUser, id: string): Promise<void> {
  assertCan(user, 'invoice.manage');
  const invoice = await getInvoice(user, id);
  const db = tenantDb(invoice.tenantId);
  if (invoice.status === 'DRAFT') {
    await db.invoice.delete({ where: { id } });
  } else if (invoice.status === 'ISSUED' || invoice.status === 'OVERDUE') {
    const rectifying = await createDraft(invoice.tenantId, {
      clientId: invoice.clientId!,
      seriesCode: 'R',
      rectifiesId: id,
      paymentMethod: invoice.paymentMethod ?? 'BANK_TRANSFER',
      lines: invoice.lines.map((line) => ({
        description: `Rectificación de ${invoice.fullNumber}: ${line.description}`.slice(0, 300),
        quantity: Number(line.quantity),
        unitPrice: -Number(line.unitPrice),
        vatRate: Number(line.vatRate),
        irpfRate: Number(line.irpfRate),
      })),
    });
    await issueInvoiceById(invoice.tenantId, rectifying);
    await db.invoice.update({
      where: { id: rectifying },
      data: { status: 'PAID', paidAt: new Date() },
    });
    await db.invoice.update({ where: { id }, data: { status: 'CANCELLED' } });
  } else {
    throw new AppError('CONFLICT', 'Esta factura ya está cobrada o anulada.');
  }
  await recordAudit({
    tenantId: invoice.tenantId,
    actor: user,
    action: 'invoice.cancel',
    entity: 'Invoice',
    entityId: id,
  });
}

// ─────────────────────────── Scheduled work ───────────────────────────

/**
 * Day 1 of the month (§6.11): one invoice per client with active fees. Idempotent through the
 * unique key (tenantId, clientId, billingMonth); a tenant without legal data skips with no harm.
 */
export async function generateMonthlyInvoices(tenantId: string, today: IsoDate): Promise<number> {
  const month = today.slice(0, 7);
  const monthStart = toDateOnly(`${month}-01`);
  const db = tenantDb(tenantId);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (!tenant.legalName || !tenant.taxId || !tenant.addressLine) return 0;

  const fees = await db.recurringFee.findMany({
    where: {
      active: true,
      startsOn: { lte: toDateOnly(today) },
      OR: [{ endsOn: null }, { endsOn: { gte: monthStart } }],
      client: {
        deletedAt: null,
        status: { not: 'INACTIVE' },
        isSample: false,
        addressLine: { not: null },
      },
    },
    include: { client: { select: { preferredPaymentMethod: true } } },
    orderBy: { createdAt: 'asc' },
  });

  let issued = 0;
  for (const [clientId, clientFees] of Map.groupBy(fees, (fee) => fee.clientId)) {
    if (await db.invoice.findFirst({ where: { clientId, billingMonth: month } })) continue;
    const label = new Intl.DateTimeFormat('es-ES', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(monthStart);
    const draftId = await createDraft(tenantId, {
      clientId,
      billingMonth: month,
      seriesCode: parseBillingSettings(tenant.settings).seriesCode,
      paymentMethod: clientFees[0]!.client.preferredPaymentMethod ?? 'BANK_TRANSFER',
      lines: clientFees.map((fee) => ({
        description: `${fee.concept} · ${label}`,
        quantity: 1,
        unitPrice: Number(fee.amount),
        vatRate: Number(fee.vatRate),
        irpfRate: Number(fee.irpfRate),
      })),
    }).catch((error: unknown) => {
      // Another run created it in the meantime: the unique key did its job.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return null;
      throw error;
    });
    if (!draftId) continue;
    await issueInvoiceById(tenantId, draftId, { today });
    issued++;
  }
  return issued;
}

/**
 * Daily (§6.11): issued invoices past their due date become OVERDUE; reminders at 3, 10 and 20
 * days; at 30 days the client becomes DELINQUENT (uploads yes, downloads no). All configurable.
 */
export async function runDunning(
  tenantId: string,
  today: IsoDate,
): Promise<{ reminders: number; delinquent: number }> {
  const db = tenantDb(tenantId);
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { settings: true },
  });
  const settings = parseBillingSettings(tenant.settings);
  await db.invoice.updateMany({
    where: { status: 'ISSUED', dueDate: { lt: toDateOnly(today) } },
    data: { status: 'OVERDUE' },
  });

  const overdue = await db.invoice.findMany({
    where: { status: 'OVERDUE', clientId: { not: null } },
    select: { id: true, clientId: true, fullNumber: true, total: true, dueDate: true },
  });
  const result = { reminders: 0, delinquent: 0 };
  for (const invoice of overdue) {
    const daysLate = Math.round(
      (toDateOnly(today).getTime() - invoice.dueDate!.getTime()) / 86_400_000,
    );
    const step = settings.dunningDays.filter((days) => days <= daysLate).at(-1);
    if (step !== undefined) {
      const { count } = await db.reminderLog.createMany({
        data: [{ tenantId, kind: 'INVOICE_OVERDUE', entityId: invoice.id, step: String(step) }],
        skipDuplicates: true,
      });
      if (count === 1) {
        await notifyClientUsers(tenantId, invoice.clientId!, {
          type: 'INVOICE_OVERDUE',
          title: `La factura ${invoice.fullNumber} está pendiente de pago`,
          body: `Venció hace ${daysLate} días. Importe: ${Number(invoice.total).toFixed(2).replace('.', ',')} €. Puedes pagarla desde el portal.`,
          link: '/facturas',
        });
        result.reminders++;
      }
    }
    if (daysLate >= settings.delinquentAfterDays) {
      const { count } = await db.client.updateMany({
        where: { id: invoice.clientId!, status: 'ACTIVE' },
        data: { status: 'DELINQUENT' },
      });
      if (count === 1) {
        await recordAudit({
          tenantId,
          action: 'client.delinquent',
          entity: 'Client',
          entityId: invoice.clientId!,
          diff: { invoice: invoice.fullNumber, daysLate },
        });
        result.delinquent++;
      }
    }
  }
  return result;
}
