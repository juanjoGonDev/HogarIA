import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';

async function assertEventCheckbox(page: Page, screenshotName: string): Promise<void> {
  await registerAndGoto(page, '/calendar');
  await page.locator('[data-test="event-add"]').click();
  const modal = page.locator('.modal-overlay');
  await expect(modal.locator('.modal__title')).toContainText('Apuntar un evento');
  await page.waitForFunction(() => {
    const dialog = document.querySelector('.modal-overlay [role="dialog"]');
    return dialog !== null && dialog.getAnimations().every((animation) => animation.playState === 'finished');
  });

  const allDay = modal.getByRole('checkbox', { name: 'Todo el día' });
  await expect(allDay).toHaveAccessibleName('Todo el día');
  await expect(allDay).toHaveAttribute('aria-checked', 'false');
  const bounds = await allDay.boundingBox();
  expect(bounds, 'el botón checkbox debe tener rectángulo visible').not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);

  const fitsViewport = await page.evaluate(() =>
    document.documentElement.scrollWidth <= (visualViewport?.width ?? innerWidth)
  );
  expect(fitsViewport).toBe(true);

  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: join(screenshotDirectory, screenshotName),
      animations: 'disabled'
    });
  }

  await allDay.focus();
  await expect(allDay).toBeFocused();
  await page.keyboard.press('Space');
  await expect(allDay).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#event-start')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(allDay).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('#event-start')).toBeVisible();

  await modal.getByRole('button', { name: 'Cancelar' }).click();
  await expect(modal).toHaveCount(0);
}

test.describe('Calendario: objetivo táctil de app-checkbox', () => {
  test.describe('escritorio 1440×900', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('Todo el día conserva nombre/teclado y alcanza 44×44 px', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium');
      await assertEventCheckbox(page, 'calendar-checkbox-desktop-1440x900.png');
    });
  });

  test.describe('móvil 393×851', () => {
    test.use({ viewport: { width: 393, height: 851 } });

    test('Todo el día conserva nombre/teclado y alcanza 44×44 px', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile-chrome');
      await assertEventCheckbox(page, 'calendar-checkbox-mobile-393x851.png');
    });
  });

  test.describe('móvil estrecho 320×568', () => {
    test.use({ viewport: { width: 320, height: 568 } });

    test('Todo el día conserva nombre/teclado y alcanza 44×44 px', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile-chrome');
      await assertEventCheckbox(page, 'calendar-checkbox-mobile-320x568.png');
    });
  });
});
