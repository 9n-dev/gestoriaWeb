import 'server-only';
import { redirect } from 'next/navigation';
import { can, type Action } from './permissions';
import { homePathFor, requireUser } from './session';

/** Guard for route-group layouts: the user, or a redirect to where they belong. */
export async function requireArea(area: Extract<Action, `area.${string}`>) {
  const user = await requireUser();
  if (!can(user, area)) redirect(homePathFor(user));
  return user;
}
