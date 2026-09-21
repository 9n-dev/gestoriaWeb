import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  return (bits.match(/.{1,5}/g) ?? [])
    .map((chunk) => ALPHABET[parseInt(chunk.padEnd(5, '0'), 2)])
    .join('');
}

export function base32Decode(text: string): Buffer {
  let bits = '';
  for (const char of text.toUpperCase().replace(/[\s=-]/g, '')) {
    const value = ALPHABET.indexOf(char);
    if (value === -1) throw new Error('invalid base32');
    bits += value.toString(2).padStart(5, '0');
  }
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
}

/** 160-bit secret, as RFC 4226 recommends. */
export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

/** RFC 4226 HOTP with SHA-1, which is what every authenticator app implements. */
function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

export const totpAt = (secret: string, timeMs: number): string =>
  hotp(base32Decode(secret), Math.floor(timeMs / 1000 / STEP_SECONDS));

/**
 * RFC 6238 with one step of tolerance each way (clock drift), constant-time comparison. Returns the
 * 30-second step the code belongs to, so callers can refuse a code that was already used.
 */
export function matchTotpStep(
  secret: string,
  code: string,
  nowMs: number = Date.now(),
): number | null {
  const given = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  const current = Math.floor(nowMs / 1000 / STEP_SECONDS);
  for (const drift of [0, -1, 1]) {
    const expected = totpAt(secret, (current + drift) * STEP_SECONDS * 1000);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return current + drift;
  }
  return null;
}

export const verifyTotp = (secret: string, code: string, nowMs: number = Date.now()): boolean =>
  matchTotpStep(secret, code, nowMs) !== null;

/** What the authenticator app scans. */
export const otpauthUri = (secret: string, account: string, issuer: string): string =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?${new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) })}`;

/** Ten single-use codes like "K7M2-P9XQ": for when the phone is lost. */
export const generateRecoveryCodes = (): string[] =>
  Array.from({ length: 10 }, () => {
    const text = base32Encode(randomBytes(5));
    return `${text.slice(0, 4)}-${text.slice(4, 8)}`;
  });
