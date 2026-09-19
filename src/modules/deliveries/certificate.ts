import { PAGE, PdfDocument, wrapText } from '@/lib/pdf';
import { pdfImageFrom } from '@/lib/pdf-image';

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
  /** White label: the gestoría's colour and logo (PNG or JPEG), when it has them. */
  brandColor?: string | null;
  logo?: Uint8Array | null;
};

const MARGIN = 56;
const WIDTH = PAGE.width - MARGIN * 2;
const MUTED = '#52525b';
const RULE = '#d4d4d8';

const timestamp = (date: Date) =>
  `${new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'medium', timeZone: 'Europe/Madrid' }).format(date)} (hora peninsular)`;

/**
 * Certificate of a simple electronic signature (§6.7): who accepted which exact file, when and
 * from where. Anyone holding the file can recompute its SHA-256 and compare.
 */
export function signatureCertificate(evidence: SignatureEvidence): Uint8Array {
  const brand = evidence.brandColor ?? '#1d4ed8';
  const document = new PdfDocument();
  const page = document.addPage();
  page.rect(0, 0, PAGE.width, 8, brand);

  let y = 64;
  const logo = evidence.logo ? pdfImageFrom(evidence.logo) : null;
  if (logo) {
    const ratio = Math.min(170 / logo.width, 46 / logo.height);
    page.image(document.addImage(logo), MARGIN, 32, logo.width * ratio, logo.height * ratio);
    y = 32 + logo.height * ratio + 34;
  }
  page.text(MARGIN, y, 'Certificado de conformidad', { size: 20, font: 'bold', color: brand });
  page.text(MARGIN, y + 18, `Firma electrónica simple · Emitido por ${evidence.tenantName}`, {
    size: 10,
    color: MUTED,
  });
  y += 50;

  const field = (label: string, value: string) => {
    page.text(MARGIN, y, label.toUpperCase(), { size: 8, font: 'bold', color: MUTED });
    // A word longer than the line (a file name without spaces) is broken so it cannot run off the page.
    const lines = wrapText(value.replace(/(\S{70})(?=\S)/g, '$1 '), WIDTH, 11);
    lines.forEach((line, index) => page.text(MARGIN, y + 15 + index * 14, line, { size: 11 }));
    y += 15 + lines.length * 14 + 10;
  };
  const section = (title: string) => {
    page.line(MARGIN, y, PAGE.width - MARGIN, y, RULE);
    page.text(MARGIN, y + 20, title, { size: 12, font: 'bold' });
    y += 40;
  };

  section('Documento aceptado');
  field('Documento', evidence.deliveryTitle);
  field('Archivo', evidence.fileName);
  field('Huella SHA-256 del archivo aceptado', evidence.fileSha256);

  section('Quién y cuándo');
  field('Cliente', `${evidence.clientName} (${evidence.clientTaxId})`);
  field('Aceptado por', `${evidence.signerName} <${evidence.signerEmail}>`);
  field('Fecha y hora', timestamp(evidence.signedAt));
  field('Fecha y hora (UTC)', evidence.signedAt.toISOString());
  field('Dirección IP', evidence.ip ?? 'no disponible');
  field('Navegador', evidence.userAgent ?? 'no disponible');

  page.line(MARGIN, y, PAGE.width - MARGIN, y, RULE);
  const declaration =
    'La persona indicada, identificada en el portal con sus credenciales, declaró haber leído el documento y estar conforme con su contenido. Quien conserve el archivo puede recalcular su huella SHA-256 y compararla con la de este certificado.';
  wrapText(declaration, WIDTH, 10).forEach((line, index) =>
    page.text(MARGIN, y + 22 + index * 14, line, { size: 10, color: MUTED }),
  );

  return document.build();
}
