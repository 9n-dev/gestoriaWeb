import { prisma, tenantDb } from '@/lib/db';
import { abortMultipartUpload } from '@/lib/storage/multipart';

const DAY_MS = 86_400_000;

export type CleanupSummary = { sessions: number; tokens: number; tenants: number; uploads: number };

/**
 * Daily housekeeping (TD-013). Everything here is dead weight nobody can reach any more:
 * - sessions that expired or were revoked more than a week ago, and expired login tokens
 * - sign-ups that never verified their email after 7 days
 * - uploads abandoned in PENDING for more than 24 hours, with their open multipart upload
 */
export async function runCleanup(now: Date = new Date()): Promise<CleanupSummary> {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

  const sessions = await prisma.userSession.deleteMany({
    where: { OR: [{ expiresAt: { lt: weekAgo } }, { revokedAt: { lt: weekAgo } }] },
  });
  const tokens = await prisma.verificationToken.deleteMany({ where: { expires: { lt: now } } });

  const unverified = await prisma.tenant.findMany({
    where: { status: 'PENDING_VERIFICATION', createdAt: { lt: weekAgo } },
    select: { id: true },
  });
  for (const tenant of unverified) {
    await prisma.$transaction([
      prisma.user.deleteMany({ where: { tenantId: tenant.id } }),
      prisma.tenant.delete({ where: { id: tenant.id } }),
    ]);
  }

  const stale = await prisma.storedFile.findMany({
    where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - DAY_MS) } },
    select: { id: true, tenantId: true, storageKey: true, multipartUploadId: true },
  });
  for (const file of stale) {
    // The bucket may have expired the upload already: that is fine.
    if (file.multipartUploadId)
      await abortMultipartUpload(file.storageKey, file.multipartUploadId).catch(() => {});
    const db = tenantDb(file.tenantId);
    await db.document.deleteMany({ where: { fileId: file.id } });
    await db.permanentDocument.deleteMany({ where: { fileId: file.id } });
    await db.delivery.deleteMany({ where: { fileId: file.id } });
    await db.messageAttachment.deleteMany({ where: { fileId: file.id } });
    await db.obligation.updateMany({
      where: { receiptFileId: file.id },
      data: { receiptFileId: null },
    });
    await db.storedFile.delete({ where: { id: file.id } });
  }

  return {
    sessions: sessions.count,
    tokens: tokens.count,
    tenants: unverified.length,
    uploads: stale.length,
  };
}
