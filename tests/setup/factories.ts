import { randomBytes } from 'node:crypto';
import type { Client, Prisma, Role, Tenant, User } from '@prisma/client';
import { prisma } from '@/lib/db';

const uid = () => randomBytes(4).toString('hex');

export function createTenant(overrides: Partial<Prisma.TenantCreateInput> = {}): Promise<Tenant> {
  const id = uid();
  return prisma.tenant.create({
    data: { name: `Gestoría ${id}`, slug: `gestoria-${id}`, status: 'ACTIVE', ...overrides },
  });
}

export function createUser(
  tenantId: string | null,
  role: Role,
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
): Promise<User> {
  return prisma.user.create({
    data: {
      tenantId,
      role,
      email: `${role.toLowerCase()}-${uid()}@example.test`,
      name: `Usuario ${role}`,
      status: 'ACTIVE',
      ...overrides,
    },
  });
}

export function createClient(
  tenantId: string,
  overrides: Partial<Prisma.ClientUncheckedCreateInput> = {},
): Promise<Client> {
  const id = uid();
  return prisma.client.create({
    data: {
      tenantId,
      legalName: `Cliente ${id}`,
      taxId: `X${id}`,
      inboundEmailCode: id,
      ...overrides,
    },
  });
}

export async function linkClientUser(tenantId: string, clientId: string, userId: string) {
  await prisma.clientUser.create({ data: { tenantId, clientId, userId } });
}
