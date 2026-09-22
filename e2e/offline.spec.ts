import { expect, test } from '@playwright/test';
import { login, makePhoto, prisma } from './helpers';

// §6.14: intermittent connection. A photo chosen offline waits in IndexedDB — through a closed
// page too — and goes out by itself once the network is back.
test('a photo taken offline survives leaving the page and is sent when the connection returns', async ({
  page,
  context,
}) => {
  await login(page, 'cliente@demo.es');
  await page.goto('/subir');
  const photo = await makePhoto(page, 'offline.jpg', 1200, 900);
  const before = await prisma.document.count();

  await context.setOffline(true);
  await page.getByTestId('file-input').setInputFiles(photo);
  await expect(page.getByText(/Sin conexión: 1 documento guardado/)).toBeVisible();
  await expect(page.getByText('Pendiente de conexión')).toBeVisible();

  // The service worker answers navigations with the offline page instead of the browser's error.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.goto('/documentos').catch(() => {});
  await expect(page.getByRole('heading', { name: 'Sin conexión' })).toBeVisible();

  await context.setOffline(false);
  await page.goto('/subir');
  await expect(page.getByText('Enviado', { exact: true })).toBeVisible({ timeout: 60_000 });
  expect(await prisma.document.count()).toBe(before + 1);

  // Nothing is left in the queue: a reload does not send it twice.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Subir documentos' })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await prisma.document.count()).toBe(before + 1);
});

test('the portal is installable: manifest, icons and service worker', async ({ page, request }) => {
  await page.goto('/acceso');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(href!)).json();
  expect(manifest).toMatchObject({ display: 'standalone', start_url: '/' });
  expect(manifest.name).toContain('Pérez');
  const icon = await request.get(
    manifest.icons.find((i: { sizes: string }) => i.sizes === '512x512').src,
  );
  expect(icon.headers()['content-type']).toBe('image/png');
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r?.active)),
    )
    .toBe(true);
});

// TD-071: staff uploads survive a lost connection too, and go out from any page.
test('a receipt chosen offline by a manager is sent from wherever they open the portal next', async ({
  page,
  context,
}) => {
  const client = await prisma.client.findFirstOrThrow({
    where: { legalName: 'Marta Soler Vidal' },
  });
  const period = await prisma.period.upsert({
    where: { year_type_ordinal: { year: 2026, type: 'YEAR', ordinal: 1 } },
    create: { year: 2026, type: 'YEAR', ordinal: 1 },
    update: {},
  });
  await prisma.obligation.upsert({
    where: { clientId_model_periodId: { clientId: client.id, model: '347', periodId: period.id } },
    create: {
      tenantId: client.tenantId,
      clientId: client.id,
      model: '347',
      periodId: period.id,
      dueDate: new Date('2027-02-28'),
    },
    update: {
      status: 'PENDING_DOCS',
      result: null,
      resultAmount: null,
      filedAt: null,
      receiptFileId: null,
    },
  });
  // Attached, scanned receipts: an upload interrupted mid-way may leave a PENDING row that the
  // daily cleanup sweeps, and that is not what the manager sees.
  const attached = () =>
    prisma.storedFile.count({
      where: { kind: 'OBLIGATION_RECEIPT', obligationReceipt: { isNot: null } },
    });
  const before = await attached();

  await login(page, 'gestor@demo.es');
  await page.goto(`/panel/clientes/${client.id}`);
  const row = page.getByRole('listitem').filter({ hasText: /^347/ });
  await row.getByText('Marcar como presentada…').click();
  await row
    .getByLabel('Justificante (PDF)')
    .setInputFiles(await makePhoto(page, 'justificante.jpg', 1000, 800));

  await context.setOffline(true);
  await row.getByRole('button', { name: 'Presentada: avisar al cliente' }).click();
  await expect(row.getByText(/No se ha podido subir el justificante/)).toBeVisible();

  await context.setOffline(false);
  await page.goto('/panel');
  await expect(page.getByRole('status')).toContainText(/pendiente enviado/, { timeout: 60_000 });
  await expect.poll(attached, { timeout: 30_000 }).toBe(before + 1);
});
