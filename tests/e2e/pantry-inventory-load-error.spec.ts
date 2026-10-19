import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect } from './fixtures';
import { createHousehold, registerUser } from './helpers/auth';

test('la despensa distingue el error de inventario y permite reintentar', async ({
  page
}, testInfo) => {
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
  await page.addInitScript(() => {
    const qaWindow = window as Window & { __qaUnhandledRejections?: string[] };
    qaWindow.__qaUnhandledRejections = [];
    window.addEventListener('unhandledrejection', (event) => {
      qaWindow.__qaUnhandledRejections?.push(String(event.reason));
    });
  });
  await page.setViewportSize(viewport);
  await registerUser(page, 'QA synthetic pantry load error');
  await createHousehold(page, 'Casa sintética: error carga despensa');

  let ingredientRequests = 0;
  await page.route('**/api/pantry/ingredients**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/pantry/ingredients') return route.continue();

    ingredientRequests += 1;
    if (ingredientRequests <= 2) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Synthetic inventory unavailable' })
      });
    }
    return route.continue();
  });

  await page.goto('/pantry');
  const error = page.locator('[data-test="pantry-inventory-error"]');
  const retryButton = page.locator('app-button[data-test="pantry-inventory-retry"] button');
  const dismissTransientErrorToast = async () => {
    const close = page.locator('.toast--error .toast__close').first();
    if (await close.count()) await close.click();
  };
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(retryButton).toHaveAccessibleName('Reintentar');
  await expect(page.locator('.empty-state')).toHaveCount(0);
  await expect(page.locator('[data-test="pantry-sugerencias"]')).toHaveCount(0);
  await dismissTransientErrorToast();
  const retryBounds = await page.evaluate(() => {
    const button = document
      .querySelector<HTMLElement>('app-button[data-test="pantry-inventory-retry"] button')
      ?.getBoundingClientRect();
    const navigation = document.querySelector<HTMLElement>('.bottom-nav')?.getBoundingClientRect();
    return {
      top: button?.top,
      bottom: button?.bottom,
      height: button?.height,
      viewportHeight: window.innerHeight,
      navigationTop: navigation?.top ?? window.innerHeight
    };
  });
  expect(retryBounds.top).toBeGreaterThanOrEqual(0);
  expect(retryBounds.height).toBeGreaterThanOrEqual(44);
  expect(retryBounds.bottom).toBeLessThanOrEqual(retryBounds.viewportHeight);
  if (testInfo.project.name !== 'chromium') {
    expect(retryBounds.bottom).toBeLessThanOrEqual(retryBounds.navigationTop);

    for (const size of [
      { width: 320, height: 568 },
      { width: 719, height: 851 },
      { width: 720, height: 851 },
      { width: 851, height: 393 }
    ]) {
      await page.setViewportSize(size);
      await retryButton.scrollIntoViewIfNeeded();
      await expect(retryButton).toBeVisible();
      const geometry = await page.evaluate(() => {
        const alert = document
          .querySelector<HTMLElement>('[data-test="pantry-inventory-error"]')
          ?.getBoundingClientRect();
        const button = document
          .querySelector<HTMLElement>('app-button[data-test="pantry-inventory-retry"] button')
          ?.getBoundingClientRect();
        const navigation = document
          .querySelector<HTMLElement>('.bottom-nav')
          ?.getBoundingClientRect();
        if (!alert || !button) throw new Error('No se dibujó el estado de error de inventario');
        return {
          alertLeft: alert.left,
          alertRight: alert.right,
          buttonBottom: button.bottom,
          viewportWidth: window.innerWidth,
          navigationTop: navigation?.top ?? window.innerHeight,
          documentWidth: document.documentElement.scrollWidth
        };
      });
      expect(geometry.alertLeft).toBeGreaterThanOrEqual(0);
      expect(geometry.alertRight).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.buttonBottom).toBeLessThanOrEqual(geometry.navigationTop);
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    }
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  }

  const screenshotDirectory = join(
    resolve(process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-pantry-inventory-load-error-1'),
    testInfo.project.name
  );
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: join(screenshotDirectory, 'error-retry.png'),
    fullPage: false,
    animations: 'disabled'
  });

  const secondFailure = page.waitForResponse(
    (response) => response.url().includes('/api/pantry/ingredients') && response.status() === 503
  );
  await retryButton.click();
  await secondFailure;
  await expect(error).toBeVisible();
  await expect(page.locator('.empty-state')).toHaveCount(0);
  await expect(page.locator('[data-test="pantry-sugerencias"]')).toHaveCount(0);
  await dismissTransientErrorToast();

  const successfulRetry = page.waitForResponse(
    (response) =>
      response.url().includes('/api/pantry/ingredients') &&
      response.status() >= 200 &&
      response.status() < 300
  );
  if (testInfo.project.name === 'chromium') {
    await retryButton.click();
  } else {
    await retryButton.focus();
    await expect(retryButton).toBeFocused();
    await retryButton.press('Enter');
  }
  await successfulRetry;
  await expect(error).toHaveCount(0);
  const suggestions = page.locator('[data-test="pantry-sugerencias"]');
  await expect(suggestions).toBeVisible();
  await expect(page.locator('app-loading')).toHaveCount(0);
  await suggestions.screenshot({
    path: join(screenshotDirectory, 'recovered-inventory.png'),
    animations: 'disabled'
  });

  const unhandledRejections = await page.evaluate(() => {
    const qaWindow = window as Window & { __qaUnhandledRejections?: string[] };
    return qaWindow.__qaUnhandledRejections ?? [];
  });
  expect(ingredientRequests).toBe(3);
  expect(pageErrors).toEqual([]);
  expect(unhandledRejections).toEqual([]);
});
