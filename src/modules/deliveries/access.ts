import type { Prisma } from '@prisma/client';
import { tenantDb } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { can, requireTenantId, type Resource, type SessionUser } from '@/modules/auth/permissions';

// Separate from service.ts so the file door (documents/service) can use it without a cycle.

export const deliverySelect = {
  id: true,
  tenantId: true,
  clientId: true,
  title: true,
  category: true,
  visibleFrom: true,
  notifiedAt: true,
  requiresSignature: true,
  signedAt: true,
  signatureIp: true,
  signatureUserAgent: true,
  signedFileHash: true,
  createdAt: true,
  period: { select: { year: true, type: true, ordinal: true } },
  file: {
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      status: true,
      sha256: true,
      sizeBytes: true,
    },
  },
  certificateFile: { select: { id: true } },
  signedBy: { select: { id: true, name: true, email: true } },
  uploadedBy: { select: { id: true, name: true } },
  client: {
    select: { id: true, legalName: true, taxId: true, assignedManagerId: true, status: true },
  },
} satisfies Prisma.DeliverySelect;

export type DeliveryRow = Prisma.DeliveryGetPayload<{ select: typeof deliverySelect }>;

export const deliveryResource = (delivery: DeliveryRow): Resource => ({
  tenantId: delivery.tenantId,
  clientId: delivery.clientId,
  assignedManagerId: delivery.client.assignedManagerId,
  clientStatus: delivery.client.status,
  // can() hides it from client users until this date.
  visibleFrom: delivery.visibleFrom,
});

/** A delivery the user may see. Clients do not see it before `visibleFrom`. */
export async function readableDelivery(user: SessionUser, id: string): Promise<DeliveryRow> {
  const delivery = await tenantDb(requireTenantId(user)).delivery.findFirst({
    where: { id, deletedAt: null, file: { status: { not: 'PENDING' } } },
    select: deliverySelect,
  });
  if (!delivery || !can(user, 'delivery.read', deliveryResource(delivery))) {
    throw new AppError('NOT_FOUND', 'No encontramos ese documento.');
  }
  return delivery;
}
