import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { shoppingNewListAction } from './helpers/shopping-ui';

async function openLineSheet(page: Page, slug: string): Promise<void> {
  await registerAndGoto(page, '/shopping', slug);
  await shoppingNewListAction(page).click();
  await page.locator('[data-test="list-name"]').fill('Lista unidades recientes');
  await page.locator('[data-test="create-submit"]').click();
  await expect(page).toHaveURL(/\/shopping\/[\w-]+$/);
  await page.locator('[data-test="add-input"]').fill('Leche');
  await page.locator('[data-test="add-submit"]').click();
  await page.locator('button[aria-label="Acciones de la linea"]').first().click();
  await expect(page.locator('[data-test="edit-sheet"]')).toBeVisible();
}

async function chooseUnit(page: Page, unit: string, custom = false): Promise<void> {
  const picker = page.locator('[data-test="unit-picker"]');
  await picker.locator('.picker__trigger').click();
  const search = picker.locator('.picker__search input');
  await expect(search).toBeFocused();
  await search.fill(unit);
  if (custom) await picker.locator('.picker__option--custom').click();
  else await picker.getByText(unit, { exact: true }).click();
  await expect(picker.locator('.picker__trigger')).toContainText(unit);
}

async function capture(page: Page, testInfo: TestInfo, fileName: string): Promise<void> {
  const root = process.env.E2E_SCREENSHOT_DIR;
  if (!root) return;
  const directory = join(root, testInfo.project.name);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: join(directory, fileName), animations: 'disabled' });
}

async function expectNoHorizontalOverflowAcrossBreakpoints(page: Page): Promise<void> {
  const originalViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 393, height: 851 },
    { width: 568, height: 320 },
    { width: 1023, height: 768 },
    { width: 1024, height: 768 },
    { width: 1025, height: 768 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    const width = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth
    }));
    expect(
      width.document,
      `horizontal overflow at ${viewport.width}x${viewport.height}`
    ).toBeLessThanOrEqual(width.viewport);
  }
  await page.setViewportSize(originalViewport);
}

test('fija las seis unidades más recientes y las restaura tras recargar', async ({
  page
}, testInfo) => {
  await openLineSheet(page, 'unit-recents-persist');
  const sequence = ['kg', 'g', 'L', 'ml', 'ud', 'bote', 'lata', 'bote de 400 g'];
  for (const unit of sequence) {
    await chooseUnit(page, unit, unit === 'bote de 400 g');
  }

  await page.locator('[data-test="edit-close"]').click();
  await expect(page.locator('[data-test="edit-sheet"]')).toHaveCount(0);
  await page.reload();
  await page.locator('button[aria-label="Acciones de la linea"]').first().click();
  const picker = page.locator('[data-test="unit-picker"]');
  await expect(picker.locator('.picker__trigger')).toContainText('bote de 400 g');
  await picker.locator('.picker__trigger').click();
  await capture(page, testInfo, 'shopping-unit-recents.png');
  await expect(picker.locator('.picker__group').first()).toHaveText('Recientes');

  const recentLabels = await picker.locator('.picker__option .picker__label').allTextContents();
  expect(recentLabels.slice(0, 6)).toEqual(['bote de 400 g', 'lata', 'bote', 'ud', 'ml', 'L']);
  expect(new Set(recentLabels.slice(0, 6).map((value) => value.toLocaleLowerCase('es'))).size).toBe(
    6
  );
  await expectNoHorizontalOverflowAcrossBreakpoints(page);
});

test('el filtro y el teclado conservan el contrato del combobox', async ({ page }) => {
  await openLineSheet(page, 'unit-recents-keyboard');
  const picker = page.locator('[data-test="unit-picker"]');
  const trigger = picker.locator('.picker__trigger');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const search = picker.locator('.picker__search input[role="combobox"]');
  await expect(search).toBeFocused();
  await search.fill('g');
  const activeId = await search.getAttribute('aria-activedescendant');
  expect(activeId).toBeTruthy();
  await expect(picker.locator(`#${activeId}`)).toHaveText('g');
  await search.press('ArrowUp');
  const previousId = await search.getAttribute('aria-activedescendant');
  expect(previousId).toBeTruthy();
  await expect(picker.locator(`#${previousId}`)).toHaveText('kg');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(trigger).toContainText('g');
  await trigger.click();
  await picker.locator('.picker__search input').press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});
