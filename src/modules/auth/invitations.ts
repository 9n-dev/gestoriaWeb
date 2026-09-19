import type { Role, User } from '@prisma/client';
import { z } from 'zod';
import { prisma, tenantDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { AppError } from '@/lib/errors';
import { recordAudit } from '@/modules/audit/service';
import { loadForStaff, resourceOf } from '@/modules/clients/service';
import { renderTemplate, resolveTemplate } from '@/modules/obligations/reminders/templates';
import { tenantBaseUrl } from '@/modules/tenants/resolve';
import { hashPassword } from './password';
import { assertCan, requireTenantId, type SessionUser } from './permissions';
import { emailSchema } from './schema';
import { issueLoginToken } from './service';

const INVITATION_MS = 7 * 24 * 3_600_000;
const STAFF_ROLES = ['MANAGER', 'SUPERVISOR', 'TENANT_ADMIN'] as const satisfies readonly Role[];

const nameSchema = z.string().trim().min(2, 'Indica el nombre.').max(120);
export const staffInvitationSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  role: z.enum(STAFF_ROLES, 'Selecciona un rol.'),
});
export const clientInvitationSchema = z.object({ email: emailSchema, name: nameSchema });
export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .max(200);

/** Emails a 7-day, single-use link. Accepting it activates the account (see consumeMagicLink). */
async function sendInvitation(
  tenantId: string,
  invited: User,
  invitedBy: SessionUser,
): Promise<void> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const token = await issueLoginToken(tenantId, invited.email, INVITATION_MS);
  const template = await resolveTemplate(tenantId, 'auth.invitation');
  const variables = {
    nombre: invited.name,
    gestoria: tenant.name,
    enlace: `${tenantBaseUrl(tenant)}/acceso/enlace?token=${token}`,
  };
  await sendEmail({
    tenantId,
    to: invited.email,
    templateKey: 'auth.invitation',
    subject: renderTemplate(template.subject, variables),
    text: renderTemplate(template.body, variables),
  });
  await recordAudit({
    tenantId,
    actor: invitedBy,
    action: 'user.invite',
    entity: 'User',
    entityId: invited.id,
    diff: { role: invited.role },
  });
}

export async function inviteStaff(
  user: SessionUser,
  input: z.input<typeof staffInvitationSchema>,
): Promise<User> {
  assertCan(user, 'user.manage');
  const tenantId = requireTenantId(user);
  const data = staffInvitationSchema.parse(input);
  const db = tenantDb(tenantId);

  if (await db.user.findFirst({ where: { email: data.email } })) {
    throw new AppError('CONFLICT', `Ya hay un usuario con el correo ${data.email}.`);
  }
  const invited = await db.user.create({ data: { tenantId, ...data, status: 'INVITED' } });
  await sendInvitation(tenantId, invited, user);
  return invited;
}

/** Gives a person access to a client. An existing client user is linked, never duplicated. */
export async function inviteClientUser(
  user: SessionUser,
  clientId: string,
  input: z.input<typeof clientInvitationSchema>,
): Promise<User> {
  const client = await loadForStaff(user, clientId);
  assertCan(user, 'client.inviteUser', resourceOf(client));
  const tenantId = client.tenantId;
  const data = clientInvitationSchema.parse(input);
  const db = tenantDb(tenantId);

  let invited = await db.user.findFirst({ where: { email: data.email } });
  if (invited && invited.role !== 'CLIENT_USER') {
    throw new AppError(
      'VALIDATION',
      `${data.email} pertenece al equipo de la gestoría y no puede ser usuario de un cliente.`,
    );
  }
  invited ??= await db.user.create({
    data: { tenantId, ...data, role: 'CLIENT_USER', status: 'INVITED' },
  });

  await db.clientUser.upsert({
    where: { clientId_userId: { clientId, userId: invited.id } },
    create: { tenantId, clientId, userId: invited.id },
    update: {},
  });
  if (invited.status === 'INVITED') await sendInvitation(tenantId, invited, user);
  return invited;
}

export type BulkInvitationReport = {
  invited: number;
  skipped: Array<{ legalName: string; reason: string }>;
};

/** Onboarding step: invites the contact email of every given client that has no users yet (§6.1). */
export async function inviteClientsInBulk(
  user: SessionUser,
  clientIds: string[],
): Promise<BulkInvitationReport> {
  const report: BulkInvitationReport = { invited: 0, skipped: [] };
  for (const clientId of clientIds) {
    const client = await loadForStaff(user, clientId);
    const hasUsers = await tenantDb(client.tenantId).clientUser.count({ where: { clientId } });
    if (hasUsers > 0)
      report.skipped.push({ legalName: client.legalName, reason: 'Ya tiene usuarios.' });
    else if (!client.email)
      report.skipped.push({ legalName: client.legalName, reason: 'No tiene correo electrónico.' });
    else {
      await inviteClientUser(user, clientId, { email: client.email, name: client.legalName });
      report.invited++;
    }
  }
  return report;
}

export async function resendInvitation(user: SessionUser, userId: string): Promise<void> {
  const tenantId = requireTenantId(user);
  const db = tenantDb(tenantId);
  const invited = await db.user.findFirst({
    where: { id: userId, status: 'INVITED' },
    include: { clientLinks: { select: { clientId: true } } },
  });
  if (!invited) throw new AppError('NOT_FOUND', 'Esa invitación ya no está pendiente.');

  // Staff invitations belong to the admin; client invitations to whoever manages one of its clients.
  if (invited.role === 'CLIENT_USER') {
    const clients = await Promise.all(
      invited.clientLinks.map((link) => loadForStaff(user, link.clientId).catch(() => null)),
    );
    const client = clients.find((c) => c !== null);
    if (!client) throw new AppError('NOT_FOUND', 'Esa invitación ya no está pendiente.');
    assertCan(user, 'client.inviteUser', resourceOf(client));
  } else {
    assertCan(user, 'user.manage');
  }
  await sendInvitation(tenantId, invited, user);
}

/** Self-service: invited users arrive without a password and may set one. */
export async function setOwnPassword(user: SessionUser, password: string): Promise<void> {
  assertCan(user, 'account.update', { tenantId: user.tenantId ?? '', ownerUserId: user.id });
  const passwordHash = await hashPassword(passwordSchema.parse(password));
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  await recordAudit({
    tenantId: user.tenantId,
    actor: user,
    action: 'account.setPassword',
    entity: 'User',
    entityId: user.id,
  });
}

const userListSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  lastLoginAt: true,
} as const;

export async function listStaff(user: SessionUser) {
  assertCan(user, 'user.manage');
  return tenantDb(requireTenantId(user)).user.findMany({
    where: { role: { in: [...STAFF_ROLES] } },
    select: userListSelect,
    orderBy: { name: 'asc' },
  });
}

/** People with access to a client, for whoever may invite more. */
export async function listClientUsers(user: SessionUser, clientId: string) {
  const client = await loadForStaff(user, clientId);
  assertCan(user, 'client.inviteUser', resourceOf(client));
  return tenantDb(client.tenantId).user.findMany({
    where: { clientLinks: { some: { clientId } } },
    select: userListSelect,
    orderBy: { name: 'asc' },
  });
}
