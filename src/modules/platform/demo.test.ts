import { beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant } from '@tests/setup/factories';

const bucket = vi.hoisted(() => new Map<string, Uint8Array>());
const flags = vi.hoisted(() => ({ demo: true }));
vi.mock('@/env', async (original) => {
  const { env } = await original<typeof import('@/env')>();
  return {
    env: new Proxy(env, {
      get: (target, key) => (key === 'DEMO_MODE' ? flags.demo : Reflect.get(target, key)),
    }),
  };
});
vi.mock('@/lib/storage/objects', () => ({
  putObject: vi.fn(async (key: string, body: Uint8Array) => void bucket.set(key, body)),
  getObjectBytes: vi.fn(async (key: string) => bucket.get(key)),
}));
vi.mock('@/lib/storage/multipart', () => ({
  deleteObject: vi.fn(async (key: string) => void bucket.delete(key)),
  deletePrefix: vi.fn(async (prefix: string) => {
    for (const key of [...bucket.keys()]) if (key.startsWith(prefix)) bucket.delete(key);
  }),
}));
vi.mock('@/lib/queue', () => ({
  enqueue: vi.fn(),
  QUEUES: { files: 'files', scheduled: 'scheduled' },
}));

import { resetDemo } from './demo';

describe('nightly demo reset', () => {
  beforeAll(resetDb);

  it('refuses to run outside demo mode', async () => {
    flags.demo = false;
    await expect(resetDemo()).rejects.toThrow(/DEMO_MODE/);
    flags.demo = true;
  });

  it('seeds from scratch and forgets what visitors did, including the gestorías they registered', async () => {
    const visitor = await createTenant({ slug: 'gestoria-de-un-visitante' });
    await createClient(visitor.id);

    expect(await resetDemo()).toEqual({ reset: ['gestoria-de-un-visitante'] });
    const perez = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'perez' } });
    expect(await prisma.client.count({ where: { tenantId: perez.id } })).toBe(12);
    const objects = bucket.size;
    expect(objects).toBeGreaterThan(0);

    await createClient(perez.id, { legalName: 'Cliente creado por un visitante' });
    expect(await resetDemo()).toEqual({ reset: expect.arrayContaining(['perez', 'otra']) });

    const fresh = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'perez' } });
    expect(fresh.id).not.toBe(perez.id);
    expect(await prisma.client.count({ where: { tenantId: fresh.id } })).toBe(12);
    expect(
      await prisma.client.count({ where: { legalName: 'Cliente creado por un visitante' } }),
    ).toBe(0);
    expect(bucket.size).toBe(objects);
    expect(await prisma.tenant.count({ where: { id: visitor.id } })).toBe(0);
  }, 180_000);
});
