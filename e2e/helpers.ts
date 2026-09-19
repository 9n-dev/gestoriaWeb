import { expect, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export async function login(page: Page, email: string, password = 'demo1234') {
  await page.goto('/acceso');
  const form = page.locator('form', { has: page.getByLabel('Contraseña') });
  await form.getByLabel('Correo electrónico').fill(email);
  await form.getByLabel('Contraseña').fill(password);
  await form.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/acceso/);
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/acceso/);
}

/**
 * A real, unique JPEG photo made in the browser: gradients plus noise, so that it compresses like
 * a phone picture (hundreds of KB) and no two files share a hash.
 */
export async function makePhoto(page: Page, name: string, width = 3200, height = 2400) {
  const base64 = await page.evaluate(
    async ([w, h, label]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w as number;
      canvas.height = h as number;
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, `hsl(${Math.random() * 360} 60% 85%)`);
      gradient.addColorStop(1, `hsl(${Math.random() * 360} 60% 60%)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < 4000; i++) {
        ctx.fillStyle = `hsl(${Math.random() * 360} 50% ${30 + Math.random() * 50}%)`;
        ctx.fillRect(
          Math.random() * canvas.width,
          Math.random() * canvas.height,
          2 + Math.random() * 40,
          2 + Math.random() * 6,
        );
      }
      ctx.fillStyle = '#111';
      ctx.font = '96px sans-serif';
      ctx.fillText(`FACTURA ${label} ${Math.random().toString(36).slice(2)}`, 120, 240);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.92),
      );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    },
    [width, height, name],
  );
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from(base64, 'base64') };
}
