import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerWithHousehold } from './helpers/auth';

const isoOf = (date: Date): string =>
  `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;

const mondayOfCurrentWeek = (): string => {
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return isoOf(monday);
};

test.describe('Guardado de objetivos del hogar activo', () => {
  test.beforeEach(async ({ page }) => {
    await registerWithHousehold(page, '/calendar', 'Objetivos E2E');
    await expect(page.locator('h1.calendar__title')).toBeVisible();
  });

  test('mantiene el borrador durante el PATCH, informa del error y permite reintentar en el hogar', async ({
    page
  }, testInfo) => {
    let signalFirstPatchStarted!: () => void;
    let releaseFirstPatch!: () => void;
    const firstPatchStarted = new Promise<void>((resolveStarted) => {
      signalFirstPatchStarted = resolveStarted;
    });
    const firstPatchGate = new Promise<void>((resolveGate) => {
      releaseFirstPatch = resolveGate;
    });
    const payloads: unknown[] = [];

    await page.route('**/api/calendar/goals', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }

      payloads.push(route.request().postDataJSON());
      if (payloads.length === 1) {
        signalFirstPatchStarted();
        await firstPatchGate;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Synthetic save failure' })
        });
        return;
      }

      // El segundo intento llega a la API aislada y escribe en el hogar recién creado para esta prueba.
      await route.continue();
    });

    await page.locator('.cal-pill', { hasText: 'Objetivo' }).click();
    const modal = page.locator('.modal-overlay');
    await expect(modal).toBeVisible();
    await modal.locator('.goal-option', { hasText: 'Perder peso' }).click();
    await modal.locator('.goal-option', { hasText: 'Personalizada' }).click();
    await modal.locator('#goals-custom').fill('Más legumbres y cenas sencillas.');
    await modal.locator('#goals-calories').fill('1850');

    const saveButton = modal.locator('[data-test="goals-save"]');
    await expect(saveButton).toHaveText('Guardar');
    await saveButton.click();
    await firstPatchStarted;

    await expect(modal).toBeVisible();
    await expect(saveButton).toBeDisabled();
    await expect(saveButton).toHaveAttribute('aria-busy', 'true');
    await expect(saveButton).toContainText('Guardando');
    await expect(modal.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(modal).toBeVisible();

    releaseFirstPatch();
    const saveError = modal.locator('[data-test="goals-save-error"]');
    await expect(saveError).toHaveAttribute('role', 'alert');
    await expect(saveError).toContainText('Tus cambios siguen aquí');
    await expect(saveButton).toBeEnabled();
    await expect(saveButton).toHaveText('Reintentar');
    await expect(modal.locator('.goal-option', { hasText: 'Perder peso' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(modal.locator('.goal-option', { hasText: 'Personalizada' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(modal.locator('#goals-custom')).toHaveValue('Más legumbres y cenas sencillas.');
    await expect(modal.locator('#goals-calories')).toHaveValue('1850');

    const screenshotDirectory = resolve('.e2e-screenshots/qa-planner-goals-save');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-save-error.png`),
      fullPage: false,
      animations: 'disabled'
    });
    if (testInfo.project.name === 'mobile-chrome') {
      await modal.locator('.modal__body').evaluate((body) => {
        body.scrollTop = body.scrollHeight;
      });
      await expect(saveButton).toBeInViewport();
      await page.screenshot({
        path: resolve(screenshotDirectory, 'mobile-chrome-save-error-actions.png'),
        fullPage: false,
        animations: 'disabled'
      });
    }

    await saveButton.click();
    await expect(modal).toHaveCount(0);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({
      types: ['weight-loss', 'custom'],
      customInstructions: 'Más legumbres y cenas sencillas.',
      dailyCalories: 1850,
      weekStart: mondayOfCurrentWeek()
    });
    expect(payloads[1]).toEqual(payloads[0]);
    await expect(page.getByText('Objetivos de la semana actualizados')).toBeVisible();

    await page.reload();
    await expect(page.locator('h1.calendar__title')).toBeVisible();
    await page.locator('.cal-pill', { hasText: 'Objetivo' }).click();
    const savedModal = page.locator('.modal-overlay');
    await expect(savedModal.locator('.goal-option', { hasText: 'Perder peso' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(savedModal.locator('.goal-option', { hasText: 'Personalizada' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(savedModal.locator('#goals-custom')).toHaveValue(
      'Más legumbres y cenas sencillas.'
    );
    await expect(savedModal.locator('#goals-calories')).toHaveValue('1850');
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-save-confirmed.png`),
      fullPage: false,
      animations: 'disabled'
    });
    if (testInfo.project.name === 'mobile-chrome') {
      await savedModal.locator('.modal__body').evaluate((body) => {
        body.scrollTop = body.scrollHeight;
      });
      await page.screenshot({
        path: resolve(screenshotDirectory, 'mobile-chrome-save-confirmed-details.png'),
        fullPage: false,
        animations: 'disabled'
      });
    }
  });
});
