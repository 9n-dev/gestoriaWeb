import type {
  DeliveryCategory,
  DocumentSource,
  DocumentStatus,
  FileStatus,
  PermanentDocumentCategory,
} from '@prisma/client';

export const DOCUMENT_STATUS: Record<DocumentStatus, string> = {
  RECEIVED: 'Recibido',
  IN_REVIEW: 'En revisión',
  BOOKED: 'Contabilizado',
  REJECTED: 'Rechazado',
  DUPLICATE: 'Duplicado',
};

export const DOCUMENT_SOURCE: Record<DocumentSource, string> = {
  WEB: 'Web',
  EMAIL: 'Correo',
  WHATSAPP: 'WhatsApp',
};

export const PERMANENT_CATEGORY: Record<PermanentDocumentCategory, string> = {
  DEED: 'Escritura',
  CERTIFICATE: 'Certificado',
  CENSUS_REGISTRATION: 'Alta censal',
  POWER_OF_ATTORNEY: 'Poder',
  ID_DOCUMENT: 'Documento de identidad',
  CONTRACT: 'Contrato',
  OTHER: 'Otro',
};

/** What people see while the worker has not finished with the file. */
export const fileStatusNote = (status: FileStatus): string | null =>
  status === 'UPLOADED' ? 'Analizando…' : status === 'INFECTED' ? 'Bloqueado' : null;

export const DELIVERY_CATEGORY: Record<DeliveryCategory, string> = {
  FILED_FORM: 'Modelo presentado',
  LEDGER: 'Libro o listado',
  LETTER: 'Carta o comunicación',
  CERTIFICATE: 'Certificado',
  OTHER: 'Otro',
};
