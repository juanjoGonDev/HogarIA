import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '../fixtures';
import { createHousehold, registerUser } from '../helpers/auth';

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

test.use({ serviceWorkers: 'block' });

test('Calendar loads its feature CSS before render and releases it on exit', async ({
  page
}, testInfo) => {
  const stylesheetRequests: string[] = [];
  let notifyFirstRequest: (() => void) | undefined;
  let releaseStylesheet: (() => void) | undefined;
  const firstRequestStarted = new Promise<void>((resolveStarted) => {
    notifyFirstRequest = resolveStarted;
  });
  const stylesheetGate = new Promise<void>((resolveGate) => {
    releaseStylesheet = resolveGate;
  });

  await page.route('**/calendar-feature.css', async (route) => {
    stylesheetRequests.push(route.request().url());
    notifyFirstRequest?.();
    await stylesheetGate;
    await route.continue();
  });

  await registerUser(page, 'Calendar styles E2E');
  await createHousehold(page, 'Hogar sintético estilos calendario');
  await page.goto('/dashboard');
  expect(stylesheetRequests).toHaveLength(0);
  await expect(page.locator('link[data-route-style="calendar"]')).toHaveCount(0);

  const calendarNavigation = page.goto('/calendar');
  await firstRequestStarted;
  await expect(page.locator('app-calendar')).toHaveCount(0);
  expect(stylesheetRequests).toHaveLength(1);

  releaseStylesheet?.();
  await calendarNavigation;
  const calendarHeader = page.locator('app-calendar .cal-top');
  await expect(calendarHeader).toBeVisible();
  await expect(page.locator('link[data-route-style="calendar"]')).toHaveCount(1);
  expect(await calendarHeader.evaluate((element) => getComputedStyle(element).display)).toBe(
    'flex'
  );

  await page.goto('/dashboard');
  await expect(page.locator('app-calendar')).toHaveCount(0);
  await expect(page.locator('link[data-route-style="calendar"]')).toHaveCount(0);
  expect(stylesheetRequests).toHaveLength(1);

  await page.goto('/calendar');
  await expect(calendarHeader).toBeVisible();
  await expect(page.locator('link[data-route-style="calendar"]')).toHaveCount(1);
  expect(stylesheetRequests).toHaveLength(2);

  if (SCREENSHOT_DIR) {
    const outputDir = resolve(SCREENSHOT_DIR, testInfo.project.name);
    mkdirSync(outputDir, { recursive: true });

    if (testInfo.project.name === 'chromium') {
      for (const viewport of [
        { name: 'desktop', width: 1440, height: 900 },
        { name: 'tablet', width: 768, height: 1024 }
      ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await expect(calendarHeader).toBeVisible();
        await page.screenshot({
          path: join(outputDir, `calendar-${viewport.name}.png`),
          fullPage: true
        });
      }
    } else {
      for (const viewport of [
        { name: 'mobile', width: 393, height: 851 },
        { name: 'mobile-320', width: 320, height: 568 }
      ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await expect(calendarHeader).toBeVisible();
        await page.screenshot({
          path: join(outputDir, `calendar-${viewport.name}.png`),
          fullPage: true
        });
      }
    }
  }
});
