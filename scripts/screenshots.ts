/**
 * Regenerates docs/screenshots from the demo data: `npm run screenshots` with the app running
 * (`npm run build && npm run start`, `DEMO_MODE=true`, freshly seeded). Desktop for the gestoría,
 * a phone for the client, one capture in the dark theme.
 */
import { chromium, devices, type Browser, type Page } from '@playwright/test';

// First argument: the origin of the demo tenant, if it is not the local default.
const BASE = process.argv[2] ?? 'http://perez.localhost:3000';
const OUT = 'docs/screenshots';

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/acceso`);
  const form = page.locator('form', { has: page.getByLabel('Contraseña') });
  await form.getByLabel('Correo electrónico').fill(email);
  await form.getByLabel('Contraseña').fill('demo1234');
  await form.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/(inicio|panel)/);
}

async function shoot(page: Page, path: string, name: string, fullPage = false) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.info(`  ${name}.png  <-  ${path}`);
}

async function staff(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 1360, height: 1000 },
    locale: 'es-ES',
  });
  const page = await context.newPage();
  await shoot(page, '/acceso', 'acceso');
  await login(page, 'admin@demo.es');
  await shoot(page, '/panel', 'panel');
  await shoot(page, '/panel/bandeja', 'bandeja');
  await page.waitForTimeout(2500); // the PDF preview paints after the network goes quiet
  await page.screenshot({ path: `${OUT}/bandeja.png` });
  await shoot(page, '/panel/semaforo', 'semaforo');
  await shoot(page, '/panel/plazos', 'plazos-gestoria');
  await shoot(page, '/panel/facturacion', 'facturacion');
  await shoot(page, '/panel/ajustes/marca', 'ajustes-marca');
  await shoot(page, '/panel/ajustes/datos', 'ajustes-datos', true);

  // The client with the richest record: documents, obligations, conversations, fees.
  await page.goto(`${BASE}/panel/clientes`);
  await page.getByRole('link', { name: /Marta/ }).first().click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/cliente-ficha.png` });
  console.info('  cliente-ficha.png');

  await page.goto(`${BASE}/panel/mensajes`);
  // The open tax-office requirement: the thread with the most back and forth in the seed.
  const threads = page.locator('main a[href^="/panel/mensajes/"]');
  const requirement = threads.filter({ hasText: /Hacienda|requerimiento/i });
  await ((await requirement.count()) ? requirement.first() : threads.first()).click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/conversacion.png` });
  console.info('  conversacion.png');
  await context.close();
}

async function client(browser: Browser, colorScheme: 'light' | 'dark') {
  const context = await browser.newContext({ ...devices['Pixel 7'], locale: 'es-ES', colorScheme });
  const page = await context.newPage();
  await login(page, 'cliente@demo.es');
  if (colorScheme === 'dark') {
    await shoot(page, '/inicio', 'movil-inicio-oscuro');
  } else {
    await shoot(page, '/inicio', 'movil-inicio');
    await shoot(page, '/subir', 'movil-subir');
    await shoot(page, '/plazos', 'movil-plazos');
    await shoot(page, '/entregas', 'movil-entregas');
    await shoot(page, '/facturas', 'movil-facturas');
    await shoot(page, '/ayuda', 'movil-ayuda');
  }
  await context.close();
}

(async () => {
  // The full browser in its new headless mode: the old headless shell has no PDF viewer for the inbox preview.
  const browser = await chromium.launch({ channel: 'chromium' });
  await staff(browser);
  await client(browser, 'light');
  await client(browser, 'dark');
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
