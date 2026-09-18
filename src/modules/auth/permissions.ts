import type { ClientStatus, DocumentStatus, FileStatus, Role, UserStatus } from '@prisma/client';
import { AppError } from '@/lib/errors';

/** The authenticated user as the rest of the app sees it (built by modules/auth/session.ts). */
export type SessionUser = {
  id: string;
  tenantId: string | null;
  role: Role;
  status: UserStatus;
  /** Clients a CLIENT_USER is linked to. */
  clientIds: string[];
  /** Tenants with an active SupportAccessGrant. Only ever filled for SUPERADMIN. */
  supportTenantIds: string[];
};

/**
 * What `can()` needs to know about the target. Services load the entity through a
 * tenant-scoped repository and describe it here; `can()` never touches the database.
 */
export type Resource = {
  tenantId: string;
  clientId?: string;
  assignedManagerId?: string | null;
  clientStatus?: ClientStatus;
  periodClosed?: boolean;
  fileStatus?: FileStatus;
  documentStatus?: DocumentStatus;
  /** INTERNAL threads and their messages. */
  internal?: boolean;
  visibleFrom?: Date;
  /** Owner of account-level resources (profile, sessions, notifications). */
  ownerUserId?: string;
};

/**
 * own      → resource.clientId is one of the user's clients
 * assigned → the client is assigned to this manager
 * all      → anywhere in the user's tenant
 * self     → the user's own account
 * platform → not tenant data
 */
export type Scope = 'own' | 'assigned' | 'all' | 'self' | 'platform';
type Grants = Partial<Record<Role, Scope>>;

const STAFF: Grants = { MANAGER: 'assigned', SUPERVISOR: 'all', TENANT_ADMIN: 'all' };
const CLIENT_AND_STAFF: Grants = { CLIENT_USER: 'own', ...STAFF };
const ANY_STAFF: Grants = { MANAGER: 'all', SUPERVISOR: 'all', TENANT_ADMIN: 'all' };
const LEADS: Grants = { SUPERVISOR: 'all', TENANT_ADMIN: 'all' };
const ADMIN: Grants = { TENANT_ADMIN: 'all' };
const CLIENT_ONLY: Grants = { CLIENT_USER: 'own' };
const SELF: Grants = {
  CLIENT_USER: 'self',
  MANAGER: 'self',
  SUPERVISOR: 'self',
  TENANT_ADMIN: 'self',
  SUPERADMIN: 'self',
};
const PLATFORM: Grants = { SUPERADMIN: 'platform' };

// Mirrors docs/foundation.md §3. Changing a permission is a one-line change here plus its test.
const MATRIX = {
  // Areas of the app (route-group layouts and post-login redirect)
  'area.client': CLIENT_ONLY,
  'area.staff': ANY_STAFF,
  'area.platform': PLATFORM,
  // Clients
  'client.read': CLIENT_AND_STAFF,
  'client.create': ANY_STAFF, // a manager's new client is auto-assigned to them
  'client.import': LEADS,
  'client.update': STAFF,
  'client.delete': LEADS,
  'client.assignManager': LEADS,
  'client.assignTaxProfile': STAFF,
  'client.readInternalNotes': STAFF,
  'client.writeInternalNotes': STAFF,
  'client.inviteUser': STAFF,
  'client.removeUser': STAFF,
  // Documents
  'document.upload': CLIENT_AND_STAFF,
  'document.read': CLIENT_AND_STAFF,
  'document.download': CLIENT_AND_STAFF,
  'document.process': STAFF,
  'document.delete': CLIENT_AND_STAFF,
  'document.export': STAFF,
  'permanentDocument.read': CLIENT_AND_STAFF,
  'permanentDocument.download': CLIENT_AND_STAFF,
  'permanentDocument.manage': STAFF,
  // Obligations & checklist
  'obligation.read': CLIENT_AND_STAFF,
  'obligation.update': STAFF,
  'checklist.read': CLIENT_AND_STAFF,
  'checklist.manage': STAFF,
  'period.close': STAFF,
  'period.reopen': STAFF,
  'reminder.sendManual': STAFF,
  // Messaging
  'thread.read': CLIENT_AND_STAFF,
  'thread.create': CLIENT_AND_STAFF,
  'message.send': CLIENT_AND_STAFF,
  'thread.readInternal': STAFF,
  'message.sendInternal': STAFF,
  'thread.close': STAFF,
  'messageTemplate.use': ANY_STAFF,
  // Deliveries
  'delivery.read': CLIENT_AND_STAFF,
  'delivery.download': CLIENT_AND_STAFF,
  'delivery.sign': CLIENT_ONLY,
  'delivery.create': STAFF,
  'delivery.delete': STAFF,
  'delivery.viewHistory': STAFF,
  // Billing (gestoría → client)
  'invoice.read': CLIENT_AND_STAFF,
  'invoice.download': CLIENT_AND_STAFF,
  'invoice.pay': CLIENT_ONLY,
  'invoice.manage': ADMIN,
  'recurringFee.manage': ADMIN,
  // Dashboards
  'dashboard.viewOwn': ANY_STAFF,
  'dashboard.viewGlobal': LEADS,
  'savedView.manage': ANY_STAFF,
  // Tenant administration
  'user.manage': ADMIN,
  'branding.manage': ADMIN,
  'domain.manage': ADMIN,
  'template.manage': ADMIN,
  'taxProfile.read': ANY_STAFF,
  'taxProfile.manage': ADMIN,
  'tenantSettings.manage': ADMIN,
  'audit.read': ADMIN,
  'data.exportClient': ADMIN,
  'data.eraseClient': ADMIN,
  'data.exportTenant': ADMIN,
  'tenant.cancel': ADMIN,
  'support.grant': ADMIN,
  'support.revoke': ADMIN,
  'sampleData.delete': ADMIN,
  // Self-service
  'account.update': SELF,
  'account.manage2fa': SELF,
  'account.revokeSessions': SELF,
  'notification.read': SELF,
  'notification.managePrefs': SELF,
  'push.subscribe': SELF,
  // Platform
  'platform.tenant.list': PLATFORM,
  'platform.tenant.create': PLATFORM,
  'platform.tenant.suspend': PLATFORM,
  'platform.tenant.delete': PLATFORM,
  'platform.jobs.viewFailed': PLATFORM,
  'platform.jobs.retry': PLATFORM,
  'platform.health.view': PLATFORM,
} satisfies Record<string, Grants>;

export type Action = keyof typeof MATRIX;

/** Support mode ("modo soporte") is read-only and never includes downloads (ADR 0012). */
const isSupportReadable = (action: Action) =>
  action.endsWith('.read') || action.startsWith('dashboard.view');

/**
 * Single authorization entry point. Without `resource` only the role is checked ("may this role
 * do this at all?", e.g. to build navigation or to create something new); every operation on an
 * existing entity must pass the resource.
 */
export function can(user: SessionUser, action: Action, resource?: Resource): boolean {
  if (user.status !== 'ACTIVE') return false;

  if (
    user.role === 'SUPERADMIN' &&
    resource &&
    MATRIX[action] !== PLATFORM &&
    MATRIX[action] !== SELF
  ) {
    return user.supportTenantIds.includes(resource.tenantId) && isSupportReadable(action);
  }

  const grants: Grants = MATRIX[action];
  const scope = grants[user.role];
  if (!scope) return false;
  if (!resource) return true;

  // Account-level resources are bound to the user id; everything else to the tenant.
  const tenantBound = scope !== 'platform' && scope !== 'self';
  if (tenantBound && resource.tenantId !== user.tenantId) return false;

  switch (scope) {
    case 'own':
      if (!resource.clientId || !user.clientIds.includes(resource.clientId)) return false;
      break;
    case 'assigned':
      if (resource.assignedManagerId !== user.id) return false;
      break;
    case 'self':
      if (resource.ownerUserId !== user.id) return false;
      break;
  }

  if (action.endsWith('.download') && resource.fileStatus && resource.fileStatus !== 'CLEAN') {
    return false;
  }

  if (user.role === 'CLIENT_USER') {
    if (resource.internal) return false;
    if (action.endsWith('.download') && resource.clientStatus === 'DELINQUENT') return false;
    if (action === 'document.upload' && resource.periodClosed) return false;
    if (action === 'document.delete' && resource.documentStatus !== 'RECEIVED') return false;
    if (resource.visibleFrom && resource.visibleFrom > new Date()) return false;
  }

  return true;
}

/** How far `action` reaches for this user; repositories turn it into a query filter. */
export function scopeFor(user: SessionUser, action: Action): Scope | undefined {
  const grants: Grants = MATRIX[action];
  return user.status === 'ACTIVE' ? grants[user.role] : undefined;
}

export function assertCan(user: SessionUser, action: Action, resource?: Resource): void {
  if (!can(user, action, resource)) {
    throw new AppError(
      'FORBIDDEN',
      'No tienes permiso para realizar esta acción.',
      `user ${user.id} (${user.role}) denied ${action}`,
    );
  }
}
