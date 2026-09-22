import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant } from '@tests/setup/factories';
import expected from '../../../../fixtures/invoices/expected.json';
import { getDocumentExtractor } from './index';
import { aiUsageOfMonth, extractDocument, validateExtraction } from './service';
import type { DocumentExtractor, Extraction } from './types';

const good: Extraction = {
  supplierName: 'Energía Levante, S.L.',
  supplierTaxId: 'b-96000112',
  invoiceNumber: 'EL-2026-071842',
  date: '2026-07-31',
  taxBase: 86.4,
  vatRate: 21,
  vatAmount: 18.14,
  total: 104.54,
  vatBreakdown: null,
  currency: 'EUR',
  confidence: 0.93,
};
const usage = { provider: 'test', model: 'scripted', inputTokens: 1200, outputTokens: 90 };
const scripted = (
  ...answers: Array<Extraction | null>
): DocumentExtractor & { corrections: Array<string[] | undefined> } => {
  const corrections: Array<string[] | undefined> = [];
  return {
    corrections,
    extract: async (_input, correction) => {
      corrections.push(correction);
      return { extraction: answers.shift() ?? null, raw: { n: corrections.length }, usage };
    },
  };
};

describe('validateExtraction', () => {
  it('accepts a coherent invoice and explains what is wrong with a bad one', () => {
    expect(validateExtraction(good, '2026-09-19')).toEqual([]);
    expect(validateExtraction({ ...good, date: '31/07/2026' }, '2026-09-19')[0]).toMatch(
      /not a valid ISO date/,
    );
    expect(validateExtraction({ ...good, date: '2026-12-07' }, '2026-09-19')[0]).toMatch(/future/);
    expect(validateExtraction({ ...good, total: 8.64 }, '2026-09-19')[0]).toMatch(
      /lower than taxBase/,
    );
    expect(validateExtraction({ ...good, date: null, total: null }, '2026-09-19')[0]).toMatch(
      /neither date nor total/,
    );
  });
});

describe('extractDocument', () => {
  let tenantId: string;
  let clientId: string;
  let n = 0;
  const getBytes = async () => new TextEncoder().encode('%PDF-1.4');

  const addDocument = async (data: Record<string, unknown> = {}) => {
    const file = await prisma.storedFile.create({
      data: {
        tenantId,
        kind: 'DOCUMENT',
        status: 'CLEAN',
        storageKey: `x-${++n}`,
        originalName: 'f.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 9,
      },
    });
    return prisma.document.create({
      data: { tenantId, clientId, fileId: file.id, type: 'RECEIVED_INVOICE', ...data },
    });
  };
  const reload = (id: string) =>
    prisma.document.findUniqueOrThrow({ where: { id }, include: { period: true } });

  beforeEach(async () => {
    await resetDb();
    tenantId = (await createTenant()).id;
    clientId = (await createClient(tenantId)).id;
  });

  it('stores the proposed fields with their confidence, normalizes the NIF, suggests the period and logs the cost', async () => {
    const document = await addDocument();
    expect(
      await extractDocument(tenantId, document.id, { extractor: scripted(good), getBytes }),
    ).toBe('done');

    const saved = await reload(document.id);
    expect(saved).toMatchObject({
      extractionStatus: 'DONE',
      supplierTaxId: 'B96000112',
      invoiceNumber: 'EL-2026-071842',
      confidence: 0.93,
      extractionConfirmed: false,
    });
    expect(Number(saved.total)).toBe(104.54);
    expect(saved.invoiceDate?.toISOString().slice(0, 10)).toBe('2026-07-31');
    expect(saved.period).toMatchObject({ year: 2026, type: 'QUARTER', ordinal: 3 });
    expect(await aiUsageOfMonth(tenantId)).toMatchObject({
      calls: 1,
      inputTokens: 1200,
      outputTokens: 90,
    });
  });

  it('retries once telling the model what was wrong, and succeeds', async () => {
    const extractor = scripted({ ...good, date: '31/07/2026' }, good);
    const document = await addDocument();
    expect(await extractDocument(tenantId, document.id, { extractor, getBytes })).toBe('done');
    expect(extractor.corrections[0]).toBeUndefined();
    expect(extractor.corrections[1]![0]).toMatch(/not a valid ISO date/);
    expect((await aiUsageOfMonth(tenantId)).calls).toBe(2); // both calls are billed
  });

  it('gives up after the second bad answer: FAILED, fields untouched, processed by hand', async () => {
    const document = await addDocument();
    expect(
      await extractDocument(tenantId, document.id, {
        extractor: scripted(null, { ...good, total: 1 }),
        getBytes,
      }),
    ).toBe('failed');
    expect(await reload(document.id)).toMatchObject({
      extractionStatus: 'FAILED',
      supplierTaxId: null,
      total: null,
    });
  });

  it('a provider error propagates, so the job is retried by the queue', async () => {
    const document = await addDocument();
    const extractor: DocumentExtractor = {
      extract: async () => Promise.reject(new Error('529 overloaded')),
    };
    await expect(extractDocument(tenantId, document.id, { extractor, getBytes })).rejects.toThrow(
      '529',
    );
    expect((await reload(document.id)).extractionStatus).toBe('PROCESSING'); // picked up again on retry
  });

  it('never overwrites what a manager typed, and skips what cannot be extracted', async () => {
    const typed = await addDocument({ supplierTaxId: '12345678Z', total: 10 });
    const payroll = await addDocument({ type: 'PAYROLL' });
    const duplicate = await addDocument({ status: 'DUPLICATE' });
    const extractor = scripted(good, good, good);
    for (const document of [typed, payroll, duplicate]) {
      expect(await extractDocument(tenantId, document.id, { extractor, getBytes })).toBe('skipped');
      expect((await reload(document.id)).extractionStatus).toBe('NOT_APPLICABLE');
    }
    expect(extractor.corrections).toHaveLength(0);
    expect((await reload(typed.id)).supplierTaxId).toBe('12345678Z');
  });

  it('keeps a period chosen by the client, and lowers confidence for a NIF that fails its control letter', async () => {
    const period = await prisma.period.create({
      data: { year: 2026, type: 'QUARTER', ordinal: 2 },
    });
    const document = await addDocument({ periodId: period.id });
    await extractDocument(tenantId, document.id, {
      extractor: scripted({ ...good, supplierTaxId: 'B96000113' }),
      getBytes,
    });
    const saved = await reload(document.id);
    expect(saved.period).toMatchObject({ ordinal: 2 });
    expect(saved).toMatchObject({ supplierTaxId: 'B96000113', confidence: 0.5 });
  });

  it('flags a possible duplicate once supplier, number and date are known (§6.3)', async () => {
    const first = await addDocument();
    const second = await addDocument();
    await extractDocument(tenantId, first.id, { extractor: scripted(good), getBytes });
    await extractDocument(tenantId, second.id, {
      extractor: scripted({ ...good, invoiceNumber: 'el-2026-071842' }),
      getBytes,
    });
    expect(await reload(second.id)).toMatchObject({ duplicateOfId: first.id, status: 'RECEIVED' });
  });

  it('is idempotent and tenant-scoped', async () => {
    const document = await addDocument();
    const extractor = scripted(good, good);
    await extractDocument(tenantId, document.id, { extractor, getBytes });
    expect(await extractDocument(tenantId, document.id, { extractor, getBytes })).toBe('skipped');
    const other = await addDocument();
    expect(
      await extractDocument((await createTenant()).id, other.id, { extractor, getBytes }),
    ).toBe('skipped');
    expect(extractor.corrections).toHaveLength(1);
  });
});

// §6.4 acceptance: total and date right in at least 9 of the 10 sample invoices of the repository.
// Runs with the development extractor by default; with the real one when
// RUN_AI_EXTRACTION_TEST=1 and ANTHROPIC_API_KEY are set (it costs a few cents).
describe('vat breakdown validation', () => {
  const base = { ...good, taxBase: 100, vatAmount: 12.2, total: 112.2, vatRate: 10 };
  const lines = [
    { rate: 10, base: 80, vat: 8 },
    { rate: 21, base: 20, vat: 4.2 },
  ];
  it('accepts a breakdown whose bases and VAT add up to the totals', () => {
    expect(validateExtraction({ ...base, vatBreakdown: lines }, '2026-09-22')).toEqual([]);
  });
  it('explains sums that do not match, wrong percentages and repeated rates', () => {
    expect(
      validateExtraction({ ...base, taxBase: 90, vatBreakdown: lines }, '2026-09-22')[0],
    ).toContain('not to taxBase 90');
    expect(
      validateExtraction(
        { ...base, vatBreakdown: [{ rate: 10, base: 80, vat: 9 }, lines[1]!] },
        '2026-09-22',
      ),
    ).toContainEqual(expect.stringContaining('is not 10 % of 80'));
    expect(
      validateExtraction(
        { ...base, vatBreakdown: [lines[0]!, { ...lines[0]!, base: 20, vat: 2 }] },
        '2026-09-22',
      ).at(-1),
    ).toContain('repeats a rate');
  });
});

describe('acceptance: sample invoices', () => {
  it(
    'extracts total and date correctly in at least 9 of the 10 single-rate invoices, and the breakdown of the multi-rate one',
    { timeout: 300_000 },
    async () => {
      vi.spyOn(console, 'info').mockImplementation(() => {});
      const extractor = getDocumentExtractor();
      let correct = 0;
      for (const sample of expected) {
        const bytes = new Uint8Array(
          readFileSync(new URL(`../../../../fixtures/invoices/${sample.file}`, import.meta.url)),
        );
        const { extraction } = await extractor.extract({ bytes, mimeType: 'application/pdf' });
        const ok =
          extraction?.date === sample.date &&
          extraction.total !== null &&
          Math.abs(extraction.total - sample.total) < 0.005;
        if ('vatBreakdown' in sample) {
          // The multi-rate ticket must come back whole: it is what TD-053 was about.
          expect(ok, sample.file).toBe(true);
          expect(extraction?.vatBreakdown, sample.file).toEqual(sample.vatBreakdown);
          expect(extraction?.taxBase).toBe(100);
          expect(extraction?.vatAmount).toBe(12.2);
          expect(extraction?.vatRate).toBe(10);
          expect(validateExtraction(extraction!, '2026-09-22')).toEqual([]);
        } else if (ok) correct++;
      }
      expect(correct).toBeGreaterThanOrEqual(9);
    },
  );
});
