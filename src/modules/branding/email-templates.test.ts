import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { requestMagicLink } from '@/modules/auth/service';
import type { SessionUser } from '@/modules/auth/permissions';
import { resetDb } from '@tests/setup/db';
import { createTenant, createUser } from '@tests/setup/factories';
import { sessionUserFor } from '@tests/setup/session';
import {
  listEmailTemplates,
  previewEmailTemplate,
  resetEmailTemplate,
  saveEmailTemplate,
} from './email-templates';

describe('email templates and branding of emails', () => {
  let tenantId: string;
  let admin: SessionUser;

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await resetDb();
    tenantId = (
      await createTenant({
        name: 'Gestoría Pérez',
        slug: 'perez',
        branding: { primaryColor: '#7c2d12', senderName: 'Pérez Asesores' },
      })
    ).id;
    admin = await sessionUserFor(tenantId, 'TENANT_ADMIN');
  });

  it('lists every system email with its default wording until the tenant customises it', async () => {
    const before = await listEmailTemplates(admin);
    expect(before.length).toBeGreaterThanOrEqual(8);
    expect(before.every((template) => !template.customized)).toBe(true);

    await saveEmailTemplate(admin, {
      key: 'auth.magic_link',
      subject: 'Entra en {{gestoria}}',
      body: 'Hola {{nombre}}, tu enlace:\n{{enlace}}',
    });
    const after = (await listEmailTemplates(admin)).find((t) => t.key === 'auth.magic_link')!;
    expect(after).toMatchObject({ customized: true, subject: 'Entra en {{gestoria}}' });

    await resetEmailTemplate(admin, 'auth.magic_link');
    expect(
      (await listEmailTemplates(admin)).find((t) => t.key === 'auth.magic_link')!.customized,
    ).toBe(false);
  });

  it('the custom wording is what gets sent, from the tenant sender name, with branded HTML', async () => {
    await createUser(tenantId, 'CLIENT_USER', { email: 'marta@example.com', name: 'Marta' });
    await saveEmailTemplate(admin, {
      key: 'auth.magic_link',
      subject: 'Entra en {{gestoria}}',
      body: 'Hola {{nombre}}, tu enlace:\n{{enlace}}',
    });
    await requestMagicLink(
      { id: tenantId, name: 'Gestoría Pérez' },
      'marta@example.com',
      'https://perez.app.test',
    );

    const email = await prisma.emailLog.findFirstOrThrow();
    expect(email.subject).toBe('Entra en Gestoría Pérez');
    expect(email.bodyText).toMatch(
      /^Hola Marta, tu enlace:\nhttps:\/\/perez\.app\.test\/acceso\/enlace\?token=/,
    );
    expect(email.fromAddress).toBe('"Pérez Asesores" <no-reply@localhost>');
    expect(email.bodyHtml).toContain('#7c2d12');
    expect(email.bodyHtml).toContain('<a href="https://perez.app.test/acceso/enlace?token=');
  });

  it('a verified sending domain becomes the From address', async () => {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { sendingDomain: 'gestoriaperez.es', sendingDomainVerifiedAt: new Date() },
    });
    await sendEmail({ tenantId, to: 'x@example.com', subject: 'Hola', text: 'Hola' });
    expect((await prisma.emailLog.findFirstOrThrow()).fromAddress).toBe(
      '"Pérez Asesores" <no-reply@gestoriaperez.es>',
    );
  });

  it('previews with sample data and escapes HTML in the text', async () => {
    const preview = await previewEmailTemplate(admin, {
      key: 'reminder.deadline.7d',
      subject: 'Quedan {{dias}} días',
      body: 'Hola <b>{{cliente}}</b>\n\n{{pendientes}}',
    });
    expect(preview.subject).toBe('Quedan 7 días');
    expect(preview.text).toContain('- Facturas emitidas');
    expect(preview.html).toContain('&lt;b&gt;Marta Soler Vidal&lt;/b&gt;');
    expect(preview.html).not.toContain('<b>');
  });

  it('rejects variables the email cannot fill, and is for admins only', async () => {
    await expect(
      saveEmailTemplate(admin, {
        key: 'auth.invitation',
        subject: 'Hola',
        body: 'Tu plazo es {{plazo}} y mucho más texto',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const manager = await sessionUserFor(tenantId, 'MANAGER');
    await expect(listEmailTemplates(manager)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
