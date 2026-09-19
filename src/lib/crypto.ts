import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '@/env';

/** One key per purpose, all derived from AUTH_SECRET: a leaked ciphertext of one kind never helps with another. */
const keyFor = (purpose: string) =>
  createHash('sha256').update(`${env.AUTH_SECRET}:${purpose}`).digest();

/** AES-256-GCM. Output: "v1.<iv>.<tag>.<ciphertext>", base64url. Used for secrets we must read back (TOTP). */
export function encryptSecret(plain: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(purpose), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export function decryptSecret(sealed: string, purpose: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', keyFor(purpose), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
