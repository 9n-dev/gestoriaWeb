import { expect, test } from '@playwright/test';
import { hashPassword } from '../src/modules/auth/password';
import { totpAt } from '../src/modules/auth/two-factor/totp';
import { login, logout, prisma } from './helpers';

// §4: the CSP must not break the app. Any violation shows up as a console error.
test('pages load under the nonce-based CSP without violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text());
  });

  const response = await page.goto('/acceso');
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[\w+/=-]+' 'strict-dynamic'/);
  expect(csp).toContain(`frame-ancestors 'none'`);
  expect(response?.headers()['x-content-type-options']).toBe('nosniff');

  await login(page, 'cliente@demo.es');
  for (const path of ['/inicio', '/subir', '/documentos', '/mensajes', '/cuenta']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  expect(violations).toEqual([]);
});

test('a client accepts the agreement, turns on 2FA and is challenged at the next login', async ({
  page,
}) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'perez' } });
  const client = await prisma.client.findFirstOrThrow({
    where: { tenantId: tenant.id, deletedAt: null },
  });
  const email = `dospasos-${Date.now()}@demo.es`;
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email,
      name: 'Dolores Dos Pasos',
      role: 'CLIENT_USER',
      status: 'ACTIVE',
      passwordHash: await hashPassword('demo1234'),
      clientLinks: { create: { tenantId: tenant.id, clientId: client.id } },
    },
  });

  // First visit: the agreement between the client and the gestoría.
  await page.goto('/acceso');
  const form = page.locator('form', { has: page.getByLabel('Contraseña') });
  await form.getByLabel('Correo electrónico').fill(email);
  await form.getByLabel('Contraseña').fill('demo1234');
  await form.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/acceso\/condiciones/);
  await page.getByRole('button', { name: 'He leído y acepto' }).click();
  await expect(page).toHaveURL(/inicio/);

  // Opt in from the account page.
  await page.goto('/cuenta');
  await page.getByRole('link', { name: 'Activar la verificación en dos pasos' }).click();
  await expect(page.getByAltText('Código QR para la aplicación de autenticación')).toBeVisible();
  const secret = (await page.locator('code').first().innerText()).trim();
  await page.getByLabel(/Código de 6 dígitos/).fill(totpAt(secret, Date.now()));
  await page.getByRole('button', { name: 'Activar' }).click();
  await expect(
    page.getByRole('heading', { name: 'Guarda tus códigos de recuperación' }),
  ).toBeVisible();
  const recoveryCode = (await page.locator('ul.font-mono li').first().innerText()).trim();
  await page.getByRole('link', { name: /continuar/ }).click();
  await expect(page).toHaveURL(/inicio/);

  // Next login: password is not enough, and nothing is reachable before the challenge.
  await logout(page);
  await form.getByLabel('Correo electrónico').fill(email);
  await form.getByLabel('Contraseña').fill('demo1234');
  await form.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/acceso\/2fa/);
  await page.goto('/documentos');
  await expect(page).toHaveURL(/acceso\/2fa/);
  expect((await page.request.get('/api/files/whatever')).status()).toBe(401);

  await page.getByLabel('Código de verificación').fill('000000');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('El código no es correcto.')).toBeVisible();
  await page.getByLabel('Código de verificación').fill(recoveryCode);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/inicio/);

  await prisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
});
