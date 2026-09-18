import { tenantDb } from '@/lib/db';
import { assertCan, type SessionUser } from '@/modules/auth/permissions';
import { loadForStaff, resourceOf } from '@/modules/clients/service';

/** Obligations of a client the user can see, soonest deadline first. */
export async function listClientObligations(user: SessionUser, clientId: string) {
  const client = await loadForStaff(user, clientId);
  assertCan(user, 'obligation.read', resourceOf(client));
  return tenantDb(client.tenantId).obligation.findMany({
    where: { clientId },
    select: { id: true, model: true, dueDate: true, status: true, period: true },
    orderBy: [{ dueDate: 'asc' }, { model: 'asc' }],
  });
}
