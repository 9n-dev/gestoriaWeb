import { describe, expect, it } from 'vitest';
import { textWidth } from '@/lib/pdf';
import { signatureCertificate, type SignatureEvidence } from './certificate';

const evidence: SignatureEvidence = {
  tenantName: 'Gestoría Pérez',
  clientName: 'Marta Soler',
  clientTaxId: '12345678Z',
  deliveryTitle: 'Modelo 303 · 3T 2026',
  fileName: `${'informe_sin_espacios_'.repeat(8)}.pdf`,
  fileSha256: 'ab'.repeat(32),
  signerName: 'Marta',
  signerEmail: 'marta@example.com',
  signedAt: new Date('2026-09-19T16:20:31Z'),
  ip: '203.0.113.7',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
  brandColor: '#ff0000',
};
const strings = (pdf: Uint8Array) =>
  [
    ...Buffer.from(pdf)
      .toString('latin1')
      .matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g),
  ].map((m) => m[1]!);

describe('signature certificate', () => {
  it('states the evidence: exact file hash in one piece, who, when (local and UTC), from where', () => {
    const shown = strings(signatureCertificate(evidence));
    for (const expected of [
      'Certificado de conformidad',
      'ab'.repeat(32),
      'Marta Soler \\(12345678Z\\)',
      'Marta <marta@example.com>',
      '2026-09-19T16:20:31.000Z',
      '203.0.113.7',
    ]) {
      expect(shown, expected).toContain(expected);
    }
    expect(shown.some((text) => text.includes('18:20:31'))).toBe(true); // Madrid, UTC+2 in September
  });

  it('keeps every line inside the page, however long the words are', () => {
    const pdf = Buffer.from(signatureCertificate(evidence)).toString('latin1');
    const ops = [
      ...pdf.matchAll(/\/(F[12]) (\d+) Tf [\d. ]+ rg ([\d.]+) [\d.]+ Td \(((?:\\.|[^\\)])*)\) Tj/g),
    ];
    expect(ops.length).toBeGreaterThan(15);
    for (const [, font, size, x, text] of ops) {
      const right = Number(x) + textWidth(text!, Number(size), font === 'F2' ? 'bold' : 'regular');
      expect(right, text).toBeLessThanOrEqual(595 - 56 + 1);
    }
  });

  it('carries the logo and colour of the gestoría, and works without them', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'base64',
    );
    const branded = Buffer.from(
      signatureCertificate({ ...evidence, logo: new Uint8Array(png) }),
    ).toString('latin1');
    expect(branded).toContain('/Im1 Do');
    expect(branded).toContain('1.000 0.000 0.000 rg');
    const plain = Buffer.from(
      signatureCertificate({ ...evidence, logo: null, brandColor: null }),
    ).toString('latin1');
    expect(plain).not.toContain('/Subtype /Image');
  });
});
