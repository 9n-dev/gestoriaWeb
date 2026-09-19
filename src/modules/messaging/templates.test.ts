import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { syncObligationsForClient } from '@/modules/obligations/service';
import { resetDb } from '@tests/setup/db';
import { createClient, createTenant } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import { seedSystemData } from '../../../prisma/system-data';
import {
  deleteMessageTemplate,
  listMessageTemplates,
  renderMessageTemplate,
  saveMessageTemplate,
} from './templates';

describe('message templates', () => {
  beforeEach(async () => {
    await resetDb();
    await seedSystemData(prisma);
  });

  it('admins manage them, staff use them filled in for a client, other tenants never see them', async () => {
    const tenantId = (await createTenant()).id;
    const admin = await sessionUserFor(tenantId, 'TENANT_ADMIN');
    const manager = await sessionUserFor(tenantId, 'MANAGER');
    const profile = await prisma.taxProfile.findFirstOrThrow({
      where: { name: 'Autónomo · Estimación directa' },
    });
    const client = await createClient(tenantId, {
      legalName: 'Marta Soler',
      assignedManagerId: manager.id,
      taxProfileId: profile.id,
    });
    await syncObligationsForClient(tenantId, client.id);

    await expect(
      saveMessageTemplate(manager, { name: 'Reclamar', body: 'Hola {{cliente}}' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await saveMessageTemplate(admin, {
      name: 'Reclamar facturas',
      body: 'Hola, {{cliente}}: antes del {{plazo}} necesitamos:\n{{pendientes}}',
    });
    const [template] = await listMessageTemplates(manager);

    const text = await renderMessageTemplate(manager, template!.id, client.id);
    expect(text).toContain('Hola, Marta Soler:');
    expect(text).toMatch(/antes del \d+ de \w+ de \d{4}/);
    expect(text).toContain('- Facturas emitidas');

    await saveMessageTemplate(
      admin,
      { name: 'Reclamar', body: 'Texto nuevo para {{cliente}}' },
      template!.id,
    );
    expect((await listMessageTemplates(manager))[0]).toMatchObject({ name: 'Reclamar' });

    const outsider = await sessionUserFor((await createTenant()).id, 'TENANT_ADMIN');
    expect(await listMessageTemplates(outsider)).toEqual([]);
    await expect(deleteMessageTemplate(outsider, template!.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      renderMessageTemplate(await sessionUserFor(tenantId, 'MANAGER'), template!.id, client.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await deleteMessageTemplate(admin, template!.id);
    expect(await listMessageTemplates(manager)).toEqual([]);
  });

  it('reminder email overrides (kind EMAIL) are not listed as message templates', async () => {
    const tenantId = (await createTenant()).id;
    await prisma.template.create({
      data: { tenantId, kind: 'EMAIL', key: 'reminder.deadline.7d', name: 'x', body: 'y' },
    });
    expect(await listMessageTemplates(await sessionUserFor(tenantId, 'MANAGER'))).toEqual([]);
  });
});
