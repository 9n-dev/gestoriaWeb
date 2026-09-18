import type { Role } from '@prisma/client';
import type { SessionUser } from '@/modules/auth/permissions';
import { createUser } from './factories';

/** A persisted user of the given role, in the shape services receive. */
export async function sessionUserFor(
  tenantId: string | null,
  role: Role,
  overrides: Partial<SessionUser> = {},
): Promise<SessionUser> {
  const user = await createUser(tenantId, role);
  return {
    id: user.id,
    tenantId,
    role,
    status: 'ACTIVE',
    clientIds: [],
    supportTenantIds: [],
    ...overrides,
  };
}
