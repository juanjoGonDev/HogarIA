import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import {
  createSyntheticRecipe,
  deleteSyntheticRecipe,
  type SyntheticRecipe
} from './helpers/recipe-fixtures';
import { mockRecipeStepPhotos } from './helpers/recipe-step-photos';

async function readTimesCooked(
  page: import('@playwright/test').Page,
  recipe: SyntheticRecipe
): Promise<number> {
  const response = await page.request.get(`/api/recipes/${recipe.id}`, {
    headers: { authorization: `Bearer ${recipe.token}` }
  });
  expect(response.ok(), 'la receta propia debe seguir accesible en el API aislado').toBeTruthy();
  const payload = (await response.json()) as { data: { timesCooked: number } };
  return payload.data.timesCooked;
}

test('Cocinar ahora espera confirmación, evita duplicados y permite reintentar', async ({
  page
}, testInfo) => {
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await registerAndGoto(page, '/recipes', 'qa-recipe-cook-action');

  const recipe = await createSyntheticRecipe(page, {
    name: `Receta QA cocinar ${Date.now()}`
  });
  await mockRecipeStepPhotos(page);
  const endpoint = `**/api/recipes/${recipe.id}/cook`;
  const viewport =
    testInfo.project.name === 'mobile-chrome'
      ? { width: 320, height: 740 }
      : { width: 1440, height: 900 };
  await page.setViewportSize(viewport);

  let attempts = 0;
  let releaseFirstFailure!: () => void;
  const firstFailureReleased = new Promise<void>((resolve) => {
    releaseFirstFailure = resolve;
  });
  let notifyFirstRequest!: () => void;
  const firstRequestStarted = new Promise<void>((resolve) => {
    notifyFirstRequest = resolve;
  });
  let failedCooking: Promise<import('@playwright/test').Response> | undefined;

  try {
    const countBefore = await readTimesCooked(page, recipe);
    await page.route(endpoint, async (route) => {
      attempts += 1;
      if (attempts === 1) {
        notifyFirstRequest();
        await firstFailureReleased;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'SYNTHETIC_TEMPORARY_FAILURE' })
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`/recipes?recipe=${recipe.id}`);
    const detail = page.locator('[data-test="recipe-detail-page"]');
    await expect(detail).toBeVisible();
    await page.locator('[data-test="recipe-detail-tab-ingredients"]').click();
    const cookButton = page.locator('[data-test="recipe-cooking-mark-done"] button');
    const initialBounds = await cookButton.boundingBox();
    expect(initialBounds).not.toBeNull();
    expect(initialBounds!.width).toBeGreaterThanOrEqual(44);
    expect(initialBounds!.height).toBeGreaterThanOrEqual(44);

    failedCooking = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/recipes/${recipe.id}/cook`) &&
        response.status() === 503
    );
    await cookButton.focus();
    await page.keyboard.press('Enter');
    await firstRequestStarted;

    await expect(detail).toBeVisible();
    await expect(cookButton).toBeDisabled();
    await expect.poll(() => attempts).toBe(1);
    const pendingBounds = await cookButton.boundingBox();
    expect(pendingBounds).not.toBeNull();
    expect(Math.abs(pendingBounds!.width - initialBounds!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(pendingBounds!.height - initialBounds!.height)).toBeLessThanOrEqual(1);
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth, 'la ficha de receta no debe desbordar el viewport').toBeLessThanOrEqual(
      viewport.width
    );
    expect(await readTimesCooked(page, recipe)).toBe(countBefore);

    releaseFirstFailure();
    expect((await failedCooking).status()).toBe(503);
    await expect(cookButton).toBeEnabled();
    await cookButton.focus();
    await expect(cookButton).toBeFocused();
    await expect(detail).toBeVisible();
    await expect(page.locator('.toast--error')).toHaveCount(1);
    await expect(page.locator('.toast--error')).toContainText(
      'No se pudo registrar que has cocinado esta receta'
    );
    await expect(page.locator('.toast--success')).toHaveCount(0);
    expect(await readTimesCooked(page, recipe)).toBe(countBefore);

    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.screenshot({
        path: join(screenshotDirectory, `${testInfo.project.name}-recipe-cook-error.png`),
        animations: 'disabled'
      });
    }

    const successfulCooking = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/recipes/${recipe.id}/cook`) &&
        response.status() === 200
    );
    await page.keyboard.press('Enter');
    expect((await successfulCooking).status()).toBe(200);
    await expect(detail).toBeHidden();
    await expect(page).toHaveURL(/\/recipes$/);
    await expect(page.locator('.toast--success')).toContainText('¡A cocinar!');
    expect(attempts).toBe(2);

    await page.reload();
    expect(await readTimesCooked(page, recipe)).toBe(countBefore + 1);
    expect(pageErrors, 'el registro/reintento no debe provocar errores JavaScript').toEqual([]);
  } finally {
    releaseFirstFailure();
    if (attempts > 0 && failedCooking) await failedCooking.catch(() => undefined);
    await page.unroute(endpoint);
    await deleteSyntheticRecipe(page, recipe);
  }
});
