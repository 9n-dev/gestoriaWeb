import { expect, test } from '@playwright/test';
import { hashPassword } from '../src/modules/auth/password';
import { login, prisma } from './helpers';

const LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

test('the admin re-roles a colleague and gives their clients to somebody else before disabling them', async ({
  page,
  browser,
}) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'perez' } });
  const stamp = Date.now();
  const email = `baja-${stamp}@demo.es`;
  const leaving = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email,
      name: `Bernardo Baja ${stamp}`,
      role: 'MANAGER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      passwordHash: await hashPassword('demo1234'),
    },
  });
  const n = stamp % 100_000_000;
  const client = await prisma.client.create({
    data: {
      tenantId: tenant.id,
      legalName: `Cliente heredado ${stamp}`,
      taxId: `${String(n).padStart(8, '0')}${LETTERS[n % 23]}`,
      assignedManagerId: leaving.id,
      inboundEmailCode: `e2e${stamp}`,
    },
  });

  await login(page, 'admin@demo.es');
  await page.goto('/panel/ajustes/equipo');
  const row = page.getByRole('row', { name: new RegExp(leaving.name) });
  await expect(row.getByRole('cell').nth(4)).toHaveText('1');
  await row.getByText('Gestionar').click();

  await row.getByLabel('Rol').selectOption('SUPERVISOR');
  await row.getByRole('button', { name: 'Cambiar rol' }).click();
  await expect(row.getByText('Rol cambiado')).toBeVisible();

  // Cannot leave a client without a manager: the heir is mandatory.
  await row.getByLabel(/Sus 1 cliente pasa a/).selectOption({ label: 'Amparo Pérez' });
  await row.getByRole('button', { name: 'Dar de baja' }).click();
  await expect(row.getByRole('button', { name: 'Reactivar' })).toBeVisible();

  const admin = await prisma.user.findFirstOrThrow({
    where: { tenantId: tenant.id, email: 'admin@demo.es' },
  });
  const moved = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
  expect(moved.assignedManagerId).toBe(admin.id);

  // The colleague is locked out.
  const other = await browser.newContext();
  const theirs = await other.newPage();
  await theirs.goto('/acceso');
  const form = theirs.locator('form', { has: theirs.getByLabel('Contraseña') });
  await form.getByLabel('Correo electrónico').fill(email);
  await form.getByLabel('Contraseña').fill('demo1234');
  await form.getByRole('button', { name: 'Entrar' }).click();
  await expect(theirs.getByText('Correo o contraseña incorrectos.')).toBeVisible();
  await other.close();

  await prisma.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } });
});

test('the admin changes the billing settings and sees why a bad value is refused', async ({
  page,
}) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'perez' } });
  await login(page, 'admin@demo.es');
  await page.goto('/panel/ajustes/facturacion');

  await page.getByLabel(/Recordatorios de impago/).fill('5, 40');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('El último recordatorio no puede ser posterior')).toBeVisible();

  await page.getByLabel(/Recordatorios de impago/).fill('5, 15, 25');
  await page.getByLabel('Plazo de pago (días)').fill('20');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Ajustes de facturación guardados.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Plazo de pago (días)')).toHaveValue('20');
  await expect(page.getByLabel(/Recordatorios de impago/)).toHaveValue('5, 15, 25');

  // Leave the demo tenant as the seed made it.
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { settings: tenant.settings ?? {} },
  });
});
