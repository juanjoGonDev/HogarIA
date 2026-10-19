import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import {
  createSyntheticRecipe,
  deleteSyntheticRecipe,
  type SyntheticRecipe,
  waitForStableView
} from './helpers/recipe-fixtures';

const LANGUAGE_KEY = 'hogar:v1:language';

async function captureState(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) return;

  const directory = join(process.cwd(), '.e2e-screenshots', 'qa-rec-fav-1', testInfo.project.name);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, `${label}-${viewport.width}x${viewport.height}.png`)
  });
}

async function expectViewFits(
  page: Page,
  viewport: { width: number; height: number }
): Promise<void> {
  await page.setViewportSize(viewport);
  await waitForStableView(page);
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    cards: Array.from(document.querySelectorAll('.recipe-card'))
      .filter((card) => card.getClientRects().length > 0)
      .map((card) => {
        const button = card.querySelector('.recipe-card__favorite') as HTMLElement | null;
        const rect = button?.getBoundingClientRect();
        return {
          left: rect?.left ?? -1,
          right: rect?.right ?? Number.POSITIVE_INFINITY,
          width: rect?.width ?? 0,
          height: rect?.height ?? 0
        };
      })
  }));

  expect(layout.document).toBeLessThanOrEqual(layout.viewport);
  for (const button of layout.cards) {
    expect(button.left).toBeGreaterThanOrEqual(0);
    expect(button.right).toBeLessThanOrEqual(layout.viewport);
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
  }
}

test.describe('pestaña Favoritas de Recetas', () => {
  test('retira solo la receta desfavoritada tras éxito y conserva la persistencia', async ({
    page
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await registerAndGoto(page, '/recipes', 'qa-rec-fav-1');

    const recipes: SyntheticRecipe[] = [];
    const searchTerm = `QA favoritas ${Date.now()}`;
    try {
      recipes.push(await createSyntheticRecipe(page, { name: `${searchTerm} principal` }));
      recipes.push(await createSyntheticRecipe(page, { name: `${searchTerm} secundaria` }));
      await page.goto(`/recipes?search=${encodeURIComponent(searchTerm)}`);

      const firstCard = page.locator('.recipe-card').filter({ hasText: recipes[0].name });
      const secondCard = page.locator('.recipe-card').filter({ hasText: recipes[1].name });
      await expect(firstCard).toBeVisible();
      await expect(secondCard).toBeVisible();

      for (const card of [firstCard, secondCard]) {
        const favorite = card.locator('.recipe-card__favorite');
        await favorite.focus();
        await page.keyboard.press('Enter');
        await expect(favorite).toHaveAttribute('aria-pressed', 'true');
      }

      await page.getByRole('button', { name: 'Favoritas', exact: true }).click();
      await expect(firstCard).toBeVisible();
      await expect(secondCard).toBeVisible();

      const route = `**/api/recipes/${recipes[0].id}/favorite`;
      await page.route(route, (request) =>
        request.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'TEMPORARY_FAILURE' })
        })
      );

      const firstFavorite = firstCard.locator('.recipe-card__favorite');
      const failedToggle = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/api/recipes/${recipes[0].id}/favorite`) &&
          response.status() === 500
      );
      await firstFavorite.focus();
      await page.keyboard.press('Enter');
      await failedToggle;
      await expect(firstFavorite).toHaveAttribute('aria-pressed', 'true');
      await expect(firstCard).toBeVisible();
      await page.unroute(route);

      const successfulToggle = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/api/recipes/${recipes[0].id}/favorite`) &&
          response.status() === 200
      );
      await firstFavorite.focus();
      await page.keyboard.press('Enter');
      await successfulToggle;
      await expect(firstCard).toHaveCount(0);
      await expect(secondCard).toBeVisible();
      await expect(page.locator('.recipes__count')).toHaveText('1 receta');

      await page.reload();
      await page.getByRole('button', { name: 'Favoritas', exact: true }).click();
      await expect(firstCard).toHaveCount(0);
      await expect(secondCard).toBeVisible();

      await page.getByRole('button', { name: 'Todas', exact: true }).click();
      await expect(firstCard).toBeVisible();
      await expect(secondCard).toBeVisible();
      await expect(firstCard.locator('.recipe-card__favorite')).toHaveAttribute(
        'aria-pressed',
        'false'
      );
      await expect(secondCard.locator('.recipe-card__favorite')).toHaveAttribute(
        'aria-pressed',
        'true'
      );

      const unfilteredRecipesResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === 'GET' &&
          url.pathname === '/api/recipes' &&
          !url.searchParams.has('search') &&
          !url.searchParams.has('isFavorite')
        );
      });
      await page.goto('/recipes');
      const unfilteredRecipes = (await (await unfilteredRecipesResponse).json()) as {
        data: { total: number; pageSize: number };
      };
      await expect(page.locator('.recipes__count')).toHaveText(
        unfilteredRecipes.data.total === 1 ? '1 receta' : `${unfilteredRecipes.data.total} recetas`
      );
      expect(unfilteredRecipes.data.total).toBeGreaterThan(unfilteredRecipes.data.pageSize);
      await expect(page.locator('.recipe-card')).toHaveCount(unfilteredRecipes.data.pageSize);

      const viewports =
        testInfo.project.name === 'mobile-chrome'
          ? [
              { width: 393, height: 851 },
              { width: 320, height: 568 }
            ]
          : [{ width: 1440, height: 900 }];
      if (testInfo.project.name === 'mobile-chrome') {
        const showAll = page.locator('[data-test="recipe-mobile-show-all"]');
        await showAll.click();
        await expect(showAll).toHaveAttribute('aria-expanded', 'true');
      }
      for (const viewport of viewports) {
        await expectViewFits(page, viewport);
        await captureState(page, testInfo, 'all-recipes-after-unfavorite');
      }

      await page.evaluate((key) => localStorage.setItem(key, 'en'), LANGUAGE_KEY);
      await page.reload();
      await page.getByRole('button', { name: 'Favorites', exact: true }).click();
      await expect(firstCard).toHaveCount(0);
      await expect(secondCard.locator('.recipe-card__favorite')).toHaveAttribute(
        'aria-label',
        'Favourite'
      );
      await page.getByRole('button', { name: 'All', exact: true }).click();
      await expect(firstCard.locator('.recipe-card__favorite')).toHaveAttribute(
        'aria-label',
        'Add to favourites'
      );
    } finally {
      for (const recipe of recipes) await deleteSyntheticRecipe(page, recipe);
    }

    expect(pageErrors, 'la interacción no debe provocar excepciones JavaScript').toEqual([]);
  });
});
