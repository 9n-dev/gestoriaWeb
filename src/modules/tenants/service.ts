import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type Tenant } from '@prisma/client';
import { prisma, tenantDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { AppError } from '@/lib/errors';
import { enqueue, QUEUES } from '@/lib/queue';
import { putObject } from '@/lib/storage/objects';
import { recordAudit } from '@/modules/audit/service';
import { brandingWarnings, type ContrastWarning } from '@/modules/branding/contrast';
import { assertCan, requireTenantId, type SessionUser } from '@/modules/auth/permissions';
import { issueLoginToken } from '@/modules/auth/service';
import { strictReminderSettingsSchema } from '@/modules/obligations/reminders/templates';
import { syncObligationsForClient } from '@/modules/obligations/service';
import { platformBaseUrl, tenantBaseUrl } from './resolve';
import {
  brandingSchema,
  parseBranding,
  tenantProfileSchema,
  tenantRegistrationSchema,
  type Branding,
  type TenantProfileInput,
  type TenantRegistration,
} from './schema';

const VERIFICATION_MS = 48 * 3_600_000;
const INVITATION_MS = 7 * 24 * 3_600_000;
const FIRST_LOGIN_MS = 15 * 60_000;
const MAX_LOGO_BYTES = 1024 * 1024;

async function provisionTenant(
  input: TenantRegistration,
  status: 'PENDING_VERIFICATION' | 'ACTIVE',
) {
  const data = tenantRegistrationSchema.parse(input);
  try {
    return await prisma.tenant.create({
      data: {
        name: data.name,
        slug: data.slug,
        status,
        contactEmail: data.adminEmail,
        users: {
          create: {
            email: data.adminEmail,
            name: data.adminName,
            role: 'TENANT_ADMIN',
            status: 'INVITED',
          },
        },
      },
      include: { users: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('CONFLICT', 'Esa dirección ya está en uso. Elige otra.', undefined, error);
    }
    throw error;
  }
}

/** Self-service sign-up (§6.1). The tenant stays PENDING_VERIFICATION until the email is confirmed. */
export async function registerTenant(input: TenantRegistration): Promise<void> {
  const tenant = await provisionTenant(input, 'PENDING_VERIFICATION');
  const admin = tenant.users[0]!;
  const token = await issueLoginToken(tenant.id, admin.email, VERIFICATION_MS);

  await sendEmail({
    tenantId: tenant.id,
    to: admin.email,
    templateKey: 'tenant.verify',
    subject: 'Confirma tu correo para activar el portal de tu gestoría',
    text: [
      `Hola, ${admin.name}:`,
      '',
      `Para activar el portal de ${tenant.name}, confirma tu correo con este enlace (válido 48 horas):`,
      `${platformBaseUrl()}/registro/verificar?token=${token}`,
    ].join('\n'),
  });
  await recordAudit({
    tenantId: tenant.id,
    action: 'tenant.register',
    entity: 'Tenant',
    entityId: tenant.id,
  });
}

/**
 * Confirms the admin's email, activates the tenant and returns a one-time login URL on the
 * tenant's own host, where the onboarding wizard starts.
 */
export async function verifyTenantRegistration(token: string): Promise<string> {
  const invalid = () =>
    new AppError('VALIDATION', 'El enlace no es válido o ha caducado. Vuelve a registrarte.');
  const hash = createHash('sha256').update(token).digest('hex');
  const record = await prisma.verificationToken
    .delete({ where: { token: hash } })
    .catch(() => null);
  if (!record || record.expires <= new Date()) throw invalid();

  const [tenantId, ...emailParts] = record.identifier.split(':');
  const email = emailParts.join(':');
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, status: 'PENDING_VERIFICATION' },
  });
  if (!tenant) throw invalid();

  await prisma.$transaction([
    prisma.tenant.update({ where: { id: tenant.id }, data: { status: 'ACTIVE' } }),
    prisma.user.updateMany({
      where: { tenantId: tenant.id, email },
      data: { status: 'ACTIVE', emailVerifiedAt: new Date() },
    }),
  ]);
  await recordAudit({
    tenantId: tenant.id,
    action: 'tenant.verify',
    entity: 'Tenant',
    entityId: tenant.id,
  });

  const login = await issueLoginToken(tenant.id, email, FIRST_LOGIN_MS);
  return `${tenantBaseUrl(tenant)}/acceso/enlace?token=${login}`;
}

/** Superadmin creates the tenant already active; its admin receives a 7-day invitation. */
export async function createTenantAsSuperadmin(
  user: SessionUser,
  input: TenantRegistration,
): Promise<Tenant> {
  assertCan(user, 'platform.tenant.create');
  const tenant = await provisionTenant(input, 'ACTIVE');
  const admin = tenant.users[0]!;
  const token = await issueLoginToken(tenant.id, admin.email, INVITATION_MS);
  await sendEmail({
    tenantId: tenant.id,
    to: admin.email,
    templateKey: 'tenant.welcome',
    subject: `El portal de ${tenant.name} ya está listo`,
    text: [
      `Hola, ${admin.name}:`,
      '',
      `Hemos creado el portal de clientes de ${tenant.name}. Entra con este enlace (válido 7 días) para configurarlo:`,
      `${tenantBaseUrl(tenant)}/acceso/enlace?token=${token}`,
    ].join('\n'),
  });
  await recordAudit({
    tenantId: null,
    actor: user,
    action: 'platform.tenant.create',
    entity: 'Tenant',
    entityId: tenant.id,
  });
  return tenant;
}

/** Platform view: tenant metadata only, never client data (§4). */
export async function listTenants(user: SessionUser) {
  assertCan(user, 'platform.tenant.list');
  return prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      plan: true,
      createdAt: true,
      _count: { select: { clients: true, users: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function setTenantStatus(
  user: SessionUser,
  tenantId: string,
  status: 'ACTIVE' | 'SUSPENDED',
): Promise<void> {
  assertCan(user, 'platform.tenant.suspend');
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
  });
  if (!tenant) throw new AppError('NOT_FOUND', 'No encontramos esa gestoría.');
  await prisma.tenant.update({ where: { id: tenantId }, data: { status } });
  await recordAudit({
    tenantId: null,
    actor: user,
    action: 'platform.tenant.setStatus',
    entity: 'Tenant',
    entityId: tenantId,
    diff: { before: tenant.status, after: status },
  });
}

// ─────────────────────────── Tenant settings ───────────────────────────

export async function getOwnTenant(user: SessionUser): Promise<Tenant> {
  assertCan(user, 'tenantSettings.manage');
  return prisma.tenant.findUniqueOrThrow({ where: { id: requireTenantId(user) } });
}

export async function updateTenantProfile(
  user: SessionUser,
  input: TenantProfileInput,
): Promise<void> {
  assertCan(user, 'tenantSettings.manage');
  const tenantId = requireTenantId(user);
  const data = tenantProfileSchema.parse(input);
  await prisma.tenant.update({ where: { id: tenantId }, data });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'tenant.updateProfile',
    entity: 'Tenant',
    entityId: tenantId,
    diff: data,
  });
}

const IMAGE_SIGNATURES: Array<{
  mime: string;
  extension: string;
  matches: (b: Uint8Array) => boolean;
}> = [
  {
    mime: 'image/png',
    extension: 'png',
    matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/jpeg',
    extension: 'jpg',
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/webp',
    extension: 'webp',
    matches: (b) =>
      String.fromCharCode(...b.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
  },
];

type ImageInput = { name: string; bytes: Uint8Array };
export type BrandingInput = {
  primaryColor?: string;
  accentColor?: string;
  senderName?: string;
  logo?: ImageInput;
  favicon?: ImageInput;
};

/** Stores a branding image. Its type comes from the bytes, never from the file name; SVG is refused. */
async function storeBrandingImage(
  tenantId: string,
  image: ImageInput,
  label: string,
): Promise<string> {
  const { bytes } = image;
  const type = IMAGE_SIGNATURES.find((signature) => signature.matches(bytes));
  if (!type) throw new AppError('VALIDATION', `${label} debe ser una imagen PNG, JPG o WebP.`);
  if (bytes.length > MAX_LOGO_BYTES)
    throw new AppError('VALIDATION', `${label} no puede superar 1 MB.`);

  const storageKey = `${tenantId}/branding/${randomUUID()}.${type.extension}`;
  await putObject(storageKey, bytes, type.mime);
  const file = await tenantDb(tenantId).storedFile.create({
    data: {
      tenantId,
      kind: 'BRANDING',
      status: 'UPLOADED',
      storageKey,
      originalName: image.name.slice(0, 200),
      mimeType: type.mime,
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  });
  // Same antivirus pipeline as client documents; an infected image is removed by the worker.
  await enqueue(QUEUES.files, 'process', { tenantId, fileId: file.id }, file.id);
  return file.id;
}

/** Colours, logo, favicon and sender name (§6.12). Contrast problems are reported, not blocked. */
export async function updateBranding(
  user: SessionUser,
  input: BrandingInput,
): Promise<Branding & { warnings: ContrastWarning[] }> {
  assertCan(user, 'branding.manage');
  const tenantId = requireTenantId(user);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const branding: Branding = {
    ...parseBranding(tenant.branding),
    ...brandingSchema.pick({ primaryColor: true, accentColor: true, senderName: true }).parse({
      primaryColor: input.primaryColor || undefined,
      accentColor: input.accentColor || undefined,
      senderName: input.senderName?.trim() || undefined,
    }),
  };
  if (input.logo?.bytes.length)
    branding.logoFileId = await storeBrandingImage(tenantId, input.logo, 'El logo');
  if (input.favicon?.bytes.length) {
    branding.faviconFileId = await storeBrandingImage(tenantId, input.favicon, 'El icono');
  }

  await prisma.tenant.update({ where: { id: tenantId }, data: { branding } });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'tenant.updateBranding',
    entity: 'Tenant',
    entityId: tenantId,
    diff: branding,
  });
  return { ...branding, warnings: brandingWarnings(branding) };
}

/** Reminder offsets, on/off switch and inactivity threshold (§6.6, §6.9). */
export async function updateReminderSettings(user: SessionUser, input: unknown): Promise<void> {
  assertCan(user, 'tenantSettings.manage');
  const tenantId = requireTenantId(user);
  const settings = strictReminderSettingsSchema.parse(input);
  await prisma.tenant.update({ where: { id: tenantId }, data: { reminderSettings: settings } });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'tenant.updateReminderSettings',
    entity: 'Tenant',
    entityId: tenantId,
    diff: settings,
  });
}

export async function completeOnboarding(user: SessionUser): Promise<void> {
  assertCan(user, 'tenantSettings.manage');
  const tenantId = requireTenantId(user);
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { onboardingCompletedAt: new Date() },
  });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'tenant.completeOnboarding',
    entity: 'Tenant',
    entityId: tenantId,
  });
}

// ─────────────────────────── Sample data (§6.1) ───────────────────────────

// Synthetic, valid tax ids that no real person or company holds.
const SAMPLE_CLIENTS = [
  {
    legalName: 'Ejemplo · Laura Diseño Gráfico',
    taxId: '00000001R',
    profile: 'Autónomo · Estimación directa',
  },
  { legalName: 'Ejemplo · Bar El Puerto', taxId: '00000002W', profile: 'Autónomo · Módulos' },
  {
    legalName: 'Ejemplo · Reformas Levante, S.L.',
    taxId: 'B00000018',
    profile: 'Sociedad limitada con trabajadores y local',
  },
];

export async function createSampleData(user: SessionUser): Promise<number> {
  assertCan(user, 'sampleData.delete');
  const tenantId = requireTenantId(user);
  const db = tenantDb(tenantId);
  let created = 0;
  for (const sample of SAMPLE_CLIENTS) {
    if (await db.client.findFirst({ where: { taxId: sample.taxId } })) continue;
    const profile = await prisma.taxProfile.findFirst({
      where: { tenantId: null, name: sample.profile },
    });
    const client = await db.client.create({
      data: {
        tenantId,
        legalName: sample.legalName,
        taxId: sample.taxId,
        taxProfileId: profile?.id,
        assignedManagerId: user.id,
        inboundEmailCode: `ejemplo-${randomUUID().slice(0, 8)}`,
        isSample: true,
      },
    });
    await syncObligationsForClient(tenantId, client.id);
    created++;
  }
  await recordAudit({
    tenantId,
    actor: user,
    action: 'sampleData.create',
    entity: 'Tenant',
    entityId: tenantId,
    diff: { created },
  });
  return created;
}

/** One button removes every sample client and, by cascade, everything hanging from them. */
export async function deleteSampleData(user: SessionUser): Promise<number> {
  assertCan(user, 'sampleData.delete');
  const tenantId = requireTenantId(user);
  const { count } = await tenantDb(tenantId).client.deleteMany({ where: { isSample: true } });
  await recordAudit({
    tenantId,
    actor: user,
    action: 'sampleData.delete',
    entity: 'Tenant',
    entityId: tenantId,
    diff: { deleted: count },
  });
  return count;
}

export const hasSampleData = async (tenantId: string): Promise<boolean> =>
  (await tenantDb(tenantId).client.count({ where: { isSample: true } })) > 0;
