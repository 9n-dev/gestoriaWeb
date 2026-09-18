import { expect, test } from '@playwright/test';
import { login, makePhoto, prisma } from './helpers';

// §6.3 acceptance: 10 photos from a phone on a simulated 3G connection, none lost.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('uploads 10 photos over a throttled 3G connection without losing any', async ({ page }) => {
  test.setTimeout(300_000);
  const tag = `3g-${Date.now()}`;
  await login(page, 'cliente@demo.es');
  await page.goto('/subir');

  const photos = [];
  for (let i = 1; i <= 10; i++) photos.push(await makePhoto(page, `${tag}-${i}.jpg`));

  // Chrome DevTools "Fast 3G": 1.6 Mbps down, 750 kbps up, 150 ms RTT (values in bytes/s).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });

  await page.getByTestId('file-input').setInputFiles(photos);
  await expect(page.getByText('10 de 10 documentos enviados.')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText('Reintentar')).toHaveCount(0);

  // Every one of them reached the bucket and became a document, compressed to at most 2500 px.
  await expect(async () => {
    const files = await prisma.storedFile.findMany({
      where: { originalName: { startsWith: tag } },
    });
    expect(files).toHaveLength(10);
    expect(files.every((file) => file.status === 'CLEAN')).toBe(true);
    expect(files.every((file) => file.sizeBytes < photos[0]!.buffer.length)).toBe(true);
  }).toPass({ timeout: 60_000 });
});
