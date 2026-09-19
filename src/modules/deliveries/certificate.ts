import { makePdf } from '@/lib/pdf';

export type SignatureEvidence = {
  tenantName: string;
  clientName: string;
  clientTaxId: string;
  deliveryTitle: string;
  fileName: string;
  fileSha256: string;
  signerName: string;
  signerEmail: string;
  signedAt: Date;
  ip: string | null;
  userAgent: string | null;
};

const timestamp = (date: Date) =>
  `${new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'medium', timeZone: 'Europe/Madrid' }).format(date)} (hora peninsular) · ${date.toISOString()} UTC`;

const wrap = (text: string, width = 86): string[] =>
  text.match(new RegExp(`.{1,${width}}`, 'g')) ?? [''];

/**
 * Certificate of a simple electronic signature (§6.7): who accepted which exact file, when and
 * from where. Anyone holding the file can recompute its SHA-256 and compare.
 */
export function signatureCertificate(evidence: SignatureEvidence): Uint8Array {
  return makePdf([
    'CERTIFICADO DE CONFORMIDAD (firma electrónica simple)',
    '',
    `Emitido por: ${evidence.tenantName}`,
    '',
    `Documento: ${evidence.deliveryTitle}`,
    `Archivo: ${evidence.fileName}`,
    'Huella SHA-256 del archivo aceptado:',
    ...wrap(evidence.fileSha256),
    '',
    `Cliente: ${evidence.clientName} (${evidence.clientTaxId})`,
    `Aceptado por: ${evidence.signerName} <${evidence.signerEmail}>`,
    `Fecha y hora: ${timestamp(evidence.signedAt)}`,
    `Dirección IP: ${evidence.ip ?? 'no disponible'}`,
    'Navegador:',
    ...wrap(evidence.userAgent ?? 'no disponible'),
    '',
    'La persona indicada, identificada en el portal con sus credenciales, declaró haber',
    'leído el documento y estar conforme con su contenido.',
  ]);
}
