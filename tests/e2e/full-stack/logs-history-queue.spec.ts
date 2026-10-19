import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { registerAndGoto } from '../helpers/auth';

type HistoryLog = {
  timestamp: string;
  level: 'info';
  source: 'server';
  message: string;
};

async function stubHistory(page: Page, logs: HistoryLog[]) {
  let intercepted = 0;

  await page.route(/\/api\/logs\?limit=500$/, async (route) => {
    intercepted += 1;
    await route.fulfill({
      json: { success: true, data: { logs, total: logs.length } }
    });
  });

  return () => intercepted;
}

async function saveSyntheticScreenshot(page: Page, fileName: string) {
  const screenshotRoot = process.env.E2E_SCREENSHOT_DIR;
  if (!screenshotRoot) return;

  const directory = join(resolve(screenshotRoot), test.info().project.name);
  await mkdir(directory, { recursive: true });
  await page.locator('.terminal').screenshot({ path: join(directory, fileName) });
}

test.describe('cola de historial del visor de Logs', () => {
  test.use({ serviceWorkers: 'block' });

  test('presenta el estado vacío cuando no hay historial ni eventos SSE', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const historyRequests = await stubHistory(page, []);
    await page.route(/\/api\/logs\/stream(?:\?.*)?$/, (route) => route.abort());
    const viewport =
      test.info().project.name === 'mobile-chrome'
        ? { width: 393, height: 851 }
        : { width: 1440, height: 900 };
    await page.setViewportSize(viewport);
    await registerAndGoto(page, '/logs', 'logs-history-empty');

    await expect(page.locator('.terminal__body')).toBeVisible();
    expect(historyRequests()).toBe(1);
    await expect(page.locator('.terminal__empty')).toBeVisible();
    await expect(page.locator('[data-test="logs-line"]')).toHaveCount(0);
    expect(pageErrors).toEqual([]);

    await saveSyntheticScreenshot(page, 'logs-history-empty.png');
  });

  test('renderiza historial largo en orden y solo sigue el final con autoscroll activo', async ({
    page
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const tag = `q${Date.now().toString(36)}`;
    // GET /api/logs devuelve primero lo más reciente; el cliente debe invertirlo.
    const logs: HistoryLog[] = Array.from({ length: 250 }, (_, index) => {
      const sequence = 249 - index;
      return {
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
        level: 'info',
        source: 'server',
        message: `${tag}-${String(sequence).padStart(3, '0')}`
      };
    });
    const historyRequests = await stubHistory(page, logs);
    const viewport =
      test.info().project.name === 'mobile-chrome'
        ? { width: 393, height: 851 }
        : { width: 1440, height: 900 };
    await page.setViewportSize(viewport);
    await registerAndGoto(page, '/logs', 'logs-history-long');

    const body = page.locator('.terminal__body');
    const fixtureLines = page.locator('[data-test="logs-line"]').filter({ hasText: tag });
    await expect(page.locator('[data-test="logs-status"]')).toContainText('En vivo', {
      timeout: 15_000
    });
    await expect(fixtureLines).toHaveCount(250);
    expect(historyRequests()).toBe(1);
    await expect(fixtureLines.first()).toContainText(`${tag}-000`);
    await expect(fixtureLines.last()).toContainText(`${tag}-249`);

    const maxScroll = await body.evaluate((element) => element.scrollHeight - element.clientHeight);
    expect(maxScroll).toBeGreaterThan(0);
    await expect
      .poll(() => body.evaluate((element) => element.scrollTop))
      .toBeGreaterThanOrEqual(maxScroll - 1);

    await saveSyntheticScreenshot(page, 'logs-history-long.png');

    await page.getByRole('button', { name: /Auto-scroll/ }).click();
    await body.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0);

    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const marker = `${tag}-live-after-scroll-off`;
    const response = await page.request.post('/api/logs', {
      data: { level: 'warn', message: marker, url: 'e2e' }
    });
    expect(response.ok()).toBeTruthy();
    await expect
      .poll(() =>
        page
          .locator('[data-test="logs-line"]')
          .evaluateAll(
            (lines, expectedMarker) =>
              lines.some((line) => line.textContent?.includes(expectedMarker)),
            marker
          )
      )
      .toBe(true);
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    expect(pageErrors).toEqual([]);
  });
});
