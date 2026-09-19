import { createHash, randomUUID } from 'node:crypto';
import { prisma, tenantDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { RequestMeta } from '@/lib/request';
import { putObject } from '@/lib/storage/objects';
import { recordAudit } from '@/modules/audit/service';
import { assertCan, requireTenantId, scopeFor, type SessionUser } from '@/modules/auth/permissions';
import { loadForStaff, resourceOf } from '@/modules/clients/service';
import { notifyClientUsers, notifyUsers } from '@/modules/messaging/notifications';
import { deliveryResource, deliverySelect, readableDelivery, type DeliveryRow } from './access';
import { signatureCertificate } from './certificate';

/** Deliveries of a client. Client users only get the ones already visible to them. */
export async function listDeliveries(user: SessionUser, clientId: string): Promise<DeliveryRow[]> {
  const client = await loadForStaff(user, clientId);
  assertCan(user, 'delivery.read', resourceOf(client));
  const clientSide = scopeFor(user, 'delivery.read') === 'own';
  return tenantDb(client.tenantId).delivery.findMany({
    where: {
      clientId,
      deletedAt: null,
      file: { status: clientSide ? 'CLEAN' : { not: 'PENDING' } },
      visibleFrom: clientSide ? { lte: new Date() } : undefined,
    },
    select: deliverySelect,
    orderBy: { visibleFrom: 'desc' },
  });
}

export const getDelivery = readableDelivery;

/**
 * Tells the client a delivery is there, once: when the worker marks its file clean, or on its
 * `visibleFrom` day (daily job). `notifiedAt` is the idempotency mark.
 */
export async function announceDeliveries(
  tenantId: string,
  where: { fileId?: string } = {},
): Promise<number> {
  const db = tenantDb(tenantId);
  const due = await db.delivery.findMany({
    where: {
      ...where,
      deletedAt: null,
      notifiedAt: null,
      visibleFrom: { lte: new Date() },
      file: { status: 'CLEAN' },
    },
    select: { id: true, clientId: true, title: true, requiresSignature: true },
  });
  for (const delivery of due) {
    const { count } = await db.delivery.updateMany({
      where: { id: delivery.id, notifiedAt: null },
      data: { notifiedAt: new Date() },
    });
    if (count === 0) continue;
    await notifyClientUsers(tenantId, delivery.clientId, {
      type: delivery.requiresSignature ? 'SIGNATURE_REQUESTED' : 'DELIVERY_AVAILABLE',
      title: delivery.requiresSignature
        ? `Necesitamos tu conformidad: ${delivery.title}`
        : `Tienes un documento nuevo: ${delivery.title}`,
      link: `/entregas/${delivery.id}`,
    });
  }
  return due.length;
}

/**
 * Simple signature (§6.7): the client declares having read the document and agreeing with it.
 * Stored: when, from which IP and browser, and the SHA-256 of the exact file. A PDF certificate
 * with that evidence is generated and attached to the delivery.
 */
export async function signDelivery(
  user: SessionUser,
  id: string,
  accepted: boolean,
  meta: RequestMeta,
): Promise<void> {
  const delivery = await readableDelivery(user, id);
  assertCan(user, 'delivery.sign', deliveryResource(delivery));
  if (!accepted) throw new AppError('VALIDATION', 'Marca la casilla de conformidad para firmar.');
  if (!delivery.requiresSignature)
    throw new AppError('CONFLICT', 'Este documento no necesita firma.');
  if (delivery.signedAt) throw new AppError('CONFLICT', 'Este documento ya está firmado.');
  if (delivery.file.status !== 'CLEAN' || !delivery.file.sha256) {
    throw new AppError(
      'CONFLICT',
      'El documento todavía se está preparando. Inténtalo en unos segundos.',
    );
  }

  const db = tenantDb(delivery.tenantId);
  const signedAt = new Date();
  // Claim first: two simultaneous clicks produce one signature.
  const { count } = await db.delivery.updateMany({
    where: { id, signedAt: null },
    data: {
      signedAt,
      signedById: user.id,
      signatureIp: meta.ip,
      signatureUserAgent: meta.userAgent,
      signedFileHash: delivery.file.sha256,
    },
  });
  if (count === 0) throw new AppError('CONFLICT', 'Este documento ya está firmado.');

  const [tenant, signer] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: delivery.tenantId }, select: { name: true } }),
    db.user.findFirst({ where: { id: user.id }, select: { name: true, email: true } }),
  ]);
  const pdf = signatureCertificate({
    tenantName: tenant.name,
    clientName: delivery.client.legalName,
    clientTaxId: delivery.client.taxId,
    deliveryTitle: delivery.title,
    fileName: delivery.file.originalName,
    fileSha256: delivery.file.sha256,
    signerName: signer?.name ?? '',
    signerEmail: signer?.email ?? '',
    signedAt,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  const storageKey = `${delivery.tenantId}/clients/${delivery.clientId}/${randomUUID()}`;
  await putObject(storageKey, pdf, 'application/pdf');
  const certificate = await db.storedFile.create({
    data: {
      tenantId: delivery.tenantId,
      kind: 'SIGNATURE_CERTIFICATE',
      // Generated by us from text: nothing to scan.
      status: 'CLEAN',
      scannedAt: signedAt,
      storageKey,
      originalName: `certificado-firma-${delivery.id}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
      sha256: createHash('sha256').update(pdf).digest('hex'),
    },
  });
  await db.delivery.update({ where: { id }, data: { certificateFileId: certificate.id } });

  await recordAudit({
    tenantId: delivery.tenantId,
    actor: user,
    action: 'delivery.sign',
    entity: 'Delivery',
    entityId: id,
    diff: { fileSha256: delivery.file.sha256, certificateFileId: certificate.id },
    ...meta,
  });
  const staff = [delivery.uploadedBy?.id, delivery.client.assignedManagerId].filter(
    (v): v is string => Boolean(v),
  );
  await notifyUsers(delivery.tenantId, [...new Set(staff)], {
    type: 'SYSTEM',
    title: `${delivery.client.legalName} ha firmado «${delivery.title}»`,
    link: `/panel/clientes/${delivery.clientId}`,
  });
}

export async function deleteDelivery(user: SessionUser, id: string): Promise<void> {
  const delivery = await readableDelivery(user, id);
  assertCan(user, 'delivery.delete', deliveryResource(delivery));
  if (delivery.signedAt)
    throw new AppError('CONFLICT', 'Un documento firmado no se puede eliminar.');
  await tenantDb(delivery.tenantId).delivery.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await recordAudit({
    tenantId: delivery.tenantId,
    actor: user,
    action: 'delivery.delete',
    entity: 'Delivery',
    entityId: id,
  });
}

/** Who opened, downloaded or signed it, and when: read from the audit log (ADR 0008). */
export async function deliveryHistory(user: SessionUser, id: string) {
  const delivery = await readableDelivery(user, id);
  assertCan(user, 'delivery.viewHistory', deliveryResource(delivery));
  const db = tenantDb(requireTenantId(user));
  const entries = await db.auditLog.findMany({
    where: {
      entity: 'Delivery',
      entityId: id,
      action: { in: ['file.view', 'file.download', 'delivery.sign'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const people = await db.user.findMany({
    where: { id: { in: entries.map((e) => e.actorId).filter((v): v is string => Boolean(v)) } },
    select: { id: true, name: true },
  });
  const names = new Map(people.map((person) => [person.id, person.name]));
  return entries.map((entry) => ({
    id: entry.id,
    action: entry.action,
    at: entry.createdAt,
    actorName: (entry.actorId && names.get(entry.actorId)) || 'Usuario eliminado',
    ip: entry.ip,
  }));
}
