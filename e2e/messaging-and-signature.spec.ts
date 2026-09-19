import { expect, test } from '@playwright/test';
import { login, logout, prisma } from './helpers';

test('client and manager talk in a thread; internal threads stay out of the client portal', async ({
  page,
}) => {
  const subject = `Duda sobre el alquiler ${Date.now()}`;

  await login(page, 'cliente@demo.es');
  await page.goto('/mensajes');
  await expect(page.getByText('Suele entregar tarde')).toHaveCount(0); // internal thread of the seed
  await page.getByLabel('Asunto').fill(subject);
  await page
    .getByLabel('Mensaje', { exact: true })
    .fill('¿El alquiler del coworking lleva retención?');
  await page.getByRole('button', { name: 'Abrir conversación' }).click();
  await expect(page).toHaveURL(/\/mensajes\/.+/);
  await expect(page.getByText('¿El alquiler del coworking lleva retención?')).toBeVisible();
  await logout(page);

  await login(page, 'gestor@demo.es');
  await expect(page.getByRole('link', { name: /Notificaciones: \d+ sin leer/ })).toBeVisible();
  await page.goto('/panel/mensajes');
  await page.getByRole('link', { name: new RegExp(subject) }).click();
  await page.getByLabel('Plantilla').selectOption({ label: 'Acuse de recibo' });
  await expect(page.getByLabel('Tu mensaje')).toHaveValue(/Recibido, Marta Soler Vidal/);
  await page.getByLabel('Tu mensaje').fill('No: es un servicio, no un arrendamiento de inmueble.');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'No: es un servicio' })).toBeVisible();
  await logout(page);

  await login(page, 'cliente@demo.es');
  await page.getByRole('link', { name: /Notificaciones: \d+ sin leer/ }).click();
  await page
    .getByRole('button', { name: new RegExp(`Nuevo mensaje: ${subject}`) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/mensajes\/.+/);
  await expect(
    page.getByText('No: es un servicio, no un arrendamiento de inmueble.'),
  ).toBeVisible();

  // The reply-to of the notification email leads back to this thread.
  const thread = await prisma.thread.findFirstOrThrow({ where: { subject } });
  const email = await prisma.emailLog.findFirstOrThrow({
    where: { toAddress: 'cliente@demo.es', replyTo: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  expect(email.replyTo).toBe(`reply+${thread.replyToken}@docs.localhost`);
});

test('client signs a delivery and gets a certificate; the gestoría sees the history', async ({
  page,
}) => {
  // A fresh delivery waiting for signature (the file is already clean, as the worker would leave it).
  const client = await prisma.client.findFirstOrThrow({
    where: { legalName: 'Marta Soler Vidal', tenant: { slug: 'perez' } },
  });
  const source = await prisma.storedFile.findFirstOrThrow({
    where: { tenantId: client.tenantId, kind: 'DELIVERY', status: 'CLEAN' },
  });
  const title = `Conformidad con las cuentas ${Date.now()}`;
  const file = await prisma.storedFile.create({
    data: {
      tenantId: client.tenantId,
      kind: 'DELIVERY',
      status: 'CLEAN',
      storageKey: source.storageKey + `-${Date.now()}`,
      originalName: 'cuentas.pdf',
      mimeType: 'application/pdf',
      sizeBytes: source.sizeBytes,
      sha256: source.sha256,
    },
  });
  const delivery = await prisma.delivery.create({
    data: {
      tenantId: client.tenantId,
      clientId: client.id,
      fileId: file.id,
      title,
      requiresSignature: true,
      visibleFrom: new Date(Date.now() - 60_000),
    },
  });

  await login(page, 'cliente@demo.es');
  await page.goto('/entregas');
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await page.getByLabel('He leído el documento y estoy conforme con su contenido.').check();
  await page.getByRole('button', { name: 'Firmar' }).click();
  await expect(page.getByText(/Firmado el .* por Marta Soler/)).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Descargar certificado de conformidad' }),
  ).toBeVisible();

  const signed = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
  expect(signed.signedFileHash).toBe(source.sha256);
  expect(signed.signatureIp).toBeTruthy();
  expect(signed.certificateFileId).toBeTruthy();
  await logout(page);

  await login(page, 'gestor@demo.es');
  await page.goto(`/panel/clientes/${client.id}`);
  const row = page.getByRole('listitem').filter({ hasText: title });
  await expect(row.getByRole('link', { name: 'Firmado · certificado' })).toBeVisible();
  await row.getByText(/Historial/).click();
  await expect(row).toContainText('Firmado · Marta Soler');
});
