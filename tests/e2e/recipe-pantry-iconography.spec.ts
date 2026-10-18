import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { registerWithHousehold } from './helpers/auth';
import {
  createSyntheticRecipe,
  deleteSyntheticRecipe,
  waitForStableView
} from './helpers/recipe-fixtures';

const TOKEN_KEY = 'hogar:v1:auth_token';
const DECORATIVE_EMOJI = /\p{Extended_Pictographic}/u;

async function tokenOf(page: import('@playwright/test').Page): Promise<string> {
  const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'la sesión sintética debe estar autenticada').toBeTruthy();
  return token as string;
}

test('Recipe and Pantry decorative icons are SVG while food and recipe content stays intact', async ({
  page
}) => {
  const pageErrors: string[] = [];
  const screenshotDirectory = join(
    process.cwd(),
    '.e2e-screenshots',
    'qa-ui-3d',
    test.info().project.name
  );
  mkdirSync(screenshotDirectory, { recursive: true });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await registerWithHousehold(page, '/pantry?buscar=__qa_without_matches__', 'qa-ui-3d');
  const token = await tokenOf(page);
  let ingredientId: string | undefined;
  let recipe: Awaited<ReturnType<typeof createSyntheticRecipe>> | undefined;

  try {
    await expect(page.locator('.empty-state__title')).toHaveText('Tu inventario está vacío');
    await expect(page.locator('.empty-state__icon app-icon')).toHaveCount(1);

    await page.getByRole('button', { name: /Utensilios/ }).click();
    await expect(page.locator('[data-test="utensilios-tabla"]')).toBeVisible();
    const customUtensilTitle = page.locator('.utensils-add__title');
    await expect(customUtensilTitle.locator('app-icon')).toBeVisible();
    expect(DECORATIVE_EMOJI.test(await customUtensilTitle.innerText())).toBe(false);
    await page.locator('.pantry__header-acciones app-button').last().locator('button').click();
    const utensilCategory = page.locator('#utensilCategory');
    await expect(utensilCategory).toBeVisible();
    await expect(page.locator('.modal__close app-icon svg')).toBeVisible();
    await waitForStableView(page);
    const utensilOptions = await utensilCategory.locator('option').allTextContents();
    expect(utensilOptions.every((label) => !DECORATIVE_EMOJI.test(label))).toBe(true);
    await page.screenshot({
      path: join(screenshotDirectory, 'pantry-utensil-category-desktop.png')
    });
    await page.setViewportSize({ width: 393, height: 851 });
    await waitForStableView(page);
    await page.screenshot({
      path: join(screenshotDirectory, 'pantry-utensil-category-mobile.png')
    });
    await page.locator('.modal__close').click();

    await page.getByRole('button', { name: /Ingredientes/ }).click();
    await page.locator('.pantry__header-acciones app-button').last().locator('button').click();
    await expect(page.locator('[data-test="pantry-picker-ubicacion"]')).toBeVisible();
    await page.locator('[data-test="pantry-picker-ubicacion"] .picker__trigger').click();
    const locationOptions = await page.locator('[role="option"]').allTextContents();
    expect(locationOptions).toContain('Nevera');
    expect(locationOptions).toContain('Congelador');
    expect(locationOptions.every((label) => !DECORATIVE_EMOJI.test(label))).toBe(true);
    await page.locator('.modal__close').click();

    await page.goto('/recipes');
    await expect(page.locator('h1.recipes__title')).toHaveText('Recetas');
    await expect(page.locator('.recipes__quick-filters app-icon')).toHaveCount(4);
    expect(DECORATIVE_EMOJI.test(await page.locator('.recipes__quick-filters').innerText())).toBe(
      false
    );
    await expect(page.locator('.recipes__grid .recipe-card:visible').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generar IA' })).toBeVisible();

    const ingredientResponse = await page.request.post('/api/pantry/ingredients', {
      headers: { authorization: `Bearer ${token}` },
      data: {
        name: `Zanahoria QA ${Date.now()}`,
        category: 'vegetables',
        quantity: 2,
        unit: 'unit',
        location: 'pantry'
      }
    });
    expect(ingredientResponse.ok(), 'el ingrediente sintético debe poder crearse').toBeTruthy();
    ingredientId = (await ingredientResponse.json()).data.id as string;
    recipe = await createSyntheticRecipe(page, {
      tips: 'Consejo QA: remueve suavemente.',
      warning: 'Advertencia QA: vigila el aceite caliente.'
    });
    await page.goto(`/recipes?search=${encodeURIComponent(recipe.name)}`);
    const card = page.locator('.recipe-card').filter({ hasText: recipe.name });
    await expect(card).toBeVisible();
    await expect(card.locator('.recipe-card__placeholder app-icon')).toHaveCount(1);
    const favorite = card.locator('.recipe-card__favorite');
    await expect(favorite).toHaveAttribute('aria-label', 'Añadir a favoritos');
    await expect(favorite).toHaveAttribute('aria-pressed', 'false');
    await expect(favorite.locator('app-icon')).toHaveCount(1);
    await expect(card.locator('.recipe-card__servings')).toHaveAttribute(
      'aria-label',
      '2 porciones'
    );

    const favoriteBounds = await favorite.boundingBox();
    expect(favoriteBounds?.width).toBeGreaterThanOrEqual(44);
    expect(favoriteBounds?.height).toBeGreaterThanOrEqual(44);
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await expect(favorite).toHaveAttribute('aria-label', 'Favorito');

    await card.locator('.recipe-card__name').click();
    await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const tip = page.locator('.step-card__tip');
    const warning = page.locator('.step-card__warning');
    await expect(tip).toContainText('Consejo QA: remueve suavemente.');
    await expect(warning).toContainText('Advertencia QA: vigila el aceite caliente.');
    await expect(tip.locator('app-icon[name="help_outline"]')).toHaveCount(1);
    await expect(warning.locator('app-icon[name="error_outline"]')).toHaveCount(1);
    expect(DECORATIVE_EMOJI.test(await tip.innerText())).toBe(false);
    expect(DECORATIVE_EMOJI.test(await warning.innerText())).toBe(false);
    await page.getByRole('button', { name: 'Volver a recetas' }).click();

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 393, height: 851 },
      { width: 479, height: 700 },
      { width: 480, height: 700 },
      { width: 481, height: 700 },
      { width: 600, height: 700 },
      { width: 601, height: 700 },
      { width: 767, height: 700 },
      { width: 768, height: 700 },
      { width: 769, height: 700 },
      { width: 568, height: 320 },
      { width: 844, height: 390 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      const button = await card.locator('.recipe-card__favorite').boundingBox();
      expect(button?.x).toBeGreaterThanOrEqual(0);
      expect((button?.x ?? 0) + (button?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
    }

    await page.getByRole('button', { name: 'Generar IA' }).click();
    const generatedIngredient = page.locator(
      `[data-test="recipe-ai-pantry-options"] [data-ingredient-id="${ingredientId}"]`
    );
    await expect(generatedIngredient).toContainText(/Zanahoria QA/);
    await expect(page.locator('.modal__title')).toHaveText('Generar Receta con IA');
    await waitForStableView(page);

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 393, height: 851 },
      { width: 568, height: 320 },
      { width: 844, height: 390 }
    ]) {
      await page.setViewportSize(viewport);
      const modal = await page.locator('.modal').boundingBox();
      expect(modal?.x).toBeGreaterThanOrEqual(0);
      expect(modal?.y).toBeGreaterThanOrEqual(0);
      expect((modal?.x ?? 0) + (modal?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      expect((modal?.y ?? 0) + (modal?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await waitForStableView(page);
    await page.screenshot({ path: join(screenshotDirectory, 'recipes-modal-desktop.png') });
    await page.setViewportSize({ width: 393, height: 851 });
    await waitForStableView(page);
    await page.screenshot({ path: join(screenshotDirectory, 'recipes-modal-mobile.png') });
    await page.locator('[data-test="recipe-ai-next"]').click();
    await page.locator('[data-test="recipe-ai-next"]').click();
    await expect(page.locator('[data-test="recipe-ai-step-3"]')).toBeVisible();
    await page.locator('.modal__body').evaluate((body: HTMLElement) => {
      body.scrollTop = body.scrollHeight;
    });
    await waitForStableView(page);
    await expect(page.getByRole('button', { name: 'Generar 1 receta' })).toBeInViewport();
    await page.screenshot({ path: join(screenshotDirectory, 'recipes-modal-mobile-actions.png') });

    await page.goto('/settings');
    await page.locator('[data-test="settings-lang-en"]').click();
    await page.goto('/recipes');
    await expect(page.locator('h1.recipes__title')).toHaveText('Recipes');
    await expect(page.locator('.recipes__quick-filters app-filter-tag')).toContainText([
      'All',
      'Favorites',
      'Quick',
      'AI'
    ]);
    expect(DECORATIVE_EMOJI.test(await page.locator('.recipes__quick-filters').innerText())).toBe(
      false
    );
    await expect(
      page
        .locator('.recipe-card')
        .filter({ hasText: recipe.name })
        .locator('.recipe-card__favorite')
    ).toHaveAttribute('aria-label', 'Favourite');

    await page.goto('/pantry');
    await expect(page.locator('.pantry__title')).toHaveText('Inventory');
    await page.getByRole('button', { name: /Utensils/ }).click();
    await page.locator('.pantry__header-acciones app-button').last().locator('button').click();
    await expect(page.locator('label[for="utensilCategory"]')).toHaveText('Category');
    expect(
      (await page.locator('#utensilCategory option').allTextContents()).every(
        (label) => !DECORATIVE_EMOJI.test(label)
      )
    ).toBe(true);
  } finally {
    if (recipe) await deleteSyntheticRecipe(page, recipe);
    if (ingredientId) {
      const response = await page.request.delete(`/api/pantry/ingredients/${ingredientId}`, {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(response.ok(), 'el ingrediente sintético debe limpiarse').toBeTruthy();
    }
  }

  expect(
    pageErrors,
    'no deben aparecer excepciones JavaScript en las superficies probadas'
  ).toEqual([]);
});
