import { randomBytes } from 'node:crypto';
import type { FileKind } from '@prisma/client';
import { prisma } from '@/lib/db';
import { createClient, createUser, linkClientUser } from './factories';

const uid = () => randomBytes(4).toString('hex');

/**
 * Creates at least one row of EVERY tenant-owned model for the given tenant.
 * The isolation suite fails when a new tenant-owned model is missing here.
 */
export async function seedTenantWorld(tenantId: string) {
  const admin = await createUser(tenantId, 'TENANT_ADMIN');
  const manager = await createUser(tenantId, 'MANAGER');
  const clientUser = await createUser(tenantId, 'CLIENT_USER');

  const taxProfile = await prisma.taxProfile.create({
    data: { tenantId, name: 'Autónomo trimestral', rules: {} },
  });
  const client = await createClient(tenantId, {
    assignedManagerId: manager.id,
    taxProfileId: taxProfile.id,
    internalNotes: 'Paga tarde. No comentar con el cliente.',
  });
  await linkClientUser(tenantId, client.id, clientUser.id);

  const period = await prisma.period.upsert({
    where: { year_type_ordinal: { year: 2026, type: 'QUARTER', ordinal: 3 } },
    create: { year: 2026, type: 'QUARTER', ordinal: 3 },
    update: {},
  });
  const file = (kind: FileKind) =>
    prisma.storedFile.create({
      data: {
        tenantId,
        kind,
        status: 'CLEAN',
        storageKey: `${tenantId}/${uid()}`,
        originalName: 'archivo.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        sha256: uid(),
      },
    });

  await prisma.userSession.create({
    data: { tenantId, userId: manager.id, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  await prisma.supportAccessGrant.create({
    data: { tenantId, grantedById: admin.id, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  await prisma.legalAcceptance.create({
    data: {
      tenantId,
      userId: admin.id,
      documentType: 'DPA_TENANT',
      version: '1',
      contentHash: uid(),
    },
  });
  await prisma.clientPeriod.create({
    data: { tenantId, clientId: client.id, periodId: period.id },
  });

  const document = await prisma.document.create({
    data: {
      tenantId,
      clientId: client.id,
      periodId: period.id,
      fileId: (await file('DOCUMENT')).id,
      uploadedById: clientUser.id,
    },
  });
  await prisma.permanentDocument.create({
    data: {
      tenantId,
      clientId: client.id,
      fileId: (await file('PERMANENT_DOCUMENT')).id,
      title: 'Escritura de constitución',
    },
  });
  await prisma.obligation.create({
    data: {
      tenantId,
      clientId: client.id,
      periodId: period.id,
      model: '303',
      dueDate: new Date('2026-10-20'),
    },
  });
  await prisma.checklistItem.create({
    data: { tenantId, clientId: client.id, periodId: period.id, documentType: 'ISSUED_INVOICE' },
  });

  const thread = await prisma.thread.create({
    data: { tenantId, clientId: client.id, subject: 'Tercer trimestre', createdById: manager.id },
  });
  const message = await prisma.message.create({
    data: {
      tenantId,
      threadId: thread.id,
      authorId: manager.id,
      body: 'Faltan las facturas de agosto.',
    },
  });
  await prisma.messageAttachment.create({
    data: { tenantId, messageId: message.id, fileId: (await file('MESSAGE_ATTACHMENT')).id },
  });
  await prisma.threadRead.create({
    data: { tenantId, threadId: thread.id, userId: clientUser.id },
  });
  await prisma.template.create({
    data: { tenantId, kind: 'MESSAGE', name: 'Reclamar facturas', body: 'Hola {{cliente}}' },
  });
  await prisma.delivery.create({
    data: {
      tenantId,
      clientId: client.id,
      fileId: (await file('DELIVERY')).id,
      title: 'Modelo 303 presentado',
      uploadedById: manager.id,
    },
  });

  await prisma.recurringFee.create({
    data: {
      tenantId,
      clientId: client.id,
      concept: 'Cuota mensual',
      amount: 90,
      startsOn: new Date('2026-01-01'),
    },
  });
  const series = await prisma.invoiceSeries.create({ data: { tenantId, code: '2026' } });
  const invoice = await prisma.invoice.create({
    data: { tenantId, clientId: client.id, seriesId: series.id },
  });
  await prisma.invoiceLine.create({
    data: {
      tenantId,
      invoiceId: invoice.id,
      description: 'Cuota mensual',
      unitPrice: 90,
      vatRate: 21,
      amount: 90,
    },
  });

  await prisma.notification.create({
    data: { tenantId, userId: clientUser.id, type: 'NEW_MESSAGE', title: 'Nuevo mensaje' },
  });
  await prisma.pushSubscription.create({
    data: {
      tenantId,
      userId: clientUser.id,
      endpoint: `https://push.test/${uid()}`,
      p256dh: 'k',
      auth: 'a',
    },
  });
  await prisma.savedView.create({
    data: { tenantId, userId: manager.id, scope: 'inbox', name: 'Pendientes', filters: {} },
  });
  await prisma.auditLog.create({ data: { tenantId, action: 'auth.login', entity: 'User' } });
  await prisma.emailLog.create({
    data: { tenantId, toAddress: 'a@b.test', fromAddress: 'no-reply@b.test', subject: 'Hola' },
  });
  await prisma.reminderLog.create({
    data: { tenantId, kind: 'OBLIGATION_DEADLINE', entityId: uid(), step: '7' },
  });
  await prisma.aiUsageLog.create({
    data: {
      tenantId,
      documentId: document.id,
      provider: 'anthropic',
      model: 'claude',
      inputTokens: 1000,
      outputTokens: 100,
    },
  });
  await prisma.dataExport.create({
    data: { tenantId, clientId: client.id, requestedById: admin.id },
  });

  return { admin, manager, clientUser, client, document, thread };
}
