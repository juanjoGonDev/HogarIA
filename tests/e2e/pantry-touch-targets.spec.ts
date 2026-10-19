import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { registerWithHousehold } from './helpers/auth';

const ITEM_NAME = 'Ingrediente tactil QA';
const table = (page: Page): Locator => page.locator('[data-test="pantry-tabla-inventario"]');
const row = (page: Page, name = ITEM_NAME): Locator =>
  table(page).locator('tr.ingredient-item', { hasText: name });

function waitForInventoryRefresh(page: Page) {
  return page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === 'GET' && new URL(response.url()).pathname === '/api/pantry/ingredients'
    );
  });
}

async function waitForFocusRender(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}

async function addIngredient(page: Page, name = ITEM_NAME): Promise<void> {
  await page.getByRole('button', { name: '+ Agregar', exact: true }).click();
  await page.fill('input#ingredientName', name);
  await page.fill('input#quantity', '2');
  await page.locator('app-modal button[type="submit"]').click();
  await expect(page.locator('.toast--success').last()).toContainText('Agregado');
  await expect(row(page, name)).toBeVisible();
  await page.locator('.toast--success .toast__close').last().click();
  await expect(page.locator('.toast--success')).toHaveCount(0);
}

const actionSelectors = [
  '[data-test^="pantry-stock-menos-"]',
  '[data-test^="pantry-stock-mas-"]',
  '[data-test^="pantry-editar-"]',
  '[data-test^="pantry-eliminar-"]'
];

async function preparePantryPage(page: Page): Promise<void> {
  await registerWithHousehold(page, '/pantry');
  await expect(page.locator('h1.pantry__title')).toBeVisible();
  await addIngredient(page);
}

test.describe('Pantry — objetivos táctiles de acciones por ingrediente', () => {
  test.beforeEach(async ({ page }) => preparePantryPage(page));

  test('mide el rectángulo final de cada acción en móvil y en los bordes responsive', async ({
    page
  }, testInfo) => {
    const screenshotRoot = process.env.E2E_SCREENSHOT_DIR;
    const viewports = [
      { width: 320, height: 568 },
      { width: 393, height: 851 },
      { width: 568, height: 320 },
      { width: 719, height: 900 },
      { width: 720, height: 900 },
      { width: 851, height: 393 },
      { width: 1440, height: 900 }
    ];
    const failures: string[] = [];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const ingredientRow = row(page);
      await ingredientRow.scrollIntoViewIfNeeded();
      await expect(ingredientRow).toBeVisible();

      const rowDisplay = await ingredientRow.evaluate(
        (element) => getComputedStyle(element).display
      );
      if (viewport.width <= 719) {
        expect(rowDisplay, `reflujo en tarjeta a ${viewport.width}px`).toBe('block');
      } else if (viewport.width <= 900) {
        expect(rowDisplay, `vuelve a la tabla desde 720px (${viewport.width}px)`).toBe('table-row');
        const scrollCanvas = page.locator('[data-test="pantry-tabla-inventario"] .tabla__lienzo');
        await scrollCanvas.evaluate((element) => {
          element.scrollLeft = 0;
        });
        await expect(
          scrollCanvas.locator('[data-test^="pantry-stock-menos-"]').first()
        ).toBeInViewport();
        await scrollCanvas.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
        });
        await expect(row(page).locator('[data-test^="pantry-editar-"]')).toBeInViewport();
        await expect(row(page).locator('[data-test^="pantry-eliminar-"]')).toBeInViewport();
      }

      const geometry = await page.evaluate((selectors) => {
        const buttons = selectors.map((selector) => {
          const button = document.querySelector<HTMLElement>(
            `[data-test="pantry-tabla-inventario"] tr.ingredient-item ${selector}`
          );
          if (!button) return null;
          const rect = button.getBoundingClientRect();
          return {
            selector,
            width: rect.width,
            height: rect.height,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            label: button.getAttribute('aria-label'),
            focusable: button.tabIndex >= 0
          };
        });
        return {
          viewportWidth: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
          pointerCoarse: matchMedia('(pointer: coarse)').matches,
          buttons
        };
      }, actionSelectors);

      expect(
        geometry.buttons.every((button) => button !== null),
        JSON.stringify(viewport)
      ).toBe(true);
      expect(
        geometry.documentWidth,
        `documento con overflow horizontal a ${viewport.width}×${viewport.height}`
      ).toBeLessThanOrEqual(geometry.viewportWidth + 1);

      console.info(
        `[pantry-touch] ${viewport.width}×${viewport.height}: ${geometry.buttons
          .map((button) => (button ? `${button.width}×${button.height}` : 'missing'))
          .join(', ')}`
      );

      const expectedNames = [
        'Quitar una unidad',
        'Añadir una unidad',
        'Editar Ingrediente',
        'Eliminar ingrediente'
      ];
      for (const [index, button] of geometry.buttons.entries()) {
        if (!button) continue;
        expect(button.label, `${button.selector}: nombre accesible`).toBe(expectedNames[index]);
        expect(button.focusable, `${button.selector}: debe aceptar foco`).toBe(true);
        if (viewport.width > 900) {
          expect(button.left, `${button.selector}: borde izquierdo`).toBeGreaterThanOrEqual(0);
          expect(
            button.right,
            `${button.selector}: borde derecho a ${viewport.width}×${viewport.height}`
          ).toBeLessThanOrEqual(viewport.width + 1);
        }
        if (viewport.width <= 719 || geometry.pointerCoarse) {
          if (button.width < 44 || button.height < 44) {
            failures.push(
              `${viewport.width}×${viewport.height} ${button.selector}: ${button.width}×${button.height}px`
            );
          }
        }
      }

      if (screenshotRoot) {
        const directory = join(screenshotRoot, testInfo.project.name);
        mkdirSync(directory, { recursive: true });
        await page.screenshot({
          path: join(directory, `pantry-row-actions-${viewport.width}x${viewport.height}.png`)
        });
      }
    }

    expect(failures, 'acciones móviles menores de 44×44 px').toEqual([]);
  });

  test('teclado activa los controles y mantiene o reubica el foco del stepper', async ({
    page
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const ingredientRow = row(page);
    const minus = ingredientRow.locator(actionSelectors[0]);
    const plus = ingredientRow.locator(actionSelectors[1]);
    const edit = ingredientRow.getByRole('button', { name: 'Editar Ingrediente', exact: true });
    const remove = ingredientRow.getByRole('button', { name: 'Eliminar ingrediente', exact: true });
    const addButton = page.locator('app-button[data-test="pantry-agregar"] button');

    const inventoryAfterIncrement = waitForInventoryRefresh(page);
    await minus.focus();
    await page.keyboard.press('Tab');
    await expect(plus).toBeFocused();
    expect(await plus.evaluate((button) => button.matches(':focus-visible'))).toBe(true);
    await page.keyboard.press('Enter');
    const incrementRefresh = await inventoryAfterIncrement;
    expect(incrementRefresh.ok(), 'la recarga tras incrementar debe completar').toBe(true);
    await expect(ingredientRow).toContainText('3 g');
    await waitForFocusRender(page);
    await expect(plus).toBeFocused();

    const inventoryAfterDecrement = waitForInventoryRefresh(page);
    await minus.focus();
    await page.keyboard.press('Enter');
    const decrementRefresh = await inventoryAfterDecrement;
    expect(decrementRefresh.ok(), 'la recarga tras reducir debe completar').toBe(true);
    await expect(ingredientRow).toContainText('2 g');
    await waitForFocusRender(page);
    await expect(minus).toBeFocused();

    await edit.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.modal-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay')).toHaveCount(0);

    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.modal-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(ingredientRow).toContainText('Ingrediente tactil QA');

    await minus.focus();
    await page.keyboard.press('Enter');
    await expect(ingredientRow).toContainText('1 g');
    await expect(minus).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(ingredientRow).toHaveCount(0);
    await expect(addButton).toBeFocused();
    await expect(addButton).toBeInViewport();
  });

  test('no secuestra el foco si la persona lo mueve mientras el servidor responde', async ({
    page
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const ingredientRow = row(page);
    const plus = ingredientRow.locator(actionSelectors[1]);
    const edit = ingredientRow.getByRole('button', { name: 'Editar Ingrediente', exact: true });
    let patchResponseReady!: () => void;
    const patchIsReady = new Promise<void>((resolve) => {
      patchResponseReady = resolve;
    });

    await page.route('**/api/pantry/ingredients/*', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }

      const response = await route.fetch();
      patchResponseReady();
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ response });
    });

    const inventoryRefresh = waitForInventoryRefresh(page);
    await plus.focus();
    await page.keyboard.press('Enter');
    await patchIsReady;
    await page.keyboard.press('Tab');
    await expect(edit).toBeFocused();
    const refreshResponse = await inventoryRefresh;
    expect(refreshResponse.ok(), 'la recarga de inventario debe completar').toBe(true);
    await expect(ingredientRow).toContainText('3 g');
    await waitForFocusRender(page);
    await expect(edit).toBeFocused();
  });
});

test.describe('Pantry — activación táctil de acciones por ingrediente', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'requiere emulación táctil Pixel 5');
    await preparePantryPage(page);
  });

  test('los cuatro objetivos se pueden activar mediante toque en Pixel 5', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const ingredientRow = row(page);
    const plus = ingredientRow.locator(actionSelectors[1]);
    const minus = ingredientRow.locator(actionSelectors[0]);

    await plus.tap();
    await expect(ingredientRow).toContainText('3 g');
    await minus.tap();
    await expect(ingredientRow).toContainText('2 g');
    await ingredientRow.locator(actionSelectors[2]).tap();
    await expect(page.locator('.modal-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await ingredientRow.locator(actionSelectors[3]).tap();
    await expect(page.locator('.modal-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(ingredientRow).toContainText(ITEM_NAME);
  });
});
