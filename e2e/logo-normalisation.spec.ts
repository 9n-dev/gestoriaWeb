import { expect, test } from '@playwright/test';
import { login, prisma } from './helpers';

// ADR 0035: PDFs can only embed PNG and JPEG, so a WebP logo is turned into a PNG in the browser.
test('a WebP logo is converted to PNG on the way up, keeping its transparency', async ({
  page,
}) => {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'perez' } });
  await login(page, 'admin@demo.es');
  await page.goto('/panel/ajustes/marca');

  const webp = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0f4c81';
    ctx.beginPath();
    ctx.arc(40, 40, 36, 0, Math.PI * 2);
    ctx.fill(); // the corners stay transparent
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/webp'),
    );
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  expect(String.fromCharCode(...webp.slice(8, 12))).toBe('WEBP');

  const input = page.getByLabel(/^Logo/);
  await input.setInputFiles({
    name: 'logo.webp',
    mimeType: 'image/webp',
    buffer: Buffer.from(webp),
  });
  await expect
    .poll(() => input.evaluate((element: HTMLInputElement) => element.files?.[0]?.name))
    .toBe('logo.png');
  await page.getByRole('button', { name: 'Guardar marca' }).click();
  await expect(page.getByText('Marca guardada.')).toBeVisible();

  const { branding } = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
  const logo = await prisma.storedFile.findUniqueOrThrow({
    where: { id: (branding as { logoFileId: string }).logoFileId },
  });
  expect(logo).toMatchObject({ mimeType: 'image/png', originalName: 'logo.png' });

  // Leave the demo tenant as the seed made it.
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { branding: tenant.branding ?? {} },
  });
});
