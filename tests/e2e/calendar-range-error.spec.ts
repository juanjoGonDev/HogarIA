import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

async function waitForPaint(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}

test('an initial range failure is announced, does not claim the calendar is empty, and retries', async ({
  page
}, testInfo) => {
  let blockedRequests = 0;
  let retryRequests = 0;
  let retryEnabled = false;
  const pageErrors: string[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route(/\/api\/calendar\/range(?:\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    if (!retryEnabled) {
      blockedRequests++;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Synthetic range outage' })
      });
      return;
    }

    retryRequests++;
    await route.continue();
  });

  await registerAndGoto(page, '/calendar', 'calendar-range-error');
  await expect(page.locator('h1.calendar__title')).toBeVisible();

  const retryButton = page.getByRole('button', { name: 'Reintentar', exact: true });
  const errorNotice = page.locator('.cal-strip__hint').filter({ has: retryButton });
  await expect(retryButton).toBeVisible();
  await expect(errorNotice).toContainText('No se han podido cargar tus comidas.');
  await expect(errorNotice).toHaveAttribute('role', 'alert');
  expect(await page.getByText(/^Nada planificado en/).count()).toBe(0);
  expect(await page.locator('.cal-strip__value').count()).toBe(0);
  expect(blockedRequests).toBeGreaterThan(0);
  await expect(page.locator('.cal-skeleton')).toHaveCount(0);
  await expect(page.locator('.cal-body')).toHaveAttribute('aria-busy', 'false');
  await waitForPaint(page);
  expect(await page.locator('.toast--error').count()).toBe(0);

  const screenshotDirectory = resolve(
    process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-calendar-range-error-20261009'
  );
  mkdirSync(screenshotDirectory, { recursive: true });
  await retryButton.scrollIntoViewIfNeeded();
  await expect(retryButton).toBeInViewport();
  await waitForPaint(page);
  await page.screenshot({
    path: join(screenshotDirectory, `${testInfo.project.name}-range-error.png`)
  });

  if (testInfo.project.name === 'mobile-chrome') {
    await page.setViewportSize({ width: 320, height: 568 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      )
    ).toBe(false);
    await retryButton.scrollIntoViewIfNeeded();
    await expect(retryButton).toBeInViewport();
    await waitForPaint(page);
    await expect(errorNotice).toBeVisible();
    await page.screenshot({ path: join(screenshotDirectory, 'mobile-chrome-320x568.png') });
  }

  await retryButton.focus();
  await expect(retryButton).toBeFocused();
  retryEnabled = true;
  const recovered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/calendar/range' && response.status() === 200;
  });
  await page.keyboard.press('Enter');
  await recovered;

  await expect(errorNotice).toHaveCount(0);
  await expect(page.locator('.cal-strip__value').first()).toBeVisible();
  await expect(page.locator('.cal-strip__hint:not([role="alert"])')).toBeVisible();
  await expect(page.locator('.cal-body')).toHaveAttribute('aria-busy', 'false');
  expect(retryRequests).toBe(1);
  expect(pageErrors).toEqual([]);
});
