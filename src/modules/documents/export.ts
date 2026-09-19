import { z } from 'zod';
import { toCsv } from '@/lib/csv';
import { prisma, tenantDb } from '@/lib/db';
import { isoDate } from '@/lib/dates';
import { periodLabel } from '@/lib/labels';
import { DOCUMENT_STATUS } from '@/lib/labels-documents';
import { xlsx, type Cell } from '@/lib/xlsx';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, requireTenantId, scopeFor, type SessionUser } from '@/modules/auth/permissions';
import { DOCUMENT_TYPE_LABELS } from '@/modules/clients/tax-profiles/labels';
import type { Prisma } from '@prisma/client';

const exportSelect = {
  id: true,
  type: true,
  status: true,
  supplierName: true,
  supplierTaxId: true,
  invoiceNumber: true,
  invoiceDate: true,
  taxBase: true,
  vatRate: true,
  vatAmount: true,
  total: true,
  currency: true,
  extractionConfirmed: true,
  createdAt: true,
  period: true,
  client: { select: { legalName: true, taxId: true } },
  file: { select: { originalName: true } },
} satisfies Prisma.DocumentSelect;
type Row = Prisma.DocumentGetPayload<{ select: typeof exportSelect }>;

const amount = (value: Row['total']) => (value === null ? null : Number(value));

/** Every column a gestoría can put in its export, in the order it will be offered. */
export const EXPORT_COLUMNS = {
  cliente: { label: 'Cliente', value: (d: Row): Cell => d.client.legalName },
  nif_cliente: { label: 'NIF del cliente', value: (d: Row): Cell => d.client.taxId },
  periodo: { label: 'Periodo', value: (d: Row): Cell => (d.period ? periodLabel(d.period) : null) },
  tipo: { label: 'Tipo', value: (d: Row): Cell => DOCUMENT_TYPE_LABELS[d.type] },
  fecha: {
    label: 'Fecha',
    value: (d: Row): Cell => (d.invoiceDate ? isoDate(d.invoiceDate) : null),
  },
  numero: { label: 'Número', value: (d: Row): Cell => d.invoiceNumber },
  proveedor: { label: 'Proveedor o cliente', value: (d: Row): Cell => d.supplierName },
  nif: { label: 'NIF', value: (d: Row): Cell => d.supplierTaxId },
  base: { label: 'Base imponible', value: (d: Row): Cell => amount(d.taxBase) },
  tipo_iva: { label: '% IVA', value: (d: Row): Cell => amount(d.vatRate) },
  cuota_iva: { label: 'Cuota de IVA', value: (d: Row): Cell => amount(d.vatAmount) },
  total: { label: 'Total', value: (d: Row): Cell => amount(d.total) },
  moneda: { label: 'Moneda', value: (d: Row): Cell => d.currency },
  estado: { label: 'Estado', value: (d: Row): Cell => DOCUMENT_STATUS[d.status] },
  confirmado: {
    label: 'Datos confirmados',
    value: (d: Row): Cell => (d.extractionConfirmed ? 'sí' : 'no'),
  },
  archivo: { label: 'Archivo', value: (d: Row): Cell => d.file.originalName },
} as const;
export type ExportColumn = keyof typeof EXPORT_COLUMNS;
const COLUMN_KEYS = Object.keys(EXPORT_COLUMNS) as [ExportColumn, ...ExportColumn[]];
const DEFAULT_COLUMNS: ExportColumn[] = [
  'cliente',
  'fecha',
  'numero',
  'proveedor',
  'nif',
  'base',
  'tipo_iva',
  'cuota_iva',
  'total',
];

/** Saved per tenant in `Tenant.settings.exportFormat`, so it matches their accounting program once and for all. */
export const exportFormatSchema = z.object({
  columns: z
    .array(z.enum(COLUMN_KEYS))
    .min(1, 'Elige al menos una columna.')
    .catch(DEFAULT_COLUMNS),
  decimalSeparator: z.enum([',', '.']).catch(','),
  onlyBooked: z.boolean().catch(true),
});
export type ExportFormat = z.infer<typeof exportFormatSchema>;

export async function getExportFormat(tenantId: string): Promise<ExportFormat> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { settings: true },
  });
  return exportFormatSchema.parse(
    (tenant.settings as { exportFormat?: unknown } | null)?.exportFormat ?? {},
  );
}

export async function saveExportFormat(user: SessionUser, input: unknown): Promise<void> {
  assertCan(user, 'tenantSettings.manage');
  const tenantId = requireTenantId(user);
  const exportFormat = z
    .object({
      columns: z.array(z.enum(COLUMN_KEYS)).min(1, 'Elige al menos una columna.'),
      decimalSeparator: z.enum([',', '.']),
      onlyBooked: z.boolean(),
    })
    .parse(input);
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { settings: true },
  });
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: { ...(tenant.settings as Prisma.JsonObject), exportFormat } },
  });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'tenant.updateExportFormat',
    entity: 'Tenant',
    entityId: tenantId,
    diff: exportFormat,
  });
}

const requestSchema = z.object({
  period: z.object({
    year: z.number().int(),
    type: z.enum(['MONTH', 'QUARTER', 'YEAR']),
    ordinal: z.number().int(),
  }),
  clientId: z.string().optional(),
  format: z.enum(['csv', 'xlsx']).default('csv'),
});

/**
 * Documents of a period with their fields, ready to import into the accounting program (§6.10).
 * Managers export their assigned clients, leads everybody. XLSX keeps numbers as numbers; CSV
 * writes them with the tenant's decimal separator and neutralizes spreadsheet formulas.
 */
export async function exportDocuments(
  user: SessionUser,
  input: z.input<typeof requestSchema>,
): Promise<{ fileName: string; contentType: string; body: Uint8Array | string; count: number }> {
  assertCan(user, 'document.export');
  const tenantId = requireTenantId(user);
  const { period, clientId, format } = requestSchema.parse(input);
  const settings = await getExportFormat(tenantId);
  const ownOnly = scopeFor(user, 'document.export') === 'assigned';

  const documents = await tenantDb(tenantId).document.findMany({
    where: {
      deletedAt: null,
      period,
      clientId,
      status: settings.onlyBooked ? 'BOOKED' : { notIn: ['REJECTED', 'DUPLICATE'] },
      client: { deletedAt: null, assignedManagerId: ownOnly ? user.id : undefined },
    },
    select: exportSelect,
    orderBy: [{ client: { legalName: 'asc' } }, { invoiceDate: 'asc' }, { createdAt: 'asc' }],
  });

  const columns = settings.columns.map((key) => EXPORT_COLUMNS[key]);
  const rows: Cell[][] = [
    columns.map((c) => c.label),
    ...documents.map((d) => columns.map((c) => c.value(d))),
  ];
  await recordAudit({
    tenantId,
    actor: user,
    action: 'document.export',
    entity: 'Document',
    diff: { period, clientId: clientId ?? null, format, count: documents.length },
  });

  const name = `documentos-${period.year}-${period.type === 'YEAR' ? 'anual' : `${period.type === 'QUARTER' ? 't' : 'm'}${period.ordinal}`}`;
  if (format === 'xlsx') {
    return {
      fileName: `${name}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: xlsx(periodLabel(period), rows),
      count: documents.length,
    };
  }
  const text = rows.map((row) =>
    row.map((cell) =>
      typeof cell === 'number'
        ? cell.toFixed(2).replace('.', settings.decimalSeparator)
        : (cell ?? ''),
    ),
  );
  // With "," as decimal separator the field separator must be ";", which is what Spanish Excel expects anyway.
  return {
    fileName: `${name}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: toCsv(text, ';'),
    count: documents.length,
  };
}
