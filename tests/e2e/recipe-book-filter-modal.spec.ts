import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

test.describe('Filtros avanzados del libro de recetas', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGoto(page, '/recipes', 'recipe-book-filter-modal');
    await expect(page.locator('h1.recipes__title')).toBeVisible();
    await page.getByRole('tab', { name: 'Libro de recetas' }).click();
  });

  test('combina los seis filtros y Cancelar/Escape descartan borradores', async ({
    page
  }, testInfo) => {
    const viewport =
      testInfo.project.name === 'chromium'
        ? { width: 1440, height: 900 }
        : { width: 393, height: 852 };
    await page.setViewportSize(viewport);

    const aiRequests: string[] = [];
    const pageErrors: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/ai/')) aiRequests.push(request.url());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const cards = page.locator('[data-test="recipe-card"]');
    const openFilters = page.getByRole('button', { name: 'Filtros', exact: true });
    await openFilters.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Filtrar recetas' });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);

    const selectPickerOption = async (field: string, option: string) => {
      await page.locator(field).locator('.picker__trigger').click();
      await page.getByRole('option', { name: option, exact: true }).click();
    };

    const countryPicker = page.locator('[data-test="recipe-book-country"] .picker__trigger');
    await countryPicker.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox', { name: 'País de origen' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(countryPicker).toHaveAttribute('aria-label', 'País de origen: España');
    await selectPickerOption('[data-test="recipe-book-meal"]', 'Almuerzo');
    await selectPickerOption(
      '.recipe-book-filter-form__field:has(#recipe-book-difficulty)',
      'Difícil'
    );
    await page.getByLabel('Cocina', { exact: true }).fill('valenciana');
    await page.getByLabel('Etiquetas', { exact: true }).fill('arroz');
    await page.getByLabel('Tiempo máximo (minutos)', { exact: true }).fill('80');

    const interactiveControls = [
      {
        label: 'País',
        locator: page.locator('[data-test="recipe-book-country"] .picker__trigger')
      },
      { label: 'Comida', locator: page.locator('[data-test="recipe-book-meal"] .picker__trigger') },
      {
        label: 'Dificultad',
        locator: page.locator(
          '.recipe-book-filter-form__field:has(#recipe-book-difficulty) .picker__trigger'
        )
      },
      { label: 'Cocina', locator: page.getByLabel('Cocina', { exact: true }) },
      { label: 'Etiquetas', locator: page.getByLabel('Etiquetas', { exact: true }) },
      {
        label: 'Tiempo máximo',
        locator: page.getByLabel('Tiempo máximo (minutos)', { exact: true })
      },
      { label: 'Cancelar', locator: page.getByRole('button', { name: 'Cancelar', exact: true }) },
      {
        label: 'Aplicar filtros',
        locator: page.getByRole('button', { name: 'Aplicar filtros', exact: true })
      }
    ];
    for (const { label, locator } of interactiveControls) {
      const box = await locator.boundingBox();
      expect(box, `${label} debe estar visible`).not.toBeNull();
      expect(box!.height, `${label} debe medir al menos 44 CSS px`).toBeGreaterThanOrEqual(44);
    }

    if (viewport.width === 393) {
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
    }

    await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/[?&]country=ES/);
    await expect(page).toHaveURL(/[?&]mealType=lunch/);
    await expect(page).toHaveURL(/[?&]difficulty=hard/);
    await expect(page).toHaveURL(/[?&]cuisine=valenciana/);
    await expect(page).toHaveURL(/[?&]tags=arroz/);
    await expect(page).toHaveURL(/[?&]maxTime=80/);
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Paella valenciana');

    await page.reload();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Paella valenciana');

    await openFilters.click();
    await page.getByLabel('Cocina', { exact: true }).fill('gallega');
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/[?&]cuisine=valenciana/);
    await expect(cards).toHaveCount(1);

    await openFilters.click();
    await expect(page.getByLabel('Cocina', { exact: true })).toHaveValue('valenciana');
    await page.getByLabel('Cocina', { exact: true }).fill('gallega');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(openFilters).toBeFocused();
    await expect(page).toHaveURL(/[?&]cuisine=valenciana/);
    await expect(cards).toHaveCount(1);

    await openFilters.click();
    await expect(page.getByLabel('Cocina', { exact: true })).toHaveValue('valenciana');
    await expect(page.getByLabel('Etiquetas', { exact: true })).toHaveValue('arroz');
    await expect(page.getByLabel('Tiempo máximo (minutos)', { exact: true })).toHaveValue('80');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.setViewportSize({ width: 320, height: 568 });
    await openFilters.click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
    await page.keyboard.press('Escape');

    const screenshotDirectory = resolve('.e2e-screenshots/qa-recipe-book-filter-modal-20261009');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-filtered-book.png`),
      fullPage: false,
      animations: 'disabled'
    });

    expect(aiRequests, 'los filtros del libro no deben invocar la IA').toEqual([]);
    expect(pageErrors, 'la aplicación no debe lanzar errores en el navegador').toEqual([]);
  });
});
