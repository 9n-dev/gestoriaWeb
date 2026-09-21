import { parseCsv, toCsv } from '@/lib/csv';
import { AppError } from '@/lib/errors';
import { tenantDb } from '@/lib/db';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, requireTenantId, type SessionUser } from '@/modules/auth/permissions';
import { clientInputSchema, type ClientInput } from './schema';
import { createClient, listAssignableManagers } from './service';
import { listTaxProfiles } from './tax-profiles/service';

const MAX_ROWS = 1000;

/** Template column → client field. `perfil_fiscal` and `gestor_email` are resolved against the tenant. */
const COLUMNS = {
  razon_social: 'legalName',
  nombre_comercial: 'tradeName',
  nif: 'taxId',
  email: 'email',
  telefono: 'phone',
  direccion: 'addressLine',
  codigo_postal: 'postalCode',
  poblacion: 'city',
  provincia: 'province',
  perfil_fiscal: 'taxProfile',
  gestor_email: 'managerEmail',
} as const;

type Field = (typeof COLUMNS)[keyof typeof COLUMNS];
export type ImportRowReport = { row: number; legalName: string; errors: string[] };
export type ImportReport = { imported: number; rejected: ImportRowReport[] };

const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s-]+/g, '_');

export function clientImportTemplate(): string {
  return toCsv([
    Object.keys(COLUMNS),
    [
      'Marta Soler Vidal',
      '',
      '12345678Z',
      'marta@example.com',
      '600111222',
      'C/ Mayor, 1',
      '46001',
      'Valencia',
      'Valencia',
      'Autónomo · Estimación directa',
      '',
    ],
  ]);
}

/**
 * Imports the valid rows and reports the rest, row by row (§6.1): one bad NIF must not block the
 * other nineteen clients. Row numbers match the spreadsheet (header is row 1).
 */
export async function importClients(
  user: SessionUser,
  /** CSV text, or rows already read from a spreadsheet. */
  source: string | string[][],
): Promise<ImportReport> {
  assertCan(user, 'client.import');
  const tenantId = requireTenantId(user);

  const [header, ...lines] = typeof source === 'string' ? parseCsv(source) : source;
  if (!header || lines.length === 0) {
    throw new AppError('VALIDATION', 'El archivo está vacío. Descarga la plantilla y rellénala.');
  }
  if (lines.length > MAX_ROWS) {
    throw new AppError(
      'VALIDATION',
      `El archivo tiene más de ${MAX_ROWS} filas. Divídelo en varios.`,
    );
  }
  const fields = header.map(
    (name) => COLUMNS[normalize(name) as keyof typeof COLUMNS] as Field | undefined,
  );
  for (const required of ['legalName', 'taxId'] as const) {
    if (!fields.includes(required)) {
      throw new AppError(
        'VALIDATION',
        'Faltan columnas obligatorias (razon_social, nif). Usa la plantilla descargable.',
      );
    }
  }

  const profiles = new Map((await listTaxProfiles(user)).map((p) => [normalize(p.name), p.id]));
  const managers = new Map(
    (
      await tenantDb(tenantId).user.findMany({
        where: { id: { in: (await listAssignableManagers(user)).map((m) => m.id) } },
        select: { id: true, email: true },
      })
    ).map((m) => [m.email, m.id]),
  );

  const report: ImportReport = { imported: 0, rejected: [] };
  const seen = new Set<string>();

  for (const [index, cells] of lines.entries()) {
    const raw: Partial<Record<Field, string>> = {};
    fields.forEach((field, column) => {
      if (field) raw[field] = (cells[column] ?? '').trim();
    });
    const errors: string[] = [];

    const input: ClientInput = { ...raw, legalName: raw.legalName ?? '', taxId: raw.taxId ?? '' };
    if (raw.taxProfile) {
      input.taxProfileId = profiles.get(normalize(raw.taxProfile));
      if (!input.taxProfileId) errors.push(`No existe el perfil fiscal «${raw.taxProfile}».`);
    }
    if (raw.managerEmail) {
      input.assignedManagerId = managers.get(raw.managerEmail.toLowerCase());
      if (!input.assignedManagerId)
        errors.push(`No hay ningún gestor con el correo ${raw.managerEmail}.`);
    }

    const parsed = clientInputSchema.safeParse(input);
    if (!parsed.success) errors.push(...parsed.error.issues.map((issue) => issue.message));
    else if (seen.has(parsed.data.taxId)) errors.push('NIF repetido en el archivo.');

    if (errors.length === 0 && parsed.success) {
      seen.add(parsed.data.taxId);
      try {
        await createClient(user, input);
        report.imported++;
        continue;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        errors.push(error.userMessage);
      }
    }
    report.rejected.push({ row: index + 2, legalName: raw.legalName ?? '', errors });
  }

  await recordAudit({
    tenantId,
    actor: user,
    action: 'client.import',
    entity: 'Client',
    diff: { imported: report.imported, rejected: report.rejected.length },
  });
  return report;
}
