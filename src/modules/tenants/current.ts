import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { resolveTenant } from './resolve';

/** Tenant of the current request (null on the platform host). Resolved once per request. */
export const getCurrentTenant = cache(async () => {
  const host = (await headers()).get('host');
  return host ? resolveTenant(host) : null;
});
