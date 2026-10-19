import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { registerWithHousehold } from './helpers/auth';

const BASELINE_GEOMETRY: Record<string, { width: number; height: number }> = {
  recipes: { width: 86, height: 31 },
  categories: { width: 66, height: 31 },
  products: { width: 86, height: 31 }
};
const RESPONSIVE_WIDTHS = [
  320, 399, 400, 401, 479, 480, 481, 719, 720, 721, 759, 760, 761, 767, 768, 769, 859, 860, 861,
  959, 960, 1023, 1024
];

function screenshotPath(projectName: string, route: string): string {
  const directory = process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-tag-accessibility';
  mkdirSync(directory, { recursive: true });
  return join(directory, `${projectName}-${route}.png`);
}

async function captureTag(page: import('@playwright/test').Page, route: string): Promise<void> {
  const tag = page.locator('app-filter-tag .tag').first();
  await expect(tag).toBeVisible();
  const metrics = await tag.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const action = element.querySelector('.tag__action');
    const actionStyle = action ? getComputedStyle(action) : null;
    return {
      tag: {
        width: Math.round(bounds.width * 100) / 100,
        height: Math.round(bounds.height * 100) / 100,
        padding: style.padding,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight
      },
      action: actionStyle
        ? {
            padding: actionStyle.padding,
            fontSize: actionStyle.fontSize,
            lineHeight: actionStyle.lineHeight
          }
        : null
    };
  });
  console.log(`TAG_GEOMETRY ${route} ${JSON.stringify(metrics)}`);
  const expected = BASELINE_GEOMETRY[route];
  expect(Math.abs(metrics.tag.width - expected.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.tag.height - expected.height)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: screenshotPath(test.info().project.name, route) });
}

test.describe('accesibilidad de los chips de filtro', () => {
  test('guarda geometría base de Recetas, categorías y productos', async ({ page }, testInfo) => {
    await page.setViewportSize(
      testInfo.project.name === 'mobile-chrome'
        ? { width: 393, height: 851 }
        : { width: 1440, height: 900 }
    );
    await registerWithHousehold(page, '/recipes', `QA tag baseline ${testInfo.project.name}`);
    await captureTag(page, 'recipes');

    await page.goto('/pantry/categories');
    await expect(page.locator('[data-test="gestor-categorias-lista"]')).toBeVisible();
    await captureTag(page, 'categories');

    await page.goto('/pantry/products');
    await expect(page.locator('[data-test="gestor-productos-lista"]')).toBeVisible();
    await captureTag(page, 'products');
  });

  test('mantiene las filas de filtros sin desbordamiento en los límites responsive', async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome');
    await page.setViewportSize({ width: 393, height: 851 });
    await registerWithHousehold(page, '/recipes', 'QA tag responsive');

    const routes = [
      { path: '/recipes', selector: '.recipes__quick-filters' },
      {
        path: '/pantry/categories',
        selector: '[data-test="gestor-categorias-lista"] .gestor__vistas'
      },
      {
        path: '/pantry/products',
        selector: '[data-test="gestor-productos-lista"] .gestor__vistas'
      }
    ];

    for (const route of routes) {
      await page.goto(route.path);
      const filters = page.locator(route.selector);
      await expect(filters).toBeVisible();

      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: 851 });
        const bounds = await filters.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            left: rect.left,
            right: rect.right,
            buttons: Array.from(element.querySelectorAll('button')).map((button) => {
              const buttonRect = button.getBoundingClientRect();
              return { left: buttonRect.left, right: buttonRect.right };
            })
          };
        });

        expect(bounds.scrollWidth, `${route.path} filter row at ${width}px`).toBeLessThanOrEqual(
          bounds.clientWidth + 1
        );
        for (const button of bounds.buttons) {
          expect(button.left, `${route.path} filter left at ${width}px`).toBeGreaterThanOrEqual(
            bounds.left - 1
          );
          expect(button.right, `${route.path} filter right at ${width}px`).toBeLessThanOrEqual(
            bounds.right + 1
          );
        }
      }
    }
  });

  test('activa por teclado/click/tap y anuncia el estado seleccionado en cada consumidor', async ({
    page
  }, testInfo) => {
    await registerWithHousehold(page, '/recipes', `QA tag keyboard ${testInfo.project.name}`);
    const favorita = page.getByRole('button', { name: 'Favoritas', exact: true });
    await expect(favorita).toHaveAttribute('aria-pressed', 'false');
    await favorita.focus();
    await page.keyboard.press('Space');
    await expect(favorita).toHaveAttribute('aria-pressed', 'true');
    const quick = page.getByRole('button', { name: 'Rápidas', exact: true });
    if (testInfo.project.name === 'mobile-chrome') await quick.tap();
    else await quick.click();
    await expect(quick).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/pantry/categories');
    const withoutProducts = page
      .locator('[data-test="gestor-categorias-vista-without-products"]')
      .getByRole('button');
    await expect(withoutProducts).toHaveAttribute('aria-pressed', 'false');
    await withoutProducts.focus();
    await page.keyboard.press('Enter');
    await expect(withoutProducts).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/pantry/products');
    const allProducts = page
      .locator('[data-test="gestor-productos-filtro-all"]')
      .getByRole('button');
    await expect(allProducts).toHaveAttribute('aria-pressed', 'false');
    await allProducts.focus();
    await page.keyboard.press('Space');
    await expect(allProducts).toHaveAttribute('aria-pressed', 'true');
  });

  test('mantiene el alias removible como texto y permite quitarlo con teclado o tap', async ({
    page
  }, testInfo) => {
    await registerWithHousehold(page, '/pantry/products', `QA tag alias ${testInfo.project.name}`);
    await page.locator('[data-test="gestor-productos-nueva"]').click();
    await expect(page.locator('[data-test="gestor-productos-ficha"]')).toBeVisible();
    await page
      .locator('[data-test="gestor-productos-campo-nombre"] input')
      .fill('QA tag removible');
    await page.locator('#gestor-producto-alias').fill('Alias de prueba');
    await page.locator('[data-test="gestor-productos-anadir-alias"]').click();

    const tag = page.locator('.alias app-tag .tag').filter({ hasText: 'Alias de prueba' });
    await expect(tag).toBeVisible();
    await expect(tag.locator('button')).toHaveCount(1);
    await expect(tag.locator('.tag__action')).toHaveCount(0);
    const remove = tag.getByRole('button', { name: 'Quitar etiqueta' });
    await expect(remove).toBeVisible();

    const bounds = await tag.boundingBox();
    expect(bounds).not.toBeNull();
    console.log(
      `TAG_GEOMETRY products-removable ${JSON.stringify({
        width: Math.round((bounds?.width ?? 0) * 100) / 100,
        height: Math.round((bounds?.height ?? 0) * 100) / 100
      })}`
    );
    await page.screenshot({
      path: screenshotPath(testInfo.project.name, 'products-removable')
    });

    if (testInfo.project.name === 'mobile-chrome') {
      await remove.tap();
    } else {
      await remove.focus();
      await page.keyboard.press('Enter');
    }
    await expect(tag).toHaveCount(0);
  });
});
