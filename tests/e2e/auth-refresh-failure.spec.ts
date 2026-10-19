import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { registerUser } from './helpers/auth';

test.describe('Auth refresh failure', () => {
  test('ends protected requests and returns to login when refresh is rejected', async ({
    page
  }, testInfo) => {
    const pageErrors: string[] = [];
    const refreshStatuses: number[] = [];
    const protectedPaths: string[] = [];
    const protectedRequests = new Map<string, number>();

    function requestKey(method: string, url: string): string | null {
      const requestUrl = new URL(url);
      return requestUrl.pathname.startsWith('/api/') && requestUrl.pathname !== '/api/auth/refresh'
        ? `${method} ${requestUrl.pathname}${requestUrl.search}`
        : null;
    }

    function settleRequest(method: string, url: string): void {
      const key = requestKey(method, url);
      if (!key) return;
      const count = protectedRequests.get(key) ?? 0;
      if (count <= 1) protectedRequests.delete(key);
      else protectedRequests.set(key, count - 1);
    }

    page.on('pageerror', (error) => pageErrors.push(error.message));
    await registerUser(page, 'Expired session E2E');
    const isMobile = testInfo.project.name === 'mobile-chrome';
    // Drain the authenticated dashboard's bootstrap requests before measuring
    // the reload; late responses for the same URL can otherwise skew counts.
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      localStorage.setItem('hogar:v1:auth_token', `e30.${payload}.invalid-signature`);
      localStorage.setItem('hogar:v1:refresh_token', 'synthetic-invalid-refresh');
    });

    page.on('request', (request) => {
      const url = new URL(request.url());
      const key = requestKey(request.method(), request.url());
      if (!key) return;
      protectedPaths.push(url.pathname);
      protectedRequests.set(key, (protectedRequests.get(key) ?? 0) + 1);
    });
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (path === '/api/auth/refresh') {
        refreshStatuses.push(response.status());
      }
    });
    page.on('requestfinished', (request) => {
      settleRequest(request.method(), request.url());
    });
    page.on('requestfailed', (request) => {
      settleRequest(request.method(), request.url());
    });

    await page.setViewportSize(
      isMobile ? { width: 393, height: 851 } : { width: 1440, height: 900 }
    );
    await page.reload();

    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 20000 });
    await expect.poll(() => refreshStatuses.includes(401), { timeout: 10000 }).toBe(true);
    await expect.poll(() => protectedPaths.length, { timeout: 10000 }).toBeGreaterThan(0);
    await expect
      .poll(() => [...protectedRequests.values()].reduce((sum, n) => sum + n, 0), {
        timeout: 10000
      })
      .toBe(0);
    expect(pageErrors).toEqual([]);
    expect(
      await page.evaluate(() => [
        localStorage.getItem('hogar:v1:auth_token'),
        localStorage.getItem('hogar:v1:refresh_token')
      ])
    ).toEqual([null, null]);

    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width);

    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.screenshot({
        path: join(screenshotDirectory, `${isMobile ? 'mobile' : 'desktop'}.png`),
        fullPage: true,
        animations: 'disabled'
      });
    }
  });
});
