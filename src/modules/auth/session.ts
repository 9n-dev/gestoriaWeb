import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getCurrentTenant } from '@/modules/tenants/current';
import { can } from './permissions';
import { loadSessionUser, type AuthenticatedUser } from './service';

/** Authenticated user of this request, validated against UserSession. Null when there is none. */
export const getSessionUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const session = await auth();
  if (!session?.sessionId) return null;
  const tenant = await getCurrentTenant();
  return loadSessionUser(session.sessionId, tenant?.id ?? null);
});

/** For pages, layouts and server actions: the user, or a redirect to the login page. */
export async function requireUser(): Promise<AuthenticatedUser> {
  return (await getSessionUser()) ?? redirect('/acceso');
}

/** Landing page of each kind of user. */
export function homePathFor(user: AuthenticatedUser): string {
  if (can(user, 'area.client')) return '/inicio';
  if (can(user, 'area.staff')) return '/panel';
  return '/plataforma';
}
