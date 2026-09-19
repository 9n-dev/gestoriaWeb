import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './security-headers';

describe('content security policy', () => {
  const csp = contentSecurityPolicy('abc', 'https://bucket.example', false);

  it('allows scripts only through the nonce, never inline or eval', () => {
    const scripts = csp.split('; ').find((d) => d.startsWith('script-src')) ?? '';
    expect(scripts).toContain(`'nonce-abc'`);
    expect(scripts).not.toContain('unsafe-inline');
    expect(scripts).not.toContain('unsafe-eval');
  });

  it('lets the browser reach the bucket and nothing else foreign', () => {
    expect(csp).toContain(`connect-src 'self' https://bucket.example`);
    expect(csp).toContain(`frame-ancestors 'none'`);
    expect(csp).toContain(`object-src 'none'`);
  });

  it('relaxes eval and websockets only in development', () => {
    expect(contentSecurityPolicy('abc', 'http://localhost:9000', true)).toContain('unsafe-eval');
  });
});
