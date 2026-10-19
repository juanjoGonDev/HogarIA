import { test, expect } from './fixtures';
import { registerAndGoto } from './helpers/auth';

test.describe('Recipes', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGoto(page, '/recipes');
    await expect(page.locator('h1.recipes__title')).toBeVisible();
  });

  test('should display recipes page', async ({ page }) => {
    await expect(page.locator('h1.recipes__title')).toContainText('Recetas');
  });

  test('should show filter options', async ({ page }) => {
    const filters = page.locator('app-filter-tag .tag');
    await expect(filters.nth(0)).toContainText('Todas');
    await expect(filters.nth(1)).toContainText('Favoritas');
    await expect(filters.nth(2)).toContainText('Rápidas');
    await expect(filters.nth(3)).toContainText('IA');
    await expect(filters.nth(0)).toHaveAttribute('aria-pressed', 'true');
  });

  test('should filter by favorites', async ({ page }) => {
    const favorites = page.getByRole('button', { name: 'Favoritas', exact: true });
    await favorites.click();
    await expect(favorites).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('app-filter-tag .tag--selected')).toContainText('Favoritas');
  });

  test('should show empty state when no recipes', async ({ page }) => {
    await page.goto('/recipes?search=__qa_no_matching_recipe__');
    await expect(page.locator('.empty-state__title')).toContainText('No hay recetas');
    const clearFilters = page.getByRole('button', { name: 'Limpiar filtros' });
    await expect(clearFilters).toBeVisible();
    await clearFilters.click();
    await expect(page).toHaveURL((url) => url.searchParams.get('search') === null);
  });

  test('should open AI generation modal', async ({ page }) => {
    await page.getByRole('button', { name: /Generar IA/ }).click();
    await expect(page.locator('.modal__title')).toContainText('Generar Receta con IA');
  });

  test('should show AI generation form', async ({ page }) => {
    await page.getByRole('button', { name: /Generar IA/ }).click();
    const stepOne = page.locator('[data-test="recipe-ai-step-1"]');
    await expect(stepOne).toBeVisible();
    await expect(stepOne.locator('.ai-form__label')).toContainText([
      'Ingredientes seleccionados',
      'Tu despensa'
    ]);

    await page.locator('[data-test="recipe-ai-next"]').click();
    await expect(page.locator('[data-test="recipe-ai-step-2"]')).toBeVisible();
    await page.locator('[data-test="recipe-ai-next"]').click();
    const stepThree = page.locator('[data-test="recipe-ai-step-3"]');
    await expect(stepThree).toBeVisible();

    await expect(stepThree.locator('.ai-form__label')).toContainText([
      'Ingredientes seleccionados',
      'Dificultad',
      'Porciones',
      'Nivel de detalle'
    ]);
  });

  test('should show generate buttons', async ({ page }) => {
    await page.getByRole('button', { name: /Generar IA/ }).click();
    await page.locator('[data-test="recipe-ai-next"]').click();
    await page.locator('[data-test="recipe-ai-next"]').click();
    await expect(page.locator('[data-test="recipe-ai-step-3"]')).toBeVisible();

    await expect(page.getByRole('button', { name: /Generar 1 receta/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Generar 3 opciones/ })).toBeVisible();
  });

  test('should close AI modal', async ({ page }) => {
    await page.getByRole('button', { name: /Generar IA/ }).click();
    await expect(page.locator('.modal__title')).toContainText('Generar Receta con IA');

    await page.locator('.modal__close').click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  });
});
