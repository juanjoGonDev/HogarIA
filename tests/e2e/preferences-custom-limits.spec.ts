import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator } from './fixtures';
import { createHousehold, registerAndGoto, registerToOnboarding } from './helpers/auth';

const SCREENSHOTS =
  process.env.E2E_SCREENSHOT_DIR ??
  join(process.cwd(), '.e2e-screenshots', 'preferences-unbounded-text');

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

test.describe('texto largo en Preferencias', () => {
  test.use({ serviceWorkers: 'block' });

  test('persiste opciones sintéticas de más de 2500 caracteres', async ({ page }, testInfo) => {
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
    const longValue = `${'A '.repeat(1250)}A`;
    expect(longValue.length).toBe(2501);

    await expect(input).not.toHaveAttribute('maxlength');
    await input.fill(`  ${longValue}  `);
    await activate(add, isMobile);
    const longChip = control.locator('.chip-select__chip', { hasText: longValue });
    await expect(longChip).toHaveAttribute('aria-pressed', 'true');
    await expect(control.locator('[role="alert"]')).toHaveCount(0);

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
      page.locator('app-chip-select .chip-select__chip--on', { hasText: longValue })
    ).toHaveCount(1);

    const persistedChip = page.locator('app-chip-select .chip-select__chip', {
      hasText: longValue
    });
    await activate(persistedChip, isMobile);
    await expect(persistedChip).toHaveCount(0);
    await activate(page.getByRole('button', { name: 'Descartar cambios' }), isMobile);
    await expect(
      page.locator('app-chip-select .chip-select__chip--on', { hasText: longValue })
    ).toHaveCount(1);

    await page.evaluate(() => localStorage.setItem('hogar:v1:language', 'en'));
    await page.reload();
    const englishControl = page.locator('app-chip-select');
    const englishInput = englishControl.locator('.chip-select__input');
    await expect(englishInput).not.toHaveAttribute('maxlength');
    await englishInput.fill(longValue);
    await activate(englishControl.getByRole('button', { name: 'Add' }), isMobile);
    await expect(englishControl.locator('.chip-select__chip', { hasText: longValue })).toHaveCount(
      1
    );
    await expect(englishControl.locator('[role="alert"]')).toHaveCount(0);
  });

  test('acepta texto largo en alergias y gustos durante el onboarding', async ({
    page
  }, testInfo) => {
    const isMobile = testInfo.project.name === 'mobile-chrome';
    await registerToOnboarding(page, 'preferences-custom-onboarding');
    await createHousehold(page, 'Hogar sintético de preferencias');
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/onboarding$/);
    await activate(page.getByRole('button', { name: 'Siguiente' }), isMobile);

    const longValue = `${'O '.repeat(1250)}O`;
    expect(longValue.length).toBe(2501);
    const allergyControl = page.locator('app-chip-select').first();
    const allergyInput = allergyControl.locator('.chip-select__input');
    await expect(allergyInput).not.toHaveAttribute('maxlength');
    await allergyInput.fill(longValue);
    await activate(allergyControl.getByRole('button', { name: 'Añadir' }), isMobile);
    await expect(allergyControl.locator('.chip-select__chip', { hasText: longValue })).toHaveCount(
      1
    );
    await expect(allergyControl.locator('[role="alert"]')).toHaveCount(0);

    await activate(page.getByRole('button', { name: 'Siguiente' }), isMobile);
    const tasteControls = page.locator('app-chip-select');
    await expect(tasteControls).toHaveCount(2);
    for (let index = 0; index < 2; index++) {
      const control = tasteControls.nth(index);
      const input = control.locator('.chip-select__input');
      await expect(input).not.toHaveAttribute('maxlength');
      await input.fill(longValue);
      await activate(control.getByRole('button', { name: 'Añadir' }), isMobile);
      await expect(control.locator('.chip-select__chip', { hasText: longValue })).toHaveCount(1);
      await expect(control.locator('[role="alert"]')).toHaveCount(0);
    }
  });
});
