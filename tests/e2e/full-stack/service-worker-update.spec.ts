import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../fixtures';

test('announces a ready service-worker update and keeps its action keyboard accessible', async ({
  page
}, testInfo) => {
  await page.goto('/');
  await expect(page.locator('app-root')).toBeVisible();
  await expect(page.locator('[data-test="app-update-notice"]')).toHaveCount(0);

  await page.evaluate(() => {
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'VERSION_READY',
          currentVersion: { hash: 'synthetic-current' },
          latestVersion: { hash: 'synthetic-update' }
        }
      })
    );
  });

  const notice = page.getByRole('status');
  const action = page.getByRole('button', { name: 'Recargar ahora' });
  await expect(notice).toContainText('Hay una versión nueva disponible.');
  await expect(action).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(action).toBeFocused();
  expect(await action.evaluate((button) => getComputedStyle(button).outlineStyle)).not.toBe('none');

  const isMobile = testInfo.project.name === 'mobile-chrome';
  await page.setViewportSize(isMobile ? { width: 393, height: 852 } : { width: 1440, height: 900 });
  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: join(screenshotDirectory, `app-update-${isMobile ? 'mobile' : 'desktop'}.png`),
      animations: 'disabled'
    });
  }

  for (const viewport of [
    isMobile ? { width: 320, height: 568 } : { width: 1024, height: 768 },
    isMobile ? { width: 852, height: 393 } : { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewport.width + 1);
    await expect(action).toBeVisible();
  }
});
