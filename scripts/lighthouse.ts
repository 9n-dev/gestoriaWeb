/**
 * Lighthouse on the client's screens, mobile, against a running production build with the demo
 * data: `npm run lighthouse [origin]`. Fails when a page drops under the spec's floor (§9:
 * performance 90, accessibility 95), so CI catches a regression before a person does.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://perez.localhost:3000';
const PAGES = [
  '/acceso',
  '/inicio',
  '/subir',
  '/documentos',
  '/plazos',
  '/mensajes',
  '/entregas',
  '/facturas',
  '/cuenta',
];
const FLOOR = { performance: 90, accessibility: 95 };
const OUT = 'test-results/lighthouse';

/** Logs the demo client in and returns its cookies as a header, for Lighthouse's own requests. */
async function sessionHeaders(): Promise<string> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: BASE });
  await page.goto('/acceso');
  const form = page.locator('form', { has: page.getByLabel('Contraseña') });
  await form.getByLabel('Correo electrónico').fill('cliente@demo.es');
  await form.getByLabel('Contraseña').fill('demo1234');
  await form.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/inicio/);
  const cookies = await page.context().cookies();
  await browser.close();
  return JSON.stringify({ Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') });
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const headersFile = `${OUT}/headers.json`;
  writeFileSync(headersFile, await sessionHeaders());
  const chromePath = chromium.executablePath();
  const failures: string[] = [];

  const measure = (path: string, attempt: number) => {
    const report = `${OUT}${path.replace(/\//g, '_')}-${attempt}.json`;
    execFileSync(
      'npx',
      [
        'lighthouse',
        `${BASE}${path}`,
        `--extra-headers=${headersFile}`,
        '--only-categories=performance,accessibility',
        '--form-factor=mobile',
        '--chrome-flags=--headless=new --no-sandbox',
        '--output=json',
        `--output-path=${report}`,
        '--quiet',
      ],
      // eslint-disable-next-line no-restricted-properties -- a script, not the app: the CLI needs the browser path
      { env: { ...process.env, CHROME_PATH: chromePath }, stdio: 'inherit' },
    );
    const { categories } = JSON.parse(readFileSync(report, 'utf8')) as {
      categories: Record<keyof typeof FLOOR, { score: number }>;
    };
    return {
      performance: Math.round(categories.performance.score * 100),
      accessibility: Math.round(categories.accessibility.score * 100),
    };
  };

  for (const path of PAGES) {
    // Performance scores are noisy on shared machines: a page gets up to three runs, the best counts.
    let scores = measure(path, 1);
    for (let attempt = 2; attempt <= 3 && scores.performance < FLOOR.performance; attempt++) {
      const again = measure(path, attempt);
      if (again.performance > scores.performance) scores = again;
    }
    console.info(
      `${path.padEnd(12)} performance ${scores.performance}  accessibility ${scores.accessibility}`,
    );
    for (const key of ['performance', 'accessibility'] as const) {
      if (scores[key] < FLOOR[key]) failures.push(`${path}: ${key} ${scores[key]} < ${FLOOR[key]}`);
    }
  }

  if (failures.length) {
    console.error(`\nBelow the floor:\n${failures.map((line) => `  ${line}`).join('\n')}`);
    process.exit(1);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
