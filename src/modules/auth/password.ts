import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const KEY_LENGTH = 64;
// OWASP-recommended scrypt parameters: N = 2^15, r = 8, p = 3.
const DEFAULT_COST = 15;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 3;

function derive(plain: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      plain.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { ...options, maxmem: 256 * 1024 * 1024 },
      (e, key) => (e ? reject(e) : resolve(key)),
    );
  });
}

/** Format: scrypt$<log2 N>$<r>$<p>$<salt>$<hash>. Parameters travel with the hash so they can be raised later. */
export async function hashPassword(plain: string, { cost = DEFAULT_COST } = {}): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(plain, salt, { N: 2 ** cost, r: BLOCK_SIZE, p: PARALLELIZATION });
  return [
    'scrypt',
    cost,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, cost, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  try {
    const expected = Buffer.from(hash, 'base64');
    const key = await derive(plain, Buffer.from(salt, 'base64'), {
      N: 2 ** Number(cost),
      r: Number(r),
      p: Number(p),
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
