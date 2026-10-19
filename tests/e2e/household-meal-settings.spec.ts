import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createHousehold } from './helpers/auth';

async function registerForHousehold(page: Page): Promise<void> {
  await page.goto('/auth/register');
  await page.locator('input#name').waitFor({ state: 'visible' });
  await page.locator('input#name').fill('Miembro sintético planificación');
  await page.locator('input#email').fill(`meal-planning-${randomUUID()}@example.test`);
  await page.locator('input#password').fill('Test1234');
  const registration = page.waitForResponse((response) =>
    response.url().includes('/api/auth/register')
  );
  await page.locator('button[type="submit"]').click();
  const response = await registration;
  expect(response.status(), await response.text()).toBe(201);
  await expect(page).toHaveURL(/\/(dashboard|onboarding|household)(\?|$)/, { timeout: 45000 });
  if (new URL(page.url()).pathname.endsWith('/onboarding')) {
    await page.getByRole('button', { name: /Saltar por ahora/i }).click();
    await expect(page).toHaveURL(/\/(dashboard|household)/, { timeout: 45000 });
  }
  await page.goto('/household');
}

async function expectHouseholdTabsNotToOverlap(page: Page): Promise<void> {
  const bounds = await page
    .locator('[role="tab"][data-test^="household-tab-"]')
    .evaluateAll((tabs) =>
      tabs.map((tab) => {
        const { left, right } = tab.getBoundingClientRect();
        return { left, right };
      })
    );
  for (let index = 0; index < bounds.length - 1; index += 1) {
    expect(bounds[index].right).toBeLessThanOrEqual(bounds[index + 1].left + 1);
  }
}

test('configuración de comidas carga, reintenta y guarda campos parciales en Planificación', async ({
  page
}, testInfo) => {
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  await registerForHousehold(page);
  await createHousehold(page, 'Casa sintética planificación');

  let loadAttempts = 0;
  let failLoads = true;
  await page.route('**/api/household/meal-planning', async (route) => {
    if (route.request().method() === 'GET') {
      loadAttempts += 1;
      if (failLoads) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'Synthetic transient failure' })
        });
        return;
      }
    }
    await route.continue();
  });

  await page.goto('/household?tab=tasks&planning=settings');
  await expect(page.locator('[data-test="household-tab-tasks"]')).toHaveText('Planificación');
  const panel = page.locator('[data-test="household-planning-panel-settings"]');
  await expect(panel).toBeVisible();
  await expectHouseholdTabsNotToOverlap(page);
  await expect(panel.getByRole('alert')).toContainText('No se pudo cargar. Reintenta.');
  await expect(page.locator('[data-test="meal-settings-retry"] button')).toBeEnabled();

  const attemptsBeforeManualRetry = loadAttempts;
  failLoads = false;
  const retryResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().includes('/api/household/meal-planning')
  );
  await page.locator('[data-test="meal-settings-retry"] button').click();
  expect((await retryResponse).status()).toBe(200);
  await expect(panel.locator('[data-test="meal-settings-content"]')).toBeVisible();
  expect(loadAttempts).toBeGreaterThan(attemptsBeforeManualRetry);
  await expect(panel.getByRole('heading', { name: 'Planificación de comidas' })).toBeVisible();
  await expect(page.locator('[data-test="member-goal-override"]')).toHaveAttribute(
    'aria-checked',
    'false'
  );
  await expect(page.locator('[data-test="member-schedule-override"]')).toHaveAttribute(
    'aria-checked',
    'false'
  );

  const patchRequestPromise = page.waitForRequest(
    (request) =>
      request.url().includes('/api/household/meal-planning') && request.method() === 'PATCH'
  );
  await page.locator('[data-test="household-objective-notes"]').fill('Menú familiar sintético');
  await page.locator('[data-test="meal-settings-save"] button').click();
  const patchRequest = await patchRequestPromise;
  expect(JSON.parse(patchRequest.postData() ?? '{}')).toEqual({
    household: { objective: { notes: 'Menú familiar sintético' } }
  });
  await expect(panel.getByRole('status').filter({ hasText: 'Guardado' })).toBeVisible();

  await page.locator('[data-test="member-schedule-override"]').click();
  await expect(page.locator('[data-test="member-dinner-time"]')).toBeVisible();
  const personalMealTypes: Record<string, boolean> = {};
  const personalMealTimes: Record<string, string> = {};
  for (const meal of ['breakfast', 'lunch', 'snack', 'dinner']) {
    const checked = await page
      .locator(`[data-test="member-meal-${meal}"] button`)
      .getAttribute('aria-checked');
    personalMealTypes[meal] = checked === 'true';
    personalMealTimes[meal] = await page.locator(`[data-test="member-${meal}-time"]`).inputValue();
  }
  const schedulePatchPromise = page.waitForRequest(
    (request) =>
      request.url().includes('/api/household/meal-planning') && request.method() === 'PATCH'
  );
  await page.locator('[data-test="meal-settings-save"] button').click();
  const schedulePatch = await schedulePatchPromise;
  expect(JSON.parse(schedulePatch.postData() ?? '{}')).toEqual({
    member: {
      scheduleOverrideEnabled: true,
      schedule: { mealTypes: personalMealTypes, mealTimes: personalMealTimes }
    }
  });
  await expect(panel.getByRole('status').filter({ hasText: 'Guardado' })).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(viewport.width);
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect(page.locator('[data-test="household-tab-tasks"]')).toBeInViewport();
  const screenshotPath = resolve(
    `.e2e-screenshots/household-meal-settings/${testInfo.project.name}-planning.png`
  );
  await mkdir(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled' });

  if (testInfo.project.name === 'mobile-chrome') {
    for (const size of [
      { width: 320, height: 568 },
      { width: 568, height: 320 }
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(size.width);
      await expectHouseholdTabsNotToOverlap(page);
    }
  }
});
