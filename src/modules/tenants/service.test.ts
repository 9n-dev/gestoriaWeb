import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { consumeMagicLink } from '@/modules/auth/service';
import type { SessionUser } from '@/modules/auth/permissions';
import { resetDb } from '@tests/setup/db';
import { createTenant } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { seedSystemData } from '../../../prisma/system-data';
import { resolveTenant } from './resolve';
import {
  completeOnboarding,
  createSampleData,
  createTenantAsSuperadmin,
  deleteSampleData,
  listTenants,
  registerTenant,
  setTenantStatus,
  updateBranding,
  updateTenantProfile,
  verifyTenantRegistration,
} from './service';

const putObject = vi.hoisted(() => vi.fn());
vi.mock('@/lib/storage/objects', () => ({ putObject }));
vi.mock('@/lib/queue', () => ({ enqueue: vi.fn(), QUEUES: { files: 'files' } }));

const registration = (overrides = {}) => ({
  name: 'Gestoría Nueva',
  slug: 'nueva',
  adminName: 'Ana Admin',
  adminEmail: 'ana@nueva.es',
  ...overrides,
});
const tokenFrom = async (pattern: RegExp) => {
  const email = await prisma.emailLog.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  return pattern.exec(email.bodyText ?? '')![1]!;
};

describe('tenants service', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    putObject.mockReset();
    await resetDb();
    await seedSystemData(prisma);
  });

  describe('self-registration', () => {
    it('creates a pending tenant that does not resolve until the email is verified', async () => {
      await registerTenant(registration());
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { slug: 'nueva' },
        include: { users: true },
      });
      expect(tenant.status).toBe('PENDING_VERIFICATION');
      expect(tenant.users).toMatchObject([
        { email: 'ana@nueva.es', role: 'TENANT_ADMIN', status: 'INVITED' },
      ]);
      expect(await resolveTenant('nueva.app.test')).toBeNull();

      const email = await prisma.emailLog.findFirstOrThrow();
      expect(email.bodyText).toContain('https://app.test/registro/verificar?token=');
    });

    it('verification activates tenant and admin and hands over a one-time login on the tenant host', async () => {
      await registerTenant(registration());
      const token = await tokenFrom(/verificar\?token=([\w-]+)/);

      const loginUrl = await verifyTenantRegistration(token);

      expect(loginUrl).toMatch(/^https:\/\/nueva\.app\.test\/acceso\/enlace\?token=/);
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'nueva' } });
      expect(tenant.status).toBe('ACTIVE');
      const admin = await consumeMagicLink(tenant.id, loginUrl.split('token=')[1]!);
      expect(admin).toMatchObject({ email: 'ana@nueva.es', status: 'ACTIVE' });

      await expect(verifyTenantRegistration(token)).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('rejects taken, reserved and malformed addresses', async () => {
      await registerTenant(registration());
      await expect(registerTenant(registration({ adminEmail: 'otro@x.es' }))).rejects.toMatchObject(
        { code: 'CONFLICT' },
      );
      for (const slug of ['www', 'plataforma', 'a', '-abc', 'abc-', 'con espacios', 'ñandú']) {
        await expect(registerTenant(registration({ slug })), slug).rejects.toThrow();
      }
    });
  });

  describe('platform administration', () => {
    let root: SessionUser;
    beforeEach(async () => {
      root = await sessionUserFor(null, 'SUPERADMIN');
    });

    it('superadmin creates an active tenant and its admin gets a 7-day invitation', async () => {
      const tenant = await createTenantAsSuperadmin(root, registration());
      expect(tenant.status).toBe('ACTIVE');
      const email = await prisma.emailLog.findFirstOrThrow();
      expect(email.bodyText).toContain('https://nueva.app.test/acceso/enlace?token=');
    });

    it('lists tenant metadata and suspends / reactivates', async () => {
      const tenant = await createTenant({ slug: 'perez' });
      expect((await listTenants(root)).map((t) => t.slug)).toContain('perez');

      await setTenantStatus(root, tenant.id, 'SUSPENDED');
      expect(await resolveTenant('perez.app.test')).toBeNull();
      await setTenantStatus(root, tenant.id, 'ACTIVE');
      expect(await resolveTenant('perez.app.test')).not.toBeNull();
    });

    it('is closed to tenant users, including admins', async () => {
      const admin = await sessionUserFor((await createTenant()).id, 'TENANT_ADMIN');
      await expect(listTenants(admin)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(createTenantAsSuperadmin(admin, registration())).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(setTenantStatus(admin, admin.tenantId!, 'SUSPENDED')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('tenant settings', () => {
    let tenantId: string;
    let admin: SessionUser;
    beforeEach(async () => {
      tenantId = (await createTenant()).id;
      admin = await sessionUserFor(tenantId, 'TENANT_ADMIN');
    });

    it('updates the profile, validating the CIF', async () => {
      await updateTenantProfile(admin, {
        name: 'Pérez & Asociados',
        taxId: 'b-12345674',
        city: 'Valencia',
      });
      expect(await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).toMatchObject({
        name: 'Pérez & Asociados',
        taxId: 'B12345674',
        city: 'Valencia',
      });
      await expect(
        updateTenantProfile(admin, { name: 'Pérez', taxId: 'B12345675' }),
      ).rejects.toThrow(/NIF/);
    });

    it('only the admin changes settings and branding', async () => {
      const supervisor = await sessionUserFor(tenantId, 'SUPERVISOR');
      await expect(updateTenantProfile(supervisor, { name: 'Otra cosa' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(updateBranding(supervisor, { primaryColor: '#000000' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(completeOnboarding(supervisor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('stores colors and a logo, trusting the bytes and not the file name', async () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
      const branding = await updateBranding(admin, {
        primaryColor: '#0055aa',
        logo: { name: 'logo.png', bytes: png },
      });

      expect(branding).toMatchObject({ primaryColor: '#0055aa' });
      const file = await prisma.storedFile.findUniqueOrThrow({
        where: { id: branding.logoFileId },
      });
      expect(file).toMatchObject({
        tenantId,
        kind: 'BRANDING',
        mimeType: 'image/png',
        sizeBytes: png.length,
      });
      expect(putObject).toHaveBeenCalledWith(file.storageKey, png, 'image/png');
      expect(file.storageKey.startsWith(`${tenantId}/branding/`)).toBe(true);

      const svg = new TextEncoder().encode('<svg onload="alert(1)"/>');
      await expect(
        updateBranding(admin, { logo: { name: 'logo.png', bytes: svg } }),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      await expect(updateBranding(admin, { primaryColor: 'red' })).rejects.toThrow();

      // WebP is refused: the file pipeline and the PDFs cannot handle it (the form converts it first).
      const webp = new Uint8Array(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'));
      await expect(
        updateBranding(admin, { logo: { name: 'logo.webp', bytes: webp } }),
      ).rejects.toMatchObject({ userMessage: 'El logo debe ser una imagen PNG o JPG.' });

      // Changing only the logo keeps the colours that were there.
      const again = await updateBranding(admin, { logo: { name: 'otro.png', bytes: png } });
      expect(again).toMatchObject({ primaryColor: '#0055aa' });
      expect(again.logoFileId).not.toBe(branding.logoFileId);
    });

    it('sample data: created once, removable with one call, leaving nothing behind', async () => {
      expect(await createSampleData(admin)).toBe(3);
      expect(await createSampleData(admin)).toBe(0);
      expect(await prisma.obligation.count({ where: { tenantId } })).toBeGreaterThan(0);

      expect(await deleteSampleData(admin)).toBe(3);
      expect(await prisma.client.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.obligation.count({ where: { tenantId } })).toBe(0);
    });

    it('deleting sample data never touches real clients', async () => {
      await createSampleData(admin);
      await prisma.client.create({
        data: { tenantId, legalName: 'Cliente real', taxId: '12345678Z', inboundEmailCode: 'real' },
      });
      await deleteSampleData(admin);
      expect(
        (await prisma.client.findMany({ where: { tenantId } })).map((c) => c.legalName),
      ).toEqual(['Cliente real']);
    });
  });
});
