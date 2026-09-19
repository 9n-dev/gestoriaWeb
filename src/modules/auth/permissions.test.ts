import type { Role } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { assertCan, can, type Resource, type SessionUser } from './permissions';

const user = (role: Role, overrides: Partial<SessionUser> = {}): SessionUser => ({
  id: `u-${role}`,
  tenantId: role === 'SUPERADMIN' ? null : 'tenant-a',
  role,
  status: 'ACTIVE',
  clientIds: role === 'CLIENT_USER' ? ['client-1'] : [],
  supportTenantIds: [],
  ...overrides,
});

const clientUser = user('CLIENT_USER');
const manager = user('MANAGER');
const supervisor = user('SUPERVISOR');
const admin = user('TENANT_ADMIN');
const superadmin = user('SUPERADMIN');
const tenantRoles = [clientUser, manager, supervisor, admin];

/** A resource of client-1 in tenant-a, assigned to the manager above. */
const res = (overrides: Partial<Resource> = {}): Resource => ({
  tenantId: 'tenant-a',
  clientId: 'client-1',
  assignedManagerId: manager.id,
  ...overrides,
});

describe('can()', () => {
  it('denies everything to users that are not active', () => {
    expect(can(user('TENANT_ADMIN', { status: 'DISABLED' }), 'client.read', res())).toBe(false);
    expect(can(user('CLIENT_USER', { status: 'INVITED' }), 'document.upload', res())).toBe(false);
  });

  it('denies every role across tenants', () => {
    for (const u of tenantRoles) {
      expect(can(u, 'client.read', res({ tenantId: 'tenant-b' }))).toBe(false);
      expect(can(u, 'document.read', res({ tenantId: 'tenant-b' }))).toBe(false);
    }
  });

  it('scopes CLIENT_USER to its own clients', () => {
    expect(can(clientUser, 'document.upload', res())).toBe(true);
    expect(can(clientUser, 'document.read', res({ clientId: 'client-2' }))).toBe(false);
    expect(can(clientUser, 'document.process', res())).toBe(false);
  });

  it('scopes MANAGER to assigned clients', () => {
    expect(can(manager, 'document.process', res())).toBe(true);
    expect(can(manager, 'document.process', res({ assignedManagerId: 'someone-else' }))).toBe(
      false,
    );
    expect(can(manager, 'document.process', res({ assignedManagerId: null }))).toBe(false);
  });

  it('gives SUPERVISOR and TENANT_ADMIN the whole tenant', () => {
    for (const u of [supervisor, admin]) {
      expect(can(u, 'document.process', res({ assignedManagerId: 'someone-else' }))).toBe(true);
      expect(can(u, 'client.assignManager', res())).toBe(true);
    }
    expect(can(manager, 'client.assignManager', res())).toBe(false);
  });

  it('lets managers create clients but not import them (ADR 0012)', () => {
    expect(can(manager, 'client.create')).toBe(true);
    expect(can(manager, 'client.import')).toBe(false);
    expect(can(supervisor, 'client.import')).toBe(true);
    expect(can(clientUser, 'client.create')).toBe(false);
  });

  it('keeps billing management with TENANT_ADMIN; managers only read assigned invoices', () => {
    expect(can(admin, 'invoice.manage', res())).toBe(true);
    expect(can(supervisor, 'invoice.manage', res())).toBe(false);
    expect(can(manager, 'invoice.read', res())).toBe(true);
    expect(can(manager, 'invoice.read', res({ assignedManagerId: 'someone-else' }))).toBe(false);
    expect(can(clientUser, 'invoice.pay', res())).toBe(true);
    expect(can(admin, 'invoice.pay', res())).toBe(false);
  });

  it('keeps tenant administration with TENANT_ADMIN', () => {
    for (const action of [
      'user.manage',
      'branding.manage',
      'audit.read',
      'data.exportTenant',
    ] as const) {
      expect(can(admin, action)).toBe(true);
      expect(can(supervisor, action)).toBe(false);
      expect(can(manager, action)).toBe(false);
      expect(can(clientUser, action)).toBe(false);
    }
  });

  it('DELINQUENT clients can upload but not download', () => {
    const delinquent = res({ clientStatus: 'DELINQUENT' });
    expect(can(clientUser, 'document.upload', delinquent)).toBe(true);
    expect(can(clientUser, 'document.download', delinquent)).toBe(false);
    expect(can(clientUser, 'delivery.download', delinquent)).toBe(false);
    expect(can(manager, 'document.download', delinquent)).toBe(true);
    expect(can(clientUser, 'invoice.download', delinquent)).toBe(true); // they need it to pay
  });

  it('a closed period blocks client uploads, not staff uploads', () => {
    expect(can(clientUser, 'document.upload', res({ periodClosed: true }))).toBe(false);
    expect(can(manager, 'document.upload', res({ periodClosed: true }))).toBe(true);
  });

  it('files that are not CLEAN are never downloadable', () => {
    for (const fileStatus of ['PENDING', 'UPLOADED', 'INFECTED'] as const) {
      for (const u of tenantRoles) {
        expect(can(u, 'document.download', res({ fileStatus }))).toBe(false);
      }
    }
    expect(can(admin, 'document.download', res({ fileStatus: 'CLEAN' }))).toBe(true);
  });

  it('never shows internal resources to CLIENT_USER', () => {
    expect(can(clientUser, 'thread.read', res({ internal: true }))).toBe(false);
    expect(can(clientUser, 'thread.readInternal', res())).toBe(false);
    expect(can(clientUser, 'client.readInternalNotes', res())).toBe(false);
    expect(can(manager, 'thread.readInternal', res({ internal: true }))).toBe(true);
  });

  it('hides deliveries from clients until visibleFrom', () => {
    const future = new Date(Date.now() + 86_400_000);
    expect(can(clientUser, 'delivery.read', res({ visibleFrom: future }))).toBe(false);
    expect(can(manager, 'delivery.read', res({ visibleFrom: future }))).toBe(true);
    expect(can(clientUser, 'delivery.read', res({ visibleFrom: new Date(0) }))).toBe(true);
  });

  it('clients delete their own documents only while RECEIVED', () => {
    expect(can(clientUser, 'document.delete', res({ documentStatus: 'RECEIVED' }))).toBe(true);
    expect(can(clientUser, 'document.delete', res({ documentStatus: 'BOOKED' }))).toBe(false);
    expect(can(manager, 'document.delete', res({ documentStatus: 'BOOKED' }))).toBe(true);
  });

  it('only clients sign deliveries', () => {
    expect(can(clientUser, 'delivery.sign', res())).toBe(true);
    expect(can(admin, 'delivery.sign', res())).toBe(false);
  });

  it('self-service actions only apply to the own account', () => {
    expect(can(manager, 'account.update', { tenantId: 'tenant-a', ownerUserId: manager.id })).toBe(
      true,
    );
    expect(can(manager, 'account.update', { tenantId: 'tenant-a', ownerUserId: 'other' })).toBe(
      false,
    );
  });

  describe('SUPERADMIN', () => {
    const supporting = user('SUPERADMIN', { supportTenantIds: ['tenant-a'] });

    it('manages the platform', () => {
      expect(can(superadmin, 'platform.tenant.create')).toBe(true);
      expect(can(admin, 'platform.tenant.create')).toBe(false);
    });

    it('has no access to tenant data without a support grant', () => {
      expect(can(superadmin, 'client.read', res())).toBe(false);
      expect(can(superadmin, 'document.read', res())).toBe(false);
    });

    it('gets read-only access, without downloads, under a support grant', () => {
      expect(can(supporting, 'client.read', res())).toBe(true);
      expect(can(supporting, 'document.read', res())).toBe(true);
      expect(can(supporting, 'document.download', res())).toBe(false);
      expect(can(supporting, 'client.update', res())).toBe(false);
      expect(can(supporting, 'client.read', res({ tenantId: 'tenant-b' }))).toBe(false);
    });
  });
});

describe('assertCan()', () => {
  it('throws a FORBIDDEN AppError', () => {
    expect(() => assertCan(clientUser, 'document.process', res())).toThrowError(AppError);
    try {
      assertCan(clientUser, 'document.process', res());
    } catch (error) {
      expect((error as AppError).code).toBe('FORBIDDEN');
    }
    expect(() => assertCan(manager, 'document.process', res())).not.toThrow();
  });
});
