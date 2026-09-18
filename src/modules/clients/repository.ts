import type { Prisma } from '@prisma/client';
import { tenantDb } from '@/lib/db';

/** What a CLIENT_USER may see of a client. Internal fields are never selected. */
const clientFacingSelect = {
  id: true,
  tenantId: true,
  legalName: true,
  tradeName: true,
  taxId: true,
  email: true,
  phone: true,
  addressLine: true,
  postalCode: true,
  city: true,
  province: true,
  country: true,
  status: true,
} satisfies Prisma.ClientSelect;

const staffSelect = {
  ...clientFacingSelect,
  taxProfileId: true,
  assignedManagerId: true,
  tags: true,
  internalNotes: true,
  lastActivityAt: true,
  createdAt: true,
} satisfies Prisma.ClientSelect;

export type ClientFacingClient = Prisma.ClientGetPayload<{ select: typeof clientFacingSelect }>;
export type StaffClient = Prisma.ClientGetPayload<{ select: typeof staffSelect }>;

export type ClientFilter = { ids?: string[]; assignedManagerId?: string };

const where = (filter: ClientFilter): Prisma.ClientWhereInput => ({
  deletedAt: null,
  ...(filter.ids ? { id: { in: filter.ids } } : {}),
  ...(filter.assignedManagerId ? { assignedManagerId: filter.assignedManagerId } : {}),
});

export const clientsRepository = (tenantId: string) => {
  const db = tenantDb(tenantId);
  return {
    listForStaff: (filter: ClientFilter): Promise<StaffClient[]> =>
      db.client.findMany({
        where: where(filter),
        select: staffSelect,
        orderBy: { legalName: 'asc' },
      }),
    listForClientUser: (filter: ClientFilter): Promise<ClientFacingClient[]> =>
      db.client.findMany({
        where: where(filter),
        select: clientFacingSelect,
        orderBy: { legalName: 'asc' },
      }),
    findForStaff: (id: string): Promise<StaffClient | null> =>
      db.client.findFirst({ where: { id, deletedAt: null }, select: staffSelect }),
  };
};
