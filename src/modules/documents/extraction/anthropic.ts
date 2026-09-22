import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { extractionSchema, type DocumentExtractor, type ExtractorInput } from './types';

const SYSTEM = `You extract accounting data from Spanish invoices, receipts and tickets for an accounting firm.
Read the attached document and return its fields. Rules:
- supplierName and supplierTaxId belong to the ISSUER of the invoice (emisor), not to the customer.
- supplierTaxId is a Spanish NIF/CIF/NIE: uppercase, no spaces, dots or dashes.
- date is the invoice date in ISO format (YYYY-MM-DD). Spanish documents write dates as DD/MM/YYYY.
- Amounts are numbers with a dot as decimal separator. Spanish documents write 1.234,56 for 1234.56.
- vatRate is a percentage (21, 10, 4, 0). taxBase and vatAmount are always the totals of the whole document.
- With several VAT rates, also fill vatBreakdown with one entry per rate (rate, base, vat) and put the rate with the largest base in vatRate. With a single rate, vatBreakdown is null.
- taxBase + vatAmount should equal total unless the document shows withholdings (IRPF).
- currency is an ISO 4217 code; assume EUR when the document shows € or nothing.
- Use null for anything the document does not show. Never invent values.
- confidence is between 0 and 1: lower it for blurry photos, handwriting, partial pages or guessed fields.`;

/** Claude with vision (§6.4). The API key is resolved by the SDK from ANTHROPIC_API_KEY. */
export const anthropicExtractor = (model: string): DocumentExtractor => {
  const client = new Anthropic();
  return {
    async extract(input: ExtractorInput, correction?: string[]) {
      const data = Buffer.from(input.bytes).toString('base64');
      const document: Anthropic.ContentBlockParam =
        input.mimeType === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
          : { type: 'image', source: { type: 'base64', media_type: input.mimeType, data } };
      const instruction = correction?.length
        ? `Your previous answer had these problems:\n${correction.map((line) => `- ${line}`).join('\n')}\nLook at the document again and return the corrected fields.`
        : 'Extract the fields of this document.';

      const response = await client.messages.parse({
        model,
        max_tokens: 16000,
        system: SYSTEM,
        // Field extraction is simple: low effort keeps latency and cost down.
        output_config: { effort: 'low', format: zodOutputFormat(extractionSchema) },
        messages: [{ role: 'user', content: [document, { type: 'text', text: instruction }] }],
      });

      return {
        // A refusal or a truncated answer leaves parsed_output empty: the caller treats it as a failure.
        extraction: response.stop_reason === 'end_turn' ? (response.parsed_output ?? null) : null,
        raw: { stopReason: response.stop_reason, content: response.content },
        usage: {
          provider: 'anthropic',
          model: response.model,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  };
};
