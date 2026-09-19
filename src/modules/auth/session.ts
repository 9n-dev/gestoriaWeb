import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getCurrentTenant } from '@/modules/tenants/current';
import { can } from './permissions';
import { loadSessionUser, type AuthenticatedUser } from './service';

/**
 * Whoever holds a valid session, even if the second factor is still pending. Only the login and
 * 2FA screens may use this one.
 */
export const getPendingUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const session = await auth();
  if (!session?.sessionId) return null;
  const tenant = await getCurrentTenant();
  return loadSessionUser(session.sessionId, tenant?.id ?? null);
});

/** Fully authenticated user of this request (second factor included). Null when there is none. */
export async function getSessionUser(): Promise<AuthenticatedUser | null> {
  const user = await getPendingUser();
  return user?.twoFactor === 'ok' ? user : null;
}

/** For pages, layouts and server actions: the user, or a redirect to the login page. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = (await getPendingUser()) ?? redirect('/acceso');
  // A password alone is not a full login for whoever must (or chose to) use a second factor.
  if (user.twoFactor !== 'ok') redirect('/acceso/2fa');
  return user;
}

/** Landing page of each kind of user. */
export function homePathFor(user: AuthenticatedUser): string {
  if (can(user, 'area.client')) return '/inicio';
  if (can(user, 'area.staff')) return '/panel';
  return '/plataforma';
}
