import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { shoppingNewListAction } from './helpers/shopping-ui';

type Viewport = { width: number; height: number };

const isItemPatch = (response: import('@playwright/test').Response): boolean => {
  const path = new URL(response.url()).pathname;
  return (
    path.startsWith('/api/shopping/lists/') &&
    path.includes('/items/') &&
    response.request().method() === 'PATCH'
  );
};

async function verifyDiscountStacking(page: Page, testInfo: TestInfo, viewport: Viewport) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message.split('\n')[0]));
  await registerAndGoto(page, '/shopping', `discount-stack-${viewport.width}`);
  await shoppingNewListAction(page).click();
  await page.locator('[data-test="list-name"]').fill('Descuentos combinados');
  await page.locator('[data-test="create-submit"]').click();
  await expect(page).toHaveURL(/\/shopping\/[\w-]+$/);

  await page.locator('[data-test="add-input"]').fill('3 Yogur');
  await page.locator('[data-test="add-submit"]').click();
  const row = page.locator('[data-test="item-row"]').first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Acciones de la linea' }).click();
  const editSheet = page.locator('[data-test="edit-sheet"]');
  await expect(editSheet).toBeVisible();
  await expect(editSheet.locator('input[name="qty"]')).toHaveValue('3');

  const priceSaved = page.waitForResponse(isItemPatch);
  const priceInput = editSheet.locator('[data-test="price-input"]');
  await priceInput.fill('10');
  await priceInput.blur();
  expect((await priceSaved).ok()).toBe(true);

  const offerSaved = page.waitForResponse(isItemPatch);
  await editSheet.locator('[data-test="offer-preset"]', { hasText: '3x2' }).click();
  expect((await offerSaved).ok()).toBe(true);
  await expect(page.locator('[data-test="total"]')).toHaveText('20,00 €');
  await expect(row.locator('[data-test="offer-chip"]')).toHaveText('3x2');

  const lineDiscountSaved = page.waitForResponse(isItemPatch);
  await editSheet.locator('[data-test="line-discount-kind"]', { hasText: 'Porcentaje' }).click();
  await editSheet.locator('[data-test="line-discount-percent"]').fill('10');
  await editSheet.locator('[data-test="line-discount-units"]').fill('2');
  await editSheet.locator('[data-test="edit-close"]').click();
  expect((await lineDiscountSaved).ok()).toBe(true);
  await expect(editSheet).toHaveCount(0);
  await expect(row.locator('[data-test="line-discount-chip"]')).toContainText('10 % en 2');
  await expect(page.locator('[data-test="total"]')).toHaveText('18,00 €');

  if (viewport.width <= 601 && testInfo.project.name === 'mobile-chrome') {
    const nameLayout = await row.locator('.detail__name').evaluate((element) => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
      return { width: element.clientWidth, height: element.clientHeight, lineHeight };
    });
    expect(nameLayout.width).toBeGreaterThanOrEqual(50);
    expect(nameLayout.height).toBeLessThanOrEqual(nameLayout.lineHeight * 1.5);
    const rowLayout = await row.locator('.detail__face').evaluate((face) => {
      const faceRect = face.getBoundingClientRect();
      const chips = Array.from(
        face.querySelectorAll<HTMLElement>(
          '[data-test="offer-chip"], [data-test="line-discount-chip"]'
        )
      ).map((chip) => chip.getBoundingClientRect());
      return {
        clientWidth: face.clientWidth,
        scrollWidth: face.scrollWidth,
        chipsInside: chips.every(
          (chip) => chip.left >= faceRect.left && chip.right <= faceRect.right
        )
      };
    });
    expect(rowLayout.scrollWidth).toBeLessThanOrEqual(rowLayout.clientWidth);
    expect(rowLayout.chipsInside).toBe(true);
  }

  await activateFooterControl(
    page,
    testInfo,
    viewport,
    page.locator('[data-test="discount-open"]'),
    'touch'
  );
  const discountSheet = page.locator('[data-test="discount-sheet"]');
  await expect(discountSheet).toBeVisible();
  await discountSheet.locator('[data-test="discount-kind"]', { hasText: 'Importe' }).click();
  await discountSheet.locator('[data-test="discount-amount"]').fill('2,50');
  const basketDiscountSaved = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return (
      path.startsWith('/api/shopping/lists/') &&
      path.endsWith('/discount') &&
      response.request().method() === 'PUT'
    );
  });
  await discountSheet.locator('[data-test="discount-save"]').click();
  expect((await basketDiscountSaved).ok()).toBe(true);
  await expect(discountSheet).toHaveCount(0);
  await expect(page.locator('[data-test="total"]')).toHaveText('15,50 €');
  await expect(row.locator('[data-test="check"]')).toHaveAttribute('aria-checked', 'false');

  await activateFooterControl(
    page,
    testInfo,
    viewport,
    page.getByRole('button', { name: /Ver desglose/i })
  );
  await expect(page.locator('.detail__estimate-row--sum')).toContainText('-2,00 €');
  await expect(page.locator('.detail__estimate')).toContainText('18,00 €');
  await page.reload();
  await expect(page.locator('[data-test="total"]')).toHaveText('15,50 €');
  await expect(page.locator('[data-test="offer-chip"]')).toHaveText('3x2');
  await expect(page.locator('[data-test="line-discount-chip"]')).toContainText('10 % en 2');
  await expect(page.locator('[data-test="discount-open"]')).toContainText('2,50');
  await activateFooterControl(
    page,
    testInfo,
    viewport,
    page.getByRole('button', { name: /Ver desglose/i })
  );
  await expect(page.locator('.detail__estimate-row--sum')).toContainText('-2,00 €');

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  if (testInfo.project.name === 'mobile-chrome' && viewport.width === 600) {
    const measureRow = () =>
      row.locator('.detail__face').evaluate((face) => {
        const faceRect = face.getBoundingClientRect();
        const nameRect = face.querySelector('.detail__name')!.getBoundingClientRect();
        return {
          faceWidth: faceRect.width,
          faceHeight: faceRect.height,
          nameWidth: nameRect.width,
          nameHeight: nameRect.height
        };
      });
    const at600 = await measureRow();
    await page.setViewportSize({ width: 601, height: viewport.height });
    const at601 = await measureRow();
    expect(at601.faceWidth - at600.faceWidth).toBe(1);
    expect(Math.abs(at601.faceHeight - at600.faceHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(at601.nameHeight - at600.nameHeight)).toBeLessThanOrEqual(1);
    await page.setViewportSize(viewport);
  }
  expect(errors).toEqual([]);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const screenshotDirectory = join(
    process.cwd(),
    '.e2e-screenshots',
    'qa-shopping-discount-stacking-20261010'
  );
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: join(
      screenshotDirectory,
      `discount-stacking-${testInfo.project.name}-${viewport.width}x${viewport.height}.png`
    ),
    animations: 'disabled'
  });
}

async function activateFooterControl(
  page: Page,
  testInfo: TestInfo,
  viewport: Viewport,
  control: Locator,
  activation: 'touch' | 'keyboard' = 'keyboard'
) {
  await expect(control).toBeVisible();
  if (testInfo.project.name === 'mobile-chrome' && viewport.width === 320) {
    if (activation === 'touch') {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
      return;
    }
    // The 320 px mobile emulation misroutes locator hit-tests for sticky-footer controls.
    // Keyboard activation keeps the disclosure check real and accessible; touch is checked above.
    await control.focus();
    expect(await control.evaluate((element) => element === document.activeElement)).toBe(true);
    await control.press('Enter');
    return;
  }
  await control.click();
}

test.describe('descuentos combinados en escritorio', () => {
  const viewport = { width: 1440, height: 900 };
  test.use({ viewport });

  test('aplica oferta, descuento de línea y cupón en orden de caja', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'La matriz desktop usa Chromium.');
    await verifyDiscountStacking(page, testInfo, viewport);
  });
});

function mobileViewportSuite(viewport: Viewport) {
  test.describe(`descuentos combinados en móvil ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test('aplica oferta, descuento de línea y cupón en orden de caja', async ({
      page
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile-chrome', 'La matriz Pixel 5 usa Chromium móvil.');
      await verifyDiscountStacking(page, testInfo, viewport);
    });
  });
}

mobileViewportSuite({ width: 393, height: 851 });
mobileViewportSuite({ width: 320, height: 568 });
mobileViewportSuite({ width: 600, height: 851 });
mobileViewportSuite({ width: 601, height: 851 });
