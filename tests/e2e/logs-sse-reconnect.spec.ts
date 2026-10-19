import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

test.describe('reconexión SSE del visor de Logs', () => {
  test('recupera una conexión caída sin recargar ni entrar en bucle', async ({ page, request }) => {
    await registerAndGoto(page, '/dashboard', 'logs-sse-reconnect');

    let streamAttempts = 0;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/api/logs/stream*', async (route) => {
      streamAttempts += 1;
      if (streamAttempts === 1) {
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    await page.goto('/logs');
    const status = page.locator('[data-test="logs-status"]');
    await expect(page.locator('.terminal__body')).toBeVisible();
    const documentStart = await page.evaluate(() => performance.timeOrigin);
    await expect.poll(() => streamAttempts).toBe(1);
    await expect(status).toContainText(/Reintentando/);
    await expect.poll(() => streamAttempts, { timeout: 15000 }).toBe(2);
    await expect(status).toContainText('En vivo', { timeout: 15000 });

    const marker = `e2e-sse-reconnect-${Date.now()}`;
    await request.get(`/api/${marker}`);
    const markerLines = page.locator('[data-test="logs-line"]').filter({ hasText: marker });
    await expect(markerLines.first()).toBeVisible({ timeout: 10000 });

    // This is the Logs breakpoint; test both sides and the exact transition.
    for (const size of [
      { width: 320, height: 568 },
      { width: 393, height: 851 },
      { width: 568, height: 320 },
      { width: 1023, height: 768 },
      { width: 1024, height: 768 },
      { width: 1025, height: 768 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(size.width);
      await expect(status).toBeVisible();
    }

    // Give a stray browser retry or a duplicate application timer enough time to surface.
    await page.waitForTimeout(1500);
    expect(streamAttempts).toBe(2);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStart);
    expect(pageErrors).toEqual([]);
  });
});
