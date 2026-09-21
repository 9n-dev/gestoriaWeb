import { expect, test } from '@playwright/test';
import { prisma } from './helpers';

const LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const nif = (n: number) => `${String(n).padStart(8, '0')}${LETTERS[n % 23]}`;

// §6.1 acceptance: a new gestoría gets 20 invited clients by following the wizard.
test('a new gestoría signs up, walks the wizard and ends with 20 invited clients', async ({
  page,
}) => {
  const slug = `e2e${Date.now()}`;
  const adminEmail = `admin@${slug}.test`;

  // Sign-up lives on the platform host.
  await page.goto('http://localhost:3000/registro');
  await page.getByLabel('Nombre de la gestoría').fill('Gestoría E2E');
  await page.getByLabel('Dirección del portal').fill(slug);
  await page.getByLabel('Nombre del administrador').fill('Eva Dos');
  await page.getByLabel('Correo del administrador').fill(adminEmail);
  await page.getByRole('button', { name: 'Crear mi portal' }).click();
  await expect(page.getByText('Te hemos enviado un correo')).toBeVisible();

  // The verification link arrives by email; without a mail provider it is in email_log.
  const email = await prisma.emailLog.findFirstOrThrow({
    where: { toAddress: adminEmail },
    orderBy: { createdAt: 'desc' },
  });
  const link = /http:\/\/\S+verificar\?token=[\w-]+/.exec(email.bodyText ?? '')![0];
  await page.goto(link);
  await page.getByRole('button', { name: 'Activar el portal' }).click();

  // Lands on the tenant's own host, one click from being logged in, and into the wizard.
  await expect(page).toHaveURL(new RegExp(`${slug}\\.localhost:3000/acceso/enlace`));
  await page.getByRole('button', { name: 'Entrar' }).click();

  // First login: the data processing agreement with the platform has to be accepted (§4).
  await expect(page).toHaveURL(/acceso\/condiciones/);
  await expect(page.getByRole('document', { name: 'Contrato con la plataforma' })).toContainText(
    'ENCARGO DE TRATAMIENTO',
  );
  await page.getByRole('button', { name: 'He leído y acepto' }).click();
  await expect(page).toHaveURL(/bienvenida/);

  await page.getByLabel('Razón social').fill('Gestoría E2E, S.L.');
  await page.getByLabel('NIF').fill('B12345674');
  await page.getByRole('button', { name: 'Guardar datos' }).click();
  await expect(page.getByText('Datos guardados.')).toBeVisible();
  await page.getByRole('link', { name: 'Siguiente' }).click();

  await page.getByLabel('Color principal').fill('#7c2d12');
  await page.getByRole('button', { name: 'Guardar marca' }).click();
  await expect(page.getByText('Marca guardada.')).toBeVisible();
  await page.getByRole('link', { name: 'Siguiente' }).click();

  await page.getByLabel('Nombre', { exact: true }).fill('Gus Gestor');
  await page.getByLabel('Correo electrónico').fill(`gus@${slug}.test`);
  await page.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(page.getByText(`Invitación enviada a gus@${slug}.test.`)).toBeVisible();
  await page.getByRole('link', { name: 'Siguiente' }).click();

  const rows = Array.from(
    { length: 20 },
    (_, i) =>
      `Cliente ${i + 1};${nif(40_000_000 + i)};c${i + 1}@${slug}.test;Autónomo · Estimación directa`,
  );
  await page.getByLabel('Archivo Excel (.xlsx) o CSV').setInputFiles({
    name: 'clientes.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      ['razon_social;nif;email;perfil_fiscal', ...rows, 'Con NIF malo;12345678A;;'].join('\n'),
    ),
  });
  await page.getByRole('button', { name: 'Importar clientes' }).click();
  await expect(page.getByText('20 clientes importados, 1 filas con errores.')).toBeVisible();
  await expect(page.getByRole('cell', { name: /NIF no es válido/ })).toBeVisible();
  await page.getByRole('link', { name: 'Siguiente' }).click();

  await page.getByRole('button', { name: 'Invitar a 20 clientes' }).click();
  await expect(page.getByText('20 invitaciones enviadas.')).toBeVisible();
  await page.getByRole('button', { name: 'Terminar e ir al panel' }).click();
  await expect(page).toHaveURL(/panel/);

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug } });
  expect(tenant.onboardingCompletedAt).not.toBeNull();
  expect(
    await prisma.user.count({
      where: { tenantId: tenant.id, role: 'CLIENT_USER', status: 'INVITED' },
    }),
  ).toBe(20);
  expect(await prisma.obligation.count({ where: { tenantId: tenant.id } })).toBeGreaterThan(0);
});
