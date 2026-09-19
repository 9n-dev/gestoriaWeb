import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { requestHost, resolveTenant } from './resolve';

/** Tenant of the current request (null on the platform host). Resolved once per request. */
export const getCurrentTenant = cache(async () => {
  const host = requestHost(await headers());
  return host ? resolveTenant(host) : null;
});
