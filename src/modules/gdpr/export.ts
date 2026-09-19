import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { toCsv } from '@/lib/csv';
import { prisma, tenantDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { AppError } from '@/lib/errors';
import { enqueue, QUEUES } from '@/lib/queue';
import { signedDownloadUrl } from '@/lib/storage/multipart';
import { getObjectBytes, putObject } from '@/lib/storage/objects';
import { zip, type ZipEntry } from '@/lib/zip';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, requireTenantId, type SessionUser } from '@/modules/auth/permissions';
import { platformBaseUrl } from '@/modules/tenants/resolve';

const EXPORT_LIFETIME_MS = 7 * 86_400_000;

/** Never leave the database: credentials and device secrets. */
const SECRET_FIELDS = new Set([
  'passwordHash',
  'totpSecret',
  'recoveryCodeHashes',
  'downloadTokenHash',
  'multipartUploadId',
]);
const SKIPPED_MODELS = new Set(['UserSession', 'PushSubscription', 'DataExport']);

type Row = Record<string, unknown>;
type Delegate = { findMany(args: object): Promise<Row[]> };
type Model = (typeof Prisma.dmmf.datamodel.models)[number];

const delegate = (model: Model) =>
  (prisma as unknown as Record<string, Delegate>)[
    model.name.charAt(0).toLowerCase() + model.name.slice(1)
  ]!;

const hasField = (model: Model, name: string) => model.fields.some((f) => f.name === name);

/** What belongs to one client, for the models that do not carry `clientId` themselves. */
const CLIENT_SCOPE: Record<string, (clientId: string) => object> = {
  Client: (id) => ({ id }),
  User: (clientId) => ({ clientLinks: { some: { clientId } } }),
  Message: (clientId) => ({ thread: { clientId } }),
  MessageAttachment: (clientId) => ({ message: { thread: { clientId } } }),
  ThreadRead: (clientId) => ({ thread: { clientId } }),
  InvoiceLine: (clientId) => ({ invoice: { clientId } }),
};

function scopeOf(model: Model, clientId: string | null): object | null {
  if (!clientId) return {};
  if (hasField(model, 'clientId')) return { clientId };
  return CLIENT_SCOPE[model.name]?.(clientId) ?? null;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && !(value instanceof Prisma.Decimal)) return JSON.stringify(value);
  return String(value);
}

/**
 * Everything the tenant holds (or holds about one client) as one CSV per table plus the files.
 * Generic over the Prisma model list on purpose: a table added tomorrow is exported tomorrow.
 * ponytail: the ZIP is built in memory; stream it to a multipart upload when a tenant outgrows RAM.
 */
export async function buildExport(tenantId: string, clientId: string | null): Promise<Uint8Array> {
  const entries: ZipEntry[] = [];
  const fileIds = new Set<string>();

  for (const model of Prisma.dmmf.datamodel.models) {
    if (SKIPPED_MODELS.has(model.name) || !hasField(model, 'tenantId')) continue;
    const scope = scopeOf(model, clientId);
    if (!scope) continue;

    const rows = await delegate(model).findMany({ where: { tenantId, ...scope } });
    if (rows.length === 0) continue;

    const columns = model.fields
      .filter((f) => f.kind !== 'object' && !SECRET_FIELDS.has(f.name))
      .map((f) => f.name);
    const fileColumns = model.fields
      .filter((f) => f.type === 'StoredFile' && f.relationFromFields?.length)
      .map((f) => f.relationFromFields![0]!);
    for (const row of rows) {
      for (const column of fileColumns) if (row[column]) fileIds.add(String(row[column]));
    }
    entries.push({
      path: `datos/${model.dbName ?? model.name}.csv`,
      data: toCsv([columns, ...rows.map((row) => columns.map((column) => cell(row[column])))]),
    });
  }

  // Files travel with their rows. Infected or unprocessed ones never leave the bucket.
  const files = await tenantDb(tenantId).storedFile.findMany({
    where: { status: 'CLEAN', ...(clientId ? { id: { in: [...fileIds] } } : {}) },
  });
  if (clientId) {
    const columns = ['id', 'originalName', 'mimeType', 'sizeBytes', 'sha256', 'createdAt'];
    entries.push({
      path: 'datos/stored_files.csv',
      data: toCsv([columns, ...files.map((file) => columns.map((c) => cell((file as Row)[c])))]),
    });
  }
  for (const file of files) {
    entries.push({
      path: `archivos/${file.id}-${file.originalName.replace(/[\\/]/g, '_')}`,
      data: await getObjectBytes(file.storageKey),
    });
  }

  return zip(entries);
}

/** Asks for an export of one client (right of access, §4) or of the whole tenant. Runs in the worker. */
export async function requestExport(user: SessionUser, clientId: string | null) {
  assertCan(user, clientId ? 'data.exportClient' : 'data.exportTenant');
  const tenantId = requireTenantId(user);
  const db = tenantDb(tenantId);
  if (clientId && !(await db.client.findFirst({ where: { id: clientId } }))) {
    throw new AppError('NOT_FOUND', 'No encontramos ese cliente.');
  }
  const running = await db.dataExport.findFirst({
    // An export stuck for an hour (worker down, job lost) must not block asking again.
    where: {
      clientId,
      status: { in: ['PENDING', 'PROCESSING'] },
      createdAt: { gt: new Date(Date.now() - 3_600_000) },
    },
  });
  if (running)
    throw new AppError('CONFLICT', 'Ya hay una exportación en marcha. Te avisaremos por correo.');

  const created = await db.dataExport.create({
    data: { tenantId, clientId, requestedById: user.id },
  });
  await enqueue(QUEUES.scheduled, 'export', { exportId: created.id }, `export_${created.id}`);
  await recordAudit({
    tenantId,
    actor: user,
    action: clientId ? 'data.export_client' : 'data.export_tenant',
    entity: clientId ? 'Client' : 'Tenant',
    entityId: clientId ?? tenantId,
  });
  return created;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Worker side: builds the ZIP, stores it and emails a download link to whoever asked. */
export async function runExport(exportId: string): Promise<void> {
  const job = await prisma.dataExport.findUnique({
    where: { id: exportId },
    include: { tenant: true, requestedBy: true },
  });
  if (!job || job.status === 'READY') return;
  await prisma.dataExport.update({ where: { id: exportId }, data: { status: 'PROCESSING' } });

  try {
    const bytes = await buildExport(job.tenantId, job.clientId);
    const storageKey = `${job.tenantId}/exports/${job.id}.zip`;
    await putObject(storageKey, bytes, 'application/zip');

    const token = randomBytes(32).toString('base64url');
    // A cancelled tenant keeps its export until the day everything is purged.
    const expiresAt = job.tenant.purgeAfter ?? new Date(Date.now() + EXPORT_LIFETIME_MS);
    await prisma.dataExport.update({
      where: { id: exportId },
      data: {
        status: 'READY',
        storageKey,
        sizeBytes: bytes.byteLength,
        downloadTokenHash: sha256(token),
        completedAt: new Date(),
        expiresAt,
        error: null,
      },
    });

    const to = job.requestedBy?.email ?? job.tenant.contactEmail;
    if (to) {
      await sendEmail({
        tenantId: job.tenantId,
        to,
        templateKey: 'data.export_ready',
        subject: 'Tu exportación de datos está lista',
        text: [
          'Hola:',
          '',
          `La exportación de datos de ${job.tenant.name} está lista. Descárgala desde este enlace:`,
          `${platformBaseUrl()}/api/exports/download?token=${token}`,
          '',
          `El enlace caduca el ${expiresAt.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' })}. Contiene datos personales: guárdala en un lugar seguro.`,
        ].join('\n'),
      });
    }
  } catch (error) {
    await prisma.dataExport.update({
      where: { id: exportId },
      data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

const zipName = (createdAt: Date) => `exportacion-${createdAt.toISOString().slice(0, 10)}.zip`;

type ReadyExport = { id: string; tenantId: string; storageKey: string | null; createdAt: Date };

async function downloadUrl(found: ReadyExport | null, actor: SessionUser | null): Promise<string> {
  if (!found?.storageKey) {
    throw new AppError('NOT_FOUND', 'La exportación no existe o ha caducado. Solicita una nueva.');
  }
  await recordAudit({
    tenantId: found.tenantId,
    actor,
    action: 'data.export_download',
    entity: 'DataExport',
    entityId: found.id,
  });
  return signedDownloadUrl(found.storageKey, zipName(found.createdAt), 'application/zip', false);
}

const ready = () => ({ status: 'READY' as const, expiresAt: { gt: new Date() } });

/** Door 1: the tenant admin, from the panel. */
export async function exportUrlForUser(user: SessionUser, exportId: string): Promise<string> {
  assertCan(user, 'data.exportTenant');
  const found = await tenantDb(requireTenantId(user)).dataExport.findFirst({
    where: { id: exportId, ...ready() },
  });
  return downloadUrl(found, user);
}

/** Door 2: the emailed link, the only one left for a cancelled tenant. Signed URL of 5 minutes. */
export async function exportUrlForToken(token: string): Promise<string> {
  const found = await prisma.dataExport.findFirst({
    where: { downloadTokenHash: sha256(token), ...ready() },
  });
  return downloadUrl(found, null);
}

export function listExports(user: SessionUser) {
  assertCan(user, 'data.exportTenant');
  return tenantDb(requireTenantId(user)).dataExport.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { client: { select: { legalName: true } } },
  });
}
