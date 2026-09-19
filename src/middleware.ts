import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, STATIC_SECURITY_HEADERS } from '@/lib/security-headers';

// Read straight from process.env: the validated `env` module is server-only Node code.
const bucketOrigin = new URL(process.env.S3_ENDPOINT ?? 'http://localhost:9000').origin;
const dev = process.env.NODE_ENV !== 'production';

/** Security headers on every response. Next reads the nonce from the request CSP header. */
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, bucketOrigin, dev);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: [
    // Static assets carry no HTML; webhooks and health checks are machine-to-machine.
    { source: '/((?!_next/static|_next/image|favicon.ico|sw.js|api/webhooks|api/health).*)' },
  ],
};
