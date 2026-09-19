import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import * as email from '@/lib/email';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant, createUser, linkClientUser } from '@tests/setup/factories';
import { seedSystemData } from '../../../../prisma/system-data';
import { syncObligationsForClient } from '../service';
import { runTenantDaily } from './service';

const emailsTo = async (address: string) =>
  prisma.emailLog.findMany({ where: { toAddress: address }, orderBy: { createdAt: 'asc' } });

describe('daily tenant job', () => {
  let tenantId: string;
  let managerId: string;
  let clientId: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await resetDb();
    await seedSystemData(prisma);
    tenantId = (await createTenant({ name: 'Gestoría Pérez' })).id;
    managerId = (await createUser(tenantId, 'MANAGER', { email: 'gestor@demo.es' })).id;
    const profile = await prisma.taxProfile.findFirstOrThrow({
      where: { name: 'Autónomo · Estimación directa' },
    });
    clientId = (
      await createClient(tenantId, {
        legalName: 'Marta Soler',
        assignedManagerId: managerId,
        taxProfileId: profile.id,
        lastActivityAt: new Date('2026-10-01'),
      })
    ).id;
    await syncObligationsForClient(tenantId, clientId, { today: '2026-09-01' });
    const person = await createUser(tenantId, 'CLIENT_USER', { email: 'marta@example.com' });
    await linkClientUser(tenantId, clientId, person.id);
  });

  it('reminds at 15, 7, 2 and 0 days, once each, with a different wording and the concrete missing list', async () => {
    expect((await runTenantDaily(tenantId, '2026-10-04')).deadlineReminders).toBe(0);

    const subjects: string[] = [];
    for (const day of ['2026-10-05', '2026-10-13', '2026-10-18', '2026-10-20']) {
      expect((await runTenantDaily(tenantId, day)).deadlineReminders, day).toBe(1);
      expect((await runTenantDaily(tenantId, day)).deadlineReminders, `${day} again`).toBe(0);
      subjects.push((await emailsTo('marta@example.com')).at(-1)!.subject);
    }
    expect(new Set(subjects).size).toBe(4);

    const emails = await emailsTo('marta@example.com');
    expect(emails).toHaveLength(4);
    // One message for both forms due that day, not one per form.
    expect(emails[0]!.bodyText).toContain('130 (3T 2026), 303 (3T 2026)');
    expect(emails[0]!.bodyText).toContain('- Facturas emitidas');
    expect(emails[0]!.bodyText).toContain('- Facturas recibidas y gastos');
    expect(emails[1]!.bodyText).toContain('Quedan 7 días');
    expect(emails[3]!.subject).toContain('Hoy termina el plazo');
    expect(await prisma.notification.count({ where: { type: 'MISSING_DOCS_REMINDER' } })).toBe(4);
  });

  it('says so when nothing is missing, and stays silent for filed obligations', async () => {
    await runTenantDaily(tenantId, '2026-10-04'); // creates the checklist
    await prisma.checklistItem.updateMany({
      where: { clientId },
      data: { fulfilled: true, fulfilledManually: true },
    });
    await runTenantDaily(tenantId, '2026-10-05');
    const [first] = await emailsTo('marta@example.com');
    expect(first!.bodyText).toContain('Ya tenemos toda tu documentación');
    expect(await prisma.notification.count({ where: { type: 'DEADLINE_REMINDER' } })).toBe(1);

    await prisma.obligation.updateMany({ where: { clientId }, data: { status: 'FILED' } });
    expect((await runTenantDaily(tenantId, '2026-10-13')).deadlineReminders).toBe(0);
  });

  it('catches up after a day without worker, and skips clients nobody can read for', async () => {
    const lonely = await createClient(tenantId, {
      taxProfileId: (await prisma.client.findUniqueOrThrow({ where: { id: clientId } }))
        .taxProfileId,
    });
    await syncObligationsForClient(tenantId, lonely.id, { today: '2026-09-01' });

    expect((await runTenantDaily(tenantId, '2026-10-14')).deadlineReminders).toBe(1); // day 13 was missed
    expect((await emailsTo('marta@example.com'))[0]!.bodyText).toContain('Quedan 6 días');
    expect(
      await prisma.reminderLog.count({
        where: {
          entityId: {
            in: (await prisma.obligation.findMany({ where: { clientId: lonely.id } })).map(
              (o) => o.id,
            ),
          },
        },
      }),
    ).toBe(0);
  });

  it('a failed send releases the claim so the retry delivers it', async () => {
    const send = vi.spyOn(email, 'sendEmail').mockRejectedValueOnce(new Error('resend is down'));
    await expect(runTenantDaily(tenantId, '2026-10-05')).rejects.toThrow('resend is down');
    expect(await prisma.reminderLog.count({ where: { kind: 'OBLIGATION_DEADLINE' } })).toBe(0);

    send.mockRestore();
    expect((await runTenantDaily(tenantId, '2026-10-05')).deadlineReminders).toBe(1);
  });

  it('honours tenant settings: disabled, custom offsets', async () => {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { reminderSettings: { enabled: false } },
    });
    expect(await runTenantDaily(tenantId, '2026-10-13')).toEqual({
      deadlineReminders: 0,
      inactivityNotices: 0,
      expiryNotices: 0,
    });
    expect(await prisma.checklistItem.count({ where: { clientId } })).toBeGreaterThan(0); // upkeep still runs

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { reminderSettings: { offsets: [3], inactivityDays: 0 } },
    });
    expect((await runTenantDaily(tenantId, '2026-10-13')).deadlineReminders).toBe(0);
    expect((await runTenantDaily(tenantId, '2026-10-17')).deadlineReminders).toBe(1);
  });

  it("uses the tenant's own template when there is one", async () => {
    await prisma.template.create({
      data: {
        tenantId,
        kind: 'EMAIL',
        key: 'reminder.deadline.7d',
        name: '7 días',
        subject: 'Ojo, {{cliente}}',
        body: 'Te quedan {{dias}} días. {{gestoria}}',
      },
    });
    await runTenantDaily(tenantId, '2026-10-13');
    const [sent] = await emailsTo('marta@example.com');
    expect(sent!.subject).toContain('Ojo, Marta Soler');
    expect(sent!.bodyText).toContain('Te quedan 7 días. Gestoría Pérez');
  });

  it('tells the manager once about each silent streak of a client', async () => {
    expect((await runTenantDaily(tenantId, '2026-10-25')).inactivityNotices).toBe(0); // 24 days
    expect((await runTenantDaily(tenantId, '2026-11-02')).inactivityNotices).toBe(1);
    expect((await runTenantDaily(tenantId, '2026-11-03')).inactivityNotices).toBe(0);
    expect((await emailsTo('gestor@demo.es')).at(-1)!.bodyText).toContain('- Marta Soler');

    // Activity resets the streak; a new silence is reported again.
    await prisma.client.update({
      where: { id: clientId },
      data: { lastActivityAt: new Date('2026-11-04') },
    });
    expect((await runTenantDaily(tenantId, '2026-12-10')).inactivityNotices).toBe(1);
  });

  it('warns about permanent documents 60, 30 and 7 days before they expire', async () => {
    const file = await prisma.storedFile.create({
      data: {
        tenantId,
        kind: 'PERMANENT_DOCUMENT',
        status: 'CLEAN',
        storageKey: 'cert',
        originalName: 'c.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
      },
    });
    await prisma.permanentDocument.create({
      data: {
        tenantId,
        clientId,
        fileId: file.id,
        title: 'Certificado digital',
        expiresAt: new Date('2027-03-01'),
      },
    });

    const days = {
      '2026-12-30': 0,
      '2026-12-31': 1,
      '2027-01-01': 0,
      '2027-01-30': 1,
      '2027-02-22': 1,
      '2027-02-23': 0,
      '2027-03-02': 0,
    };
    for (const [day, expected] of Object.entries(days)) {
      expect((await runTenantDaily(tenantId, day)).expiryNotices, day).toBe(expected);
    }
    expect(
      (await emailsTo('gestor@demo.es')).filter(
        (e) => e.templateKey === 'reminder.permanent_expiry',
      ),
    ).toHaveLength(3);
    expect(
      (await emailsTo('marta@example.com')).filter(
        (e) => e.templateKey === 'reminder.permanent_expiry',
      ),
    ).toHaveLength(3);
  });

  it("generates next year's obligations on 1 December", async () => {
    expect(await prisma.obligation.count({ where: { clientId, period: { year: 2027 } } })).toBe(0);
    await runTenantDaily(tenantId, '2026-12-01');
    expect(
      await prisma.obligation.count({ where: { clientId, period: { year: 2027 } } }),
    ).toBeGreaterThan(0);
  });

  it('never touches another tenant, and ignores suspended ones', async () => {
    const other = await createTenant();
    await runTenantDaily(other.id, '2026-10-13');
    expect(await prisma.emailLog.count()).toBe(0);

    await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
    expect((await runTenantDaily(tenantId, '2026-10-13')).deadlineReminders).toBe(0);
  });
});
