import 'server-only';
import { headers } from 'next/headers';

export type RequestMeta = { ip: string | null; userAgent: string | null };

/** IP and user agent of the current request, for audit entries and sessions. */
export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip'),
    userAgent: h.get('user-agent'),
  };
}
