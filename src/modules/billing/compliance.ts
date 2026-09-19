import { createHash } from 'node:crypto';

export type SealInput = {
  issuerTaxId: string;
  fullNumber: string;
  issueDate: string;
  total: number;
  vatAmount: number;
  previousHash: string | null;
};
export type Seal = { hash: string; qrData: string };

/**
 * Verifactu lives behind this interface (§6.11) so the real submission to AEAT can be plugged in
 * without touching invoicing. What is already in place is what cannot be added later: every issued
 * invoice is chained to the previous one of its series at issue time, inside the numbering lock.
 */
export interface InvoiceCompliance {
  seal(input: SealInput): Seal;
}

/** Chained SHA-256 fingerprint and the payload of the verification QR, in the shape Verifactu uses. */
export const hashChainCompliance: InvoiceCompliance = {
  seal(input) {
    const canonical = [
      `IDEmisorFactura=${input.issuerTaxId}`,
      `NumSerieFactura=${input.fullNumber}`,
      `FechaExpedicionFactura=${input.issueDate}`,
      `CuotaTotal=${input.vatAmount.toFixed(2)}`,
      `ImporteTotal=${input.total.toFixed(2)}`,
      `Huella=${input.previousHash ?? ''}`,
    ].join('&');
    const query = new URLSearchParams({
      nif: input.issuerTaxId,
      numserie: input.fullNumber,
      fecha: input.issueDate.split('-').reverse().join('-'),
      importe: input.total.toFixed(2),
    });
    return {
      hash: createHash('sha256').update(canonical).digest('hex').toUpperCase(),
      qrData: `https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?${query}`,
    };
  },
};
