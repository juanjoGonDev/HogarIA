import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator } from './fixtures';
import { createHousehold, registerAndGoto, registerToOnboarding } from './helpers/auth';

const SCREENSHOTS =
  process.env.E2E_SCREENSHOT_DIR ??
  join(process.cwd(), '.e2e-screenshots', 'preferences-custom-limits');

async function activate(locator: Locator, isMobile: boolean): Promise<void> {
  if (isMobile) await locator.tap();
  else await locator.click();
}

async function capture(
  page: import('@playwright/test').Page,
  name: string,
  fullPage = true
): Promise<void> {
  mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: join(SCREENSHOTS, name), fullPage, animations: 'disabled' });
}

test.describe('límites de opciones personalizadas en Preferencias', () => {
  test.use({ serviceWorkers: 'block' });

  test('persiste el límite válido y no permite añadir un valor que la API rechazaría', async ({
    page
  }, testInfo) => {
    const isMobile = testInfo.project.name === 'mobile-chrome';
    await registerAndGoto(page, '/preferences?tab=allergies', 'preferences-custom-limits');

    const viewports = [
      { width: 1440, height: 900 },
      { width: 1025, height: 768 },
      { width: 1024, height: 768 },
      { width: 1023, height: 768 },
      { width: 601, height: 844 },
      { width: 600, height: 844 },
      { width: 599, height: 844 },
      { width: 390, height: 844 },
      { width: 320, height: 740 },
      { width: 568, height: 320 }
    ];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expect(page.locator('.preferences__panel-title')).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
      if (viewport.width === 1440)
        await capture(page, 'preferences-allergies-desktop-1440x900.png');
      if (viewport.width === 390)
        await capture(page, 'preferences-allergies-mobile-390x844.png', false);
      if (viewport.width === 320)
        await capture(page, 'preferences-allergies-mobile-320x740.png', false);
    }

    await page.setViewportSize(
      isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }
    );
    const control = page.locator('app-chip-select');
    const input = control.locator('.chip-select__input');
    const add = control.getByRole('button', { name: 'Añadir' });
    const validValue = `${'A '.repeat(29)}A!`;
    const invalidValue = 'B'.repeat(61);
    expect(validValue.trim().length).toBe(60);

    await input.fill(`  ${validValue}  `);
    await activate(add, isMobile);
    const validChip = control.locator('.chip-select__chip', { hasText: validValue.trim() });
    await expect(validChip).toHaveAttribute('aria-pressed', 'true');

    const saveResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/taste' &&
        response.request().method() === 'PATCH'
    );
    await activate(page.getByRole('button', { name: 'Guardar preferencias' }), isMobile);
    expect((await saveResponse).status()).toBe(200);
    await expect(page.locator('.toast--success').filter({ hasText: 'Guardado' })).toBeVisible();
    await page.reload();
    await expect(
      page.locator('app-chip-select .chip-select__chip--on', { hasText: validValue.trim() })
    ).toHaveCount(1);

    const persistedChip = page.locator('app-chip-select .chip-select__chip', {
      hasText: validValue.trim()
    });
    await activate(persistedChip, isMobile);
    await expect(persistedChip).toHaveCount(0);
    await activate(page.getByRole('button', { name: 'Descartar cambios' }), isMobile);
    await expect(
      page.locator('app-chip-select .chip-select__chip--on', { hasText: validValue.trim() })
    ).toHaveCount(1);

    await input.fill(invalidValue);
    await activate(add, isMobile);
    await expect(control.locator('.chip-select__chip', { hasText: invalidValue })).toHaveCount(0);
    await expect(input).toHaveValue(invalidValue);
    await expect(control.locator('[role="alert"]')).toContainText('60');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await input.evaluate((element) => (element as HTMLInputElement).blur());
    const dismissToast = page.locator('.toast__close').last();
    if (await dismissToast.isVisible()) await activate(dismissToast, isMobile);
    const errorScreenshot = isMobile
      ? 'preferences-custom-limit-mobile-error.png'
      : 'preferences-custom-limit-desktop-error.png';
    if (isMobile) await input.scrollIntoViewIfNeeded();
    await capture(page, errorScreenshot, !isMobile);

    const finalSave = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/taste' &&
        response.request().method() === 'PATCH'
    );
    await activate(page.getByRole('button', { name: 'Guardar preferencias' }), isMobile);
    expect((await finalSave).status()).toBe(200);
    await expect(page.locator('.toast--success').filter({ hasText: 'Guardado' })).toBeVisible();

    await page.evaluate(() => localStorage.setItem('hogar:v1:language', 'en'));
    await page.reload();
    const englishControl = page.locator('app-chip-select');
    const englishInput = englishControl.locator('.chip-select__input');
    await englishInput.fill(invalidValue);
    await activate(englishControl.getByRole('button', { name: 'Add' }), isMobile);
    await expect(englishControl.locator('[role="alert"]')).toHaveText(
      'Options must be 1 to 60 characters long.'
    );
    await expect(englishInput).toHaveAttribute('aria-invalid', 'true');
  });

  test('aplica los mismos límites a alergias y gustos durante el onboarding', async ({
    page
  }, testInfo) => {
    const isMobile = testInfo.project.name === 'mobile-chrome';
    await registerToOnboarding(page, 'preferences-custom-onboarding');
    await createHousehold(page, 'Hogar sintético de preferencias');
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/onboarding$/);
    await activate(page.getByRole('button', { name: 'Siguiente' }), isMobile);

    const invalidValue = 'O'.repeat(61);
    const allergyControl = page.locator('app-chip-select').first();
    const allergyInput = allergyControl.locator('.chip-select__input');
    await allergyInput.fill(invalidValue);
    await activate(allergyControl.getByRole('button', { name: 'Añadir' }), isMobile);
    await expect(
      allergyControl.locator('.chip-select__chip', { hasText: invalidValue })
    ).toHaveCount(0);
    await expect(allergyControl.locator('[role="alert"]')).toContainText('60');
    await expect(allergyInput).toHaveAttribute('aria-invalid', 'true');

    await activate(page.getByRole('button', { name: 'Siguiente' }), isMobile);
    const tasteControls = page.locator('app-chip-select');
    await expect(tasteControls).toHaveCount(2);
    for (let index = 0; index < 2; index++) {
      const control = tasteControls.nth(index);
      const input = control.locator('.chip-select__input');
      await input.fill(invalidValue);
      await activate(control.getByRole('button', { name: 'Añadir' }), isMobile);
      await expect(control.locator('.chip-select__chip', { hasText: invalidValue })).toHaveCount(0);
      await expect(control.locator('[role="alert"]')).toContainText('60');
      await expect(input).toHaveAttribute('aria-invalid', 'true');
    }
  });
});
