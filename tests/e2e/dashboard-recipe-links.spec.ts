import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { isRecipeGenerationRequest } from './helpers/ai-requests';
import { registerAndGoto } from './helpers/auth';
import {
  createSyntheticRecipe,
  deleteSyntheticRecipe,
  waitForStableView
} from './helpers/recipe-fixtures';

test('la tarjeta sugerida abre la página de detalle y conserva el deep link', async ({ page }) => {
  await registerAndGoto(page, '/dashboard', 'dashboard-recipes');
  const recipe = await createSyntheticRecipe(page);
  try {
    await page.goto('/dashboard');
    const card = page.locator('.recipes-grid .recipe-card').filter({ hasText: recipe.name });
    await expect(card).toBeVisible();
    await card.click();

    await expect(page).toHaveURL(new RegExp(`/recipes\\?recipe=${recipe.id}$`));
    await expect(page.locator('.recipe-detail')).toBeVisible();
    await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-test="recipe-detail-title"]')).toHaveText(recipe.name);
    await expect(page.locator('.recipe-detail__description')).toContainText('Fixture sintético');
    await expect(page.locator('.recipe-detail')).toContainText('Tomate QA');
    await expect(page.locator('.recipe-detail')).toContainText('Cortar el tomate.');

    await waitForStableView(page);
    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      mkdirSync(screenshotDirectory, { recursive: true });
      const width = page.viewportSize()?.width ?? 'desktop';
      await page.screenshot({
        path: join(screenshotDirectory, `dashboard-recipe-detail-${width}.png`)
      });
    }

    await page.reload();
    await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();
    await expect(page.locator('[data-test="recipe-detail-title"]')).toHaveText(recipe.name);
    await expect(page.locator('.recipe-detail')).toBeVisible();
    await page.getByRole('button', { name: 'Volver a recetas' }).click();
    await expect(page).toHaveURL(/\/recipes$/);
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});

test('los enlaces Dashboard y el fragmento directo abren el modal IA sin invocarla', async ({
  page
}) => {
  // The catalog is seeded for every isolated app run, so return an empty library here to
  // exercise the dashboard's empty-state route deterministically.
  await page.route('**/api/recipes*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (route.request().method() === 'GET' && requestUrl.pathname.endsWith('/api/recipes')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { recipes: [], total: 0, page: 1, pageSize: 24 }
        })
      });
      return;
    }
    await route.continue();
  });
  await registerAndGoto(page, '/dashboard', 'dashboard-recipes-ai');
  const generationRequests: string[] = [];
  page.on('request', (request) => {
    if (isRecipeGenerationRequest(request.url(), request.method())) {
      generationRequests.push(request.url());
    }
  });

  await page.locator('a.action-card--primary').click();
  await expect(page).toHaveURL(/\/recipes#ai$/);
  await expect(page.locator('.ai-form')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Generar Receta con IA' })).toBeVisible();
  await expect(page.locator('.modal__title')).toContainText('Generar Receta con IA');
  await waitForStableView(page);
  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    const width = page.viewportSize()?.width ?? 'desktop';
    await page.screenshot({ path: join(screenshotDirectory, `dashboard-recipe-ai-${width}.png`) });
  }
  await page.locator('.modal__close').click();
  await expect(page).toHaveURL(/\/recipes$/);

  await page.goto('/recipes#ai');
  await expect(page.locator('.ai-form')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Generar Receta con IA' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/recipes$/);
  await expect(page.locator('.ai-form')).toHaveCount(0);

  await page.goto('/dashboard');
  const suggestedRecipes = page.locator('.dashboard__section').filter({
    has: page.getByRole('heading', { name: /Recetas sugeridas|Suggested recipes/i })
  });
  const emptyStateLink = suggestedRecipes.locator('.empty-state__link');
  await expect(emptyStateLink).toBeVisible();
  await emptyStateLink.click();
  await expect(page).toHaveURL(/\/recipes#ai$/);
  await expect(page.locator('.ai-form')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Generar Receta con IA' })).toBeVisible();
  expect(generationRequests, 'abrir el formulario no debe generar recetas').toEqual([]);
});

test('un id de receta inexistente deja la lista en una URL recuperable', async ({ page }) => {
  await registerAndGoto(page, '/recipes?recipe=missing', 'dashboard-recipe-missing');

  await expect(page.locator('h1.recipes__title')).toBeVisible();
  await expect(page).toHaveURL(/\/recipes$/);
  await expect(page.locator('.recipe-detail')).toHaveCount(0);
});
