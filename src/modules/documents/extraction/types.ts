import { z } from 'zod';

/**
 * What an extractor returns (§6.4). Kept to plain JSON-schema types — nullable strings and numbers —
 * because it is also sent to the model as its structured-output schema. Business validation
 * (NIF control letter, arithmetic, dates) happens afterwards, in the service.
 */
export const extractionSchema = z.object({
  supplierName: z.string().nullable(),
  supplierTaxId: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  /** ISO date, YYYY-MM-DD */
  date: z.string().nullable(),
  taxBase: z.number().nullable(),
  vatRate: z.number().nullable(),
  vatAmount: z.number().nullable(),
  total: z.number().nullable(),
  /** ISO 4217 */
  currency: z.string().nullable(),
  /** 0..1: how sure the extractor is about the whole set of fields */
  confidence: z.number(),
});
export type Extraction = z.infer<typeof extractionSchema>;

export type ExtractorInput = {
  bytes: Uint8Array;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
};
export type ExtractorResult = {
  /** null when the provider's answer could not be parsed at all */
  extraction: Extraction | null;
  raw: unknown;
  usage: { provider: string; model: string; inputTokens: number; outputTokens: number };
};

/** Swappable provider (§2): Anthropic in production, a deterministic parser in development. */
export interface DocumentExtractor {
  /** `correction` lists what was wrong with the previous answer, for the single retry. */
  extract(input: ExtractorInput, correction?: string[]): Promise<ExtractorResult>;
}
