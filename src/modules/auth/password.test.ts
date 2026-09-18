import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const stored = await hashPassword('demo1234', { cost: 10 });
    expect(stored).toMatch(/^scrypt\$/);
    expect(stored).not.toContain('demo1234');
    expect(await verifyPassword('demo1234', stored)).toBe(true);
    expect(await verifyPassword('demo12345', stored)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('x', { cost: 10 })).not.toBe(await hashPassword('x', { cost: 10 }));
  });

  it('rejects malformed stored values instead of throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$10$8$1$$')).toBe(false);
  });
});
