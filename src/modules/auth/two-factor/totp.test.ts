import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  otpauthUri,
  totpAt,
  verifyTotp,
} from './totp';

// RFC 6238 appendix B test vectors (SHA-1, secret "12345678901234567890"), truncated to 6 digits.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 6238 vectors', () => {
    expect(totpAt(RFC_SECRET, 59_000)).toBe('287082');
    expect(totpAt(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totpAt(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
    expect(totpAt(RFC_SECRET, 20_000_000_000_000)).toBe('353130');
  });

  it('accepts the current code and one step of drift, nothing else', () => {
    const now = 1_790_000_000_000;
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 30_000), now)).toBe(true);
    expect(
      verifyTotp(RFC_SECRET, ` ${totpAt(RFC_SECRET, now + 30_000).replace(/(\d{3})/, '$1 ')}`, now),
    ).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 90_000), now)).toBe(false);
    for (const bad of ['', '12345', '1234567', 'abcdef'])
      expect(verifyTotp(RFC_SECRET, bad, now)).toBe(false);
  });

  it('round-trips base32 and generates usable secrets, URIs and recovery codes', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(otpauthUri(secret, 'gestor@demo.es', 'Gestoría Pérez')).toContain(
      'otpauth://totp/Gestor%C3%ADa%20P%C3%A9rez%3Agestor%40demo.es?secret=',
    );
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((code) => /^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(code))).toBe(true);
  });
});

describe('secret encryption', () => {
  it('round-trips, never repeats, and rejects tampering or the wrong purpose', () => {
    const sealed = encryptSecret('JBSWY3DPEHPK3PXP', 'totp');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(encryptSecret('JBSWY3DPEHPK3PXP', 'totp')).not.toBe(sealed);
    expect(decryptSecret(sealed, 'totp')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptSecret(sealed, 'other')).toThrow();
    expect(() => decryptSecret(sealed.slice(0, -2) + 'xx', 'totp')).toThrow();
  });
});
