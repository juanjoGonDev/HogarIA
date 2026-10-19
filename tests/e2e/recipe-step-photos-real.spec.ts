import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { createSyntheticRecipe, deleteSyntheticRecipe } from './helpers/recipe-fixtures';

test('la foto real se sirve en receta sin enviarle datos del usuario a Wikimedia', async ({
  page
}, testInfo) => {
  test.skip(process.env.HOGARIA_REAL_PHOTO_SMOKE !== '1', 'Opt-in smoke contra Wikimedia Commons.');
  const externalBrowserRequests: string[] = [];
  const photoSearchRequests: URL[] = [];
  const coverSearchRequests: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname.endsWith('wikimedia.org')) externalBrowserRequests.push(url.hostname);
    if (url.pathname.endsWith('/api/recipes/step-photos')) photoSearchRequests.push(url);
    if (url.pathname.endsWith('/api/recipes/step-photos/search')) coverSearchRequests.push(url);
  });

  await registerAndGoto(page, '/recipes', 'real-recipe-photo-smoke');
  const recipe = await createSyntheticRecipe(page, {
    name: 'Receta sintética para probar fotos',
    servings: 2,
    ingredients: [{ name: 'Ingrediente de prueba', quantity: 1, unit: 'unit' }],
    instructionsByLevel: {
      basic: [{ stepNumber: 1, instruction: 'Pica el ingrediente de prueba.', illustration: null }],
      intermediate: [
        { stepNumber: 1, instruction: 'Pica el ingrediente de prueba.', illustration: null }
      ],
      expert: [{ stepNumber: 1, instruction: 'Pica el ingrediente de prueba.', illustration: null }]
    }
  });

  try {
    const card = page.locator('[data-test="recipe-card"]').filter({ hasText: recipe.name });
    await expect(card).toBeVisible();
    await card.locator('.recipe-card__open').click();
    const detail = page.locator('[data-test="recipe-full-detail"]');
    const photo = detail.locator('[data-test="recipe-step-photo"]');
    await expect(photo).toBeVisible({ timeout: 15_000 });
    const image = photo.locator('img');
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(200);
    await expect(photo.getByRole('link', { name: 'Wikimedia Commons' })).toHaveAttribute(
      'href',
      /^https:\/\/commons\.wikimedia\.org\//
    );
    await expect(photo.getByRole('link', { name: /CC/i })).toHaveAttribute(
      'href',
      /^https:\/\/(creativecommons\.org|www\.gnu\.org|gnu\.org|commons\.wikimedia\.org)/
    );

    expect(externalBrowserRequests).toEqual([]);
    expect(photoSearchRequests.length).toBeGreaterThan(0);
    expect(
      photoSearchRequests.every(
        (url) =>
          [...url.searchParams.keys()].join(',') === 'scene' &&
          url.searchParams.get('scene') === 'cut'
      )
    ).toBeTruthy();

    await image.scrollIntoViewIfNeeded();
    const screenshots = resolve('.e2e-screenshots/recipe-step-photos-real');
    mkdirSync(screenshots, { recursive: true });
    await page.screenshot({
      path: resolve(screenshots, `${testInfo.project.name}-real-commons-photo.png`),
      fullPage: false,
      animations: 'disabled'
    });

    await page.locator('[data-test="recipe-edit-action"]').click();
    await expect(page.locator('[data-test="recipe-editor-form"]')).toBeVisible();
    const coverQuery = page.locator('#editor-photo-search');
    await coverQuery.fill('tortilla');
    const searchResults = page.locator('[data-test="recipe-photo-results"]');
    await expect(searchResults).toBeVisible({ timeout: 20_000 });
    const resultCount = await searchResults.locator('button').count();
    expect(resultCount).toBeGreaterThan(0);
    expect(resultCount).toBeLessThanOrEqual(10);
    const candidate = searchResults.getByRole('button', { name: /Usar esta foto/ }).first();
    await expect(candidate).toBeVisible();
    const attribution = (await candidate.innerText()).trim();
    await candidate.click();
    await expect(page.locator('.editor-cover-preview')).toContainText(attribution.split('\n')[0]);
    await expect(page.locator('.editor-cover-preview a').first()).toHaveAttribute(
      'href',
      /^https:\/\/(creativecommons\.org|www\.gnu\.org|gnu\.org|commons\.wikimedia\.org)/
    );
    expect(coverSearchRequests).toHaveLength(1);
    expect(
      coverSearchRequests.every(
        (url) =>
          [...url.searchParams.keys()].join(',') === 'q' && url.searchParams.get('q') === 'tortilla'
      )
    ).toBeTruthy();
    expect(externalBrowserRequests).toEqual([]);

    await page.locator('[data-test="recipe-photo-search"]').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(screenshots, `${testInfo.project.name}-real-cover-search.png`),
      fullPage: false,
      animations: 'disabled'
    });
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});
