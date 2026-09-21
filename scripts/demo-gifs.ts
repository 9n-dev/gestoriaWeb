/**
 * Records the two flows the product is about and turns them into GIFs for the README:
 * `npm run demo:gifs` with the app and the worker running on freshly seeded demo data.
 * Needs ffmpeg. Videos are trimmed so they start when the interesting page is on screen.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { chromium, devices, type BrowserContext, type Page } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://perez.localhost:3000';
const OUT = 'docs/screenshots';
const TMP = 'test-results/demo-video';

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/acceso`);
  const form = page.locator('form', { has: page.getByLabel('Contraseña') });
  await form.getByLabel('Correo electrónico').fill(email);
  await form.getByLabel('Contraseña').fill('demo1234');
  await form.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/(inicio|panel)/);
}

/** Closes the context (which flushes the video) and converts from `skipSeconds` on. */
async function toGif(
  context: BrowserContext,
  dir: string,
  skipSeconds: number,
  name: string,
  width: number,
) {
  await context.close();
  const video = readdirSync(dir).find((file) => file.endsWith('.webm'));
  if (!video) throw new Error('no video recorded');
  const filter = `fps=8,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`;
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    String(skipSeconds),
    '-i',
    `${dir}/${video}`,
    '-vf',
    filter,
    `${OUT}/${name}.gif`,
  ]);
  console.info(`  ${name}.gif`);
}

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

(async () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium' });

  // 1. The client, on a phone: home -> "Subir documentos" -> the file goes up and is listed.
  {
    const dir = `${TMP}/client`;
    const context = await browser.newContext({
      ...devices['Pixel 7'],
      locale: 'es-ES',
      recordVideo: { dir, size: { width: 412, height: 839 } },
    });
    const page = await context.newPage();
    const started = Date.now();
    await login(page, 'cliente@demo.es');
    const skip = (Date.now() - started) / 1000;
    await pause(page, 1500);
    await page.getByRole('link', { name: 'Subir documentos' }).first().click();
    await page.waitForURL(/subir/);
    await pause(page, 1200);
    const photo = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 1200;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fdfdf8';
      ctx.fillRect(0, 0, 1600, 1200);
      ctx.fillStyle = '#111';
      ctx.font = '64px sans-serif';
      ctx.fillText('FACTURA DEMO 2026-0917', 120, 200);
      ctx.font = '40px sans-serif';
      ctx.fillText(`Total 121,00 EUR  ${Math.random().toString(36).slice(2)}`, 120, 300);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9),
      );
      return [...new Uint8Array(await blob.arrayBuffer())];
    });
    await page.getByTestId('file-input').setInputFiles({
      name: 'factura-taller.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(photo),
    });
    await page.getByText('Enviado', { exact: true }).waitFor({ timeout: 60_000 });
    await pause(page, 1500);
    await page.goto(`${BASE}/documentos`);
    await pause(page, 2500);
    await toGif(context, dir, skip, 'demo-cliente-sube', 300);
  }

  // 2. The manager, keyboard only: move, edit a field, confirm, book.
  {
    const dir = `${TMP}/manager`;
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'es-ES',
      recordVideo: { dir, size: { width: 1280, height: 800 } },
    });
    const page = await context.newPage();
    const started = Date.now();
    await login(page, 'gestor@demo.es');
    await page.goto(`${BASE}/panel/bandeja`);
    await page.waitForLoadState('networkidle');
    const skip = (Date.now() - started) / 1000;
    await pause(page, 2000);
    for (const key of ['j', 'j', 'k']) {
      await page.keyboard.press(key);
      await pause(page, 1300);
    }
    await page.keyboard.press('Enter'); // confirm the extracted data
    await pause(page, 1800);
    await page.keyboard.press('b'); // book it: it leaves the queue
    await pause(page, 2200);
    await page.keyboard.press('j');
    await pause(page, 1200);
    await page.keyboard.press('r'); // reject with a reason
    await pause(page, 1500);
    await page.keyboard.press('Escape');
    await pause(page, 1000);
    await toGif(context, dir, skip, 'demo-gestor-teclado', 860);
  }

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
