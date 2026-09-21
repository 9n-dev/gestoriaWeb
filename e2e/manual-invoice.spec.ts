import { expect, test } from '@playwright/test';
import { login, prisma } from './helpers';

// §6.11: a manual invoice with several lines, each with its own VAT, and the total before issuing.
test('the admin issues an invoice with two lines at different VAT rates and a withholding', async ({
  page,
}) => {
  await login(page, 'admin@demo.es');
  await page.goto('/panel/facturacion');
  const before = await prisma.invoice.count({ where: { status: 'ISSUED' } });

  const first = page.getByRole('group', { name: 'Concepto 1' });
  await first.getByLabel('Concepto 1').fill('Asesoría extraordinaria E2E');
  await first.getByLabel('Precio (€)').fill('100');
  await first.getByLabel('% IRPF').fill('15');

  await page.getByRole('button', { name: 'Añadir concepto' }).click();
  const second = page.getByRole('group', { name: 'Concepto 2' });
  await second.getByLabel('Concepto 2').fill('Tasas del registro (suplido)');
  await second.getByLabel('Cantidad').fill('2');
  await second.getByLabel('Precio (€)').fill('12,50');
  await second.getByLabel('IVA').selectOption('0');

  // 100 + 25 base, 21 VAT, −15 IRPF.
  const totals = page.locator('dl', { hasText: 'Base imponible' });
  await expect(totals).toContainText('125,00');
  await expect(totals).toContainText('131,00');

  // A line added by mistake goes away and takes nothing with it.
  await page.getByRole('button', { name: 'Añadir concepto' }).click();
  await page.getByRole('button', { name: 'Quitar el concepto 3' }).click();
  await expect(page.getByRole('group', { name: 'Concepto 3' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Emitir factura' }).click();
  await expect(page.getByText('Factura emitida.')).toBeVisible();

  expect(await prisma.invoice.count({ where: { status: 'ISSUED' } })).toBe(before + 1);
  const invoice = await prisma.invoice.findFirstOrThrow({
    where: { lines: { some: { description: 'Asesoría extraordinaria E2E' } } },
    orderBy: { createdAt: 'desc' },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  });
  expect(Number(invoice.total)).toBe(131);
  expect(
    invoice.lines.map((line) => [
      Number(line.quantity),
      Number(line.vatRate),
      Number(line.irpfRate),
    ]),
  ).toEqual([
    [1, 21, 15],
    [2, 0, 0],
  ]);
});
