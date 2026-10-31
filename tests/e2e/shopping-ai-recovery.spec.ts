import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { shoppingNewListAction } from './helpers/shopping-ui';

async function expectConfigFitsViewport(page: import('@playwright/test').Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    viewportWidth: visualViewport?.width ?? innerWidth,
    documentWidth: document.documentElement.scrollWidth
  }));
  expect(
    metrics.documentWidth,
    'la configuración IA no debe desbordar horizontalmente'
  ).toBeLessThanOrEqual(metrics.viewportWidth);

  const addButton = page.getByRole('button', { name: 'Agregar configuración' }).first();
  const bounds = await addButton.boundingBox();
  expect(bounds, 'el CTA móvil debe tener geometría visible').not.toBeNull();
  expect(
    bounds!.x + bounds!.width,
    'el CTA debe caber completo en el viewport'
  ).toBeLessThanOrEqual(metrics.viewportWidth);
}

test('el error de foto sin IA lleva a la configuración real sin escribir líneas', async ({
  page
}) => {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const mobile = viewport.width <= 600;
  await registerAndGoto(page, '/shopping', 'ai-recovery');
  await shoppingNewListAction(page).click();
  await page.locator('[data-test="list-name"]').fill('Recuperación IA');
  await page.locator('[data-test="create-submit"]').click();

  await page.locator('[data-test="photo-open"]').click();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64'
  );
  await page
    .locator('input[name="photoFile"]')
    .setInputFiles({ name: 'ticket.png', mimeType: 'image/png', buffer: png });
  let analyzeRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/photo/analyze') && request.method() === 'POST') {
      analyzeRequests += 1;
    }
  });
  await page.locator('[data-test="photo-analyze"]').click();

  const setupDialog = page.getByRole('dialog', { name: 'Configura la IA' });
  await expect(setupDialog).toBeVisible();
  await expect(setupDialog).toContainText('Compra y despensa');
  const recoveryLink = setupDialog.getByRole('link', { name: 'Abrir ajustes' });
  await expect(recoveryLink).toHaveAttribute('href', '/household?tab=settings');
  await expect(page.locator('app-toast .toast--error')).toHaveCount(0);
  await expect(page.locator('[data-test="item-row"]')).toHaveCount(0);
  expect(analyzeRequests).toBe(0);

  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: join(screenshotDirectory, `shopping-ai-recovery-error-${viewport.width}.png`)
    });
  }

  if (mobile) await recoveryLink.tap();
  else await recoveryLink.click();

  await expect(page).toHaveURL(/\/household\?tab=settings$/);
  await expect(page.locator('[data-test="household-ai-config"]')).toBeVisible();
  await expect(
    page.locator('[data-test="household-ai-config"]').getByRole('heading', {
      name: 'Configuración IA',
      level: 2
    })
  ).toBeVisible();
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState === 'finished')
  );
  await expect(page.locator('app-toast .toast--error')).toHaveCount(0);
  if (mobile) {
    await expectConfigFitsViewport(page);
    if (screenshotDirectory) {
      await page.screenshot({
        path: join(screenshotDirectory, `shopping-ai-recovery-config-${viewport.width}.png`)
      });
    }
    await page.setViewportSize({ width: 320, height: 568 });
    await expectConfigFitsViewport(page);
    if (screenshotDirectory) {
      await page.screenshot({
        path: join(screenshotDirectory, 'shopping-ai-recovery-config-320.png')
      });
    }
  } else if (screenshotDirectory) {
    await page.screenshot({
      path: join(screenshotDirectory, `shopping-ai-recovery-config-${viewport.width}.png`)
    });
  }
});
