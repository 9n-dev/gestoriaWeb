import { tenantDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, type SessionUser } from '@/modules/auth/permissions';
import { loadForStaff, resourceOf } from '@/modules/clients/service';

/** Deeds, certificates, census registration… with their expiry date (§6.2). Uploaded through `initiateUpload`. */
export async function listPermanentDocuments(user: SessionUser, clientId: string) {
  const client = await loadForStaff(user, clientId);
  assertCan(user, 'permanentDocument.read', resourceOf(client));
  return tenantDb(client.tenantId).permanentDocument.findMany({
    where: { clientId, deletedAt: null, file: { status: { not: 'PENDING' }, deletedAt: null } },
    select: {
      id: true,
      title: true,
      category: true,
      expiresAt: true,
      createdAt: true,
      file: { select: { id: true, originalName: true, status: true } },
    },
    orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }],
  });
}

export async function deletePermanentDocument(user: SessionUser, id: string): Promise<void> {
  if (!user.tenantId)
    throw new AppError('FORBIDDEN', 'No tienes permiso para realizar esta acción.');
  const db = tenantDb(user.tenantId);
  const document = await db.permanentDocument.findFirst({ where: { id, deletedAt: null } });
  if (!document) throw new AppError('NOT_FOUND', 'No encontramos ese documento.');
  assertCan(
    user,
    'permanentDocument.manage',
    resourceOf(await loadForStaff(user, document.clientId)),
  );

  await db.permanentDocument.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({
    tenantId: user.tenantId,
    actor: user,
    action: 'permanentDocument.delete',
    entity: 'PermanentDocument',
    entityId: id,
  });
}
