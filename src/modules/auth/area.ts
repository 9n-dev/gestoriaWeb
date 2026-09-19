import 'server-only';
import { redirect } from 'next/navigation';
import { pendingAgreements } from '@/modules/legal/dpa';
import { can, type Action } from './permissions';
import { homePathFor, requireUser } from './session';

/** Guard for route-group layouts: the user, or a redirect to where they belong. */
export async function requireArea(area: Extract<Action, `area.${string}`>) {
  const user = await requireUser();
  if (!can(user, area)) redirect(homePathFor(user));
  // §4: nobody works in the portal before accepting the data processing agreement in force.
  if ((await pendingAgreements(user)).length > 0) redirect('/acceso/condiciones');
  return user;
}
