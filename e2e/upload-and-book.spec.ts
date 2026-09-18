import { expect, test } from '@playwright/test';
import { login, logout, makePhoto } from './helpers';

test('client uploads a document and the manager books it with the keyboard', async ({ page }) => {
  const fileName = `factura-e2e-${Date.now()}.jpg`;

  await login(page, 'cliente@demo.es');
  await page.getByRole('link', { name: 'Subir documentos' }).click();
  await expect(page).toHaveURL(/subir/);
  await page.getByTestId('file-input').setInputFiles(await makePhoto(page, fileName));
  await expect(page.getByRole('listitem').filter({ hasText: fileName })).toContainText('Enviado');

  // The worker scans it; until then the client sees "Analizando…".
  await page.goto('/documentos');
  const mine = page.getByRole('listitem').filter({ hasText: fileName });
  await expect(async () => {
    await page.reload();
    await expect(mine).toContainText('Recibido', { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await logout(page);

  await login(page, 'gestor@demo.es');
  await expect(page).toHaveURL(/panel\/bandeja/);
  await page.getByRole('row').filter({ hasText: fileName }).click();
  await expect(page.getByRole('img', { name: `Vista previa de ${fileName}` })).toBeVisible();

  // Keyboard only from here. K and J walk the list (the new document is the last row)…
  const row = page.getByRole('row').filter({ hasText: fileName });
  await page.keyboard.press('k');
  await expect(row).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('j');
  await expect(row).toHaveAttribute('aria-selected', 'true');
  // …and B books the selected document.
  await page.keyboard.press('b');
  await expect(page.getByText('Contabilizado.')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: fileName })).toHaveCount(0);
  await logout(page);

  await login(page, 'cliente@demo.es');
  await page.goto('/documentos');
  await expect(page.getByRole('listitem').filter({ hasText: fileName })).toContainText(
    'Contabilizado',
  );
});

test('manager rejects a document from the keyboard and the client sees why', async ({ page }) => {
  const fileName = `ticket-e2e-${Date.now()}.jpg`;
  await login(page, 'cliente@demo.es');
  await page.goto('/subir');
  await page.getByTestId('file-input').setInputFiles(await makePhoto(page, fileName, 1600, 1200));
  await expect(page.getByRole('listitem').filter({ hasText: fileName })).toContainText('Enviado');
  await logout(page);

  await login(page, 'gestor@demo.es');
  const row = page.getByRole('row').filter({ hasText: fileName });
  await expect(async () => {
    await page.reload();
    await row.click({ timeout: 1000 });
    await expect(page.getByRole('img', { name: `Vista previa de ${fileName}` })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 30_000 });

  await page.keyboard.press('r');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Nota para el cliente (opcional)').fill('No se ve el total');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Rechazado. Hemos avisado al cliente.')).toBeVisible();
  await logout(page);

  await login(page, 'cliente@demo.es');
  await page.goto('/documentos');
  const mine = page.getByRole('listitem').filter({ hasText: fileName });
  await expect(mine).toContainText('Rechazado');
  await expect(mine).toContainText('No se ve el total');
});
