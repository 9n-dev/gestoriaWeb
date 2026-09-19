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
