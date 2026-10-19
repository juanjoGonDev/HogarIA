import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

function mealRow(
  page: import('@playwright/test').Page,
  meal: 'breakfast' | 'lunch' | 'snack' | 'dinner'
) {
  return page.locator('.meal-hours__row').filter({ has: page.locator(`#meal-${meal}`) });
}

test.describe('horarios y comidas planificables en Preferencias', () => {
  test.use({ serviceWorkers: 'block' });

  test('mantiene el borrador al navegar, descarta y guarda el parche exacto', async ({
    page
  }, testInfo) => {
    await registerAndGoto(page, '/preferences?tab=meals', 'preferences-meals');
    const breakfast = page.locator('#meal-breakfast');
    const dinnerPlan = mealRow(page, 'dinner').getByRole('checkbox');
    const saveButton = page.getByRole('button', { name: 'Guardar preferencias' });
    const discardButton = page.getByRole('button', { name: 'Descartar cambios' });

    await expect(page.locator('[data-test="preferences-tab-meals"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(breakfast).toHaveValue('09:00');
    await expect(page.locator('#meal-dinner')).toHaveValue('20:30');
    await expect(dinnerPlan).toHaveAttribute('aria-checked', 'true');

    await breakfast.fill('08:45');
    await dinnerPlan.click();
    await expect(page.locator('.preferences__state')).toContainText('Hay cambios sin guardar');

    await page.locator('[data-test="preferences-tab-goal"]').click();
    await expect(page).toHaveURL(/[?&]tab=goal/);
    await page.locator('[data-test="preferences-tab-meals"]').click();
    await expect(breakfast).toHaveValue('08:45');
    await expect(dinnerPlan).toHaveAttribute('aria-checked', 'false');

    await discardButton.click();
    await expect(breakfast).toHaveValue('09:00');
    await expect(dinnerPlan).toHaveAttribute('aria-checked', 'true');
    await expect(discardButton).toHaveCount(0);

    await breakfast.fill('08:30');
    const resetBreakfast = mealRow(page, 'breakfast').getByRole('button', { name: 'Por defecto' });
    await expect(resetBreakfast).toBeVisible();
    await resetBreakfast.click();
    await expect(breakfast).toHaveValue('09:00');
    await expect(resetBreakfast).toHaveCount(0);

    await breakfast.fill('08:45');
    await dinnerPlan.click();
    const patchRequest = page.waitForRequest(
      (request) => request.url().includes('/api/auth/taste') && request.method() === 'PATCH'
    );
    const patchResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/taste') && response.request().method() === 'PATCH'
    );
    await saveButton.click();
    const request = await patchRequest;
    expect((await patchResponse).status()).toBe(200);
    expect(request.postDataJSON()).toMatchObject({
      mealTimes: { breakfast: '08:45' },
      mealPlan: { dinner: false }
    });
    await expect(page.locator('.preferences__state--ok')).toBeVisible();

    await page.reload();
    await expect(breakfast).toHaveValue('08:45');
    await expect(dinnerPlan).toHaveAttribute('aria-checked', 'false');

    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      const viewport =
        testInfo.project.name === 'chromium'
          ? { width: 1440, height: 900 }
          : { width: 393, height: 851 };
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      const outputDirectory = resolve(screenshotDirectory);
      mkdirSync(outputDirectory, { recursive: true });
      await page.screenshot({
        path: join(outputDirectory, `preferences-meals-${testInfo.project.name}.png`),
        fullPage: testInfo.project.name === 'chromium',
        animations: 'disabled'
      });
    }
  });

  test('un error de guardado conserva los cambios y se puede reintentar sin duplicar el aviso', async ({
    page
  }) => {
    await registerAndGoto(page, '/preferences?tab=meals', 'preferences-meals-retry');
    const dinner = page.locator('#meal-dinner');
    await dinner.fill('21:45');

    let patchAttempts = 0;
    await page.route('**/api/auth/taste', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      patchAttempts += 1;
      if (patchAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Unavailable' })
        });
        return;
      }
      await route.continue();
    });

    const failedSave = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/taste') && response.request().method() === 'PATCH'
    );
    await page.getByRole('button', { name: 'Guardar preferencias' }).click();
    expect((await failedSave).status()).toBe(503);

    await expect(dinner).toHaveValue('21:45');
    await expect(page.locator('.preferences__state')).toContainText('Hay cambios sin guardar');
    await expect(page.locator('.toast--error')).toHaveCount(1);
    await expect(page.locator('.toast--error .toast__message')).toContainText('No se pudo guardar');

    await page.locator('.toast--error .toast__close').click();
    const retriedSave = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/taste') && response.request().method() === 'PATCH'
    );
    await page.getByRole('button', { name: 'Guardar preferencias' }).click();
    expect((await retriedSave).status()).toBe(200);
    await expect(page.locator('.preferences__state--ok')).toBeVisible();
    await expect(page.locator('.toast--error')).toHaveCount(0);
    await page.reload();
    await expect(dinner).toHaveValue('21:45');
    expect(patchAttempts).toBe(2);
  });
});
