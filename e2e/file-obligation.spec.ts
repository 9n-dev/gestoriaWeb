import { expect, test } from '@playwright/test';
import { login, logout, prisma } from './helpers';

// §8.5: the manager marks an obligation as filed and the client sees it.
test('manager files an obligation with its receipt and the client sees the result', async ({
  page,
}) => {
  // A fresh, unfiled obligation of the demo client, whatever earlier runs left behind.
  const client = await prisma.client.findFirstOrThrow({
    where: { legalName: 'Marta Soler Vidal', tenant: { slug: 'perez' } },
  });
  const period = await prisma.period.upsert({
    where: { year_type_ordinal: { year: 2026, type: 'QUARTER', ordinal: 4 } },
    create: { year: 2026, type: 'QUARTER', ordinal: 4 },
    update: {},
  });
  await prisma.obligation.upsert({
    where: { clientId_model_periodId: { clientId: client.id, model: '349', periodId: period.id } },
    create: {
      tenantId: client.tenantId,
      clientId: client.id,
      model: '349',
      periodId: period.id,
      dueDate: new Date('2027-02-01'),
    },
    update: {
      status: 'PENDING_DOCS',
      result: null,
      resultAmount: null,
      filedAt: null,
      receiptFileId: null,
    },
  });

  await login(page, 'gestor@demo.es');
  await page.goto(`/panel/clientes/${client.id}`);
  const row = page.getByRole('listitem').filter({ hasText: /^349/ });
  await row.getByText('Marcar como presentada…').click();
  await row.getByLabel('Resultado').selectOption('TO_PAY');
  await row.getByLabel('Importe (€)', { exact: true }).fill('1.234,56');
  await row.getByLabel('Domiciliado').check();
  await row.getByLabel('Justificante (PDF)').setInputFiles({
    name: 'justificante-349.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n% justificante e2e ${Date.now()}\n%%EOF\n`),
  });
  await row.getByRole('button', { name: 'Presentada: avisar al cliente' }).click();
  await expect(row).toContainText('Presentado');
  await expect(row).toContainText('A pagar 1.234,56 € (domiciliado)');
  await logout(page);

  await login(page, 'cliente@demo.es');
  await page.goto('/plazos');
  const filed = page.getByRole('listitem').filter({ hasText: 'Modelo 349' });
  await expect(filed).toContainText('A pagar 1.234,56 € (domiciliado)');
  // The receipt becomes downloadable once the worker has scanned it.
  await expect(async () => {
    await page.reload();
    await expect(filed.getByRole('link', { name: 'Descargar justificante' })).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 30_000 });

  const notification = await prisma.notification.findFirst({
    where: {
      type: 'OBLIGATION_FILED',
      user: { email: 'cliente@demo.es' },
      title: { contains: '349' },
    },
    orderBy: { createdAt: 'desc' },
  });
  expect(notification?.body).toContain('1.234,56');
});

test('the traffic-light overview lists clients and exports to CSV', async ({ page }) => {
  await login(page, 'supervisor@demo.es');
  await page.goto('/panel/semaforo');
  await expect(page.getByRole('table')).toContainText('Marta Soler Vidal');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exportar CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^semaforo-.*\.csv$/);
});
