/** Payment pages a server action may redirect a (no-JS) form submission to. */
const PAYMENT_ORIGINS =
  'https://checkout.stripe.com https://pay.gocardless.com https://pay-sandbox.gocardless.com';

/**
 * CSP with a per-request nonce (§4). Scripts: only ours, through the nonce. The bucket is the one
 * foreign origin: the browser uploads parts to it and previews documents from signed URLs.
 */
export function contentSecurityPolicy(nonce: string, bucketOrigin: string, dev: boolean): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? ` 'unsafe-eval'` : ''}`,
    // Tenant colours are CSS variables in a style attribute; Next inlines critical CSS.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${bucketOrigin}`,
    `font-src 'self'`,
    `connect-src 'self' ${bucketOrigin}${dev ? ' ws:' : ''}`,
    `frame-src 'self' ${bucketOrigin}`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self' ${PAYMENT_ORIGINS}`,
    `frame-ancestors 'none'`,
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
