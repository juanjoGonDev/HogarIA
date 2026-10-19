import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { createSyntheticRecipe, deleteSyntheticRecipe } from './helpers/recipe-fixtures';

const syntheticPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nm9kAAAAASUVORK5CYII=',
  'base64'
);

test('la receta sigue legible si falla la búsqueda y permite reintentar una escena genérica', async ({
  page
}) => {
  const photoQueries: URL[] = [];
  await page.route('**/api/recipes/step-photos**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/image')) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: syntheticPng });
      return;
    }

    photoQueries.push(url);
    if (photoQueries.length === 1) {
      await route.fulfill({
        status: 502,
        json: { success: false, message: 'No se pudo buscar la foto.' }
      });
      return;
    }

    await route.fulfill({
      status: 200,
      json: {
        success: true,
        data: {
          id: '333333333333333333333333',
          altText: 'Verduras troceadas sobre una tabla',
          author: 'Autora sintética E2E',
          licenseName: 'CC BY 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
          sourceUrl: 'https://commons.wikimedia.org/wiki/File:synthetic-cut.jpg'
        }
      }
    });
  });

  await registerAndGoto(page, '/recipes', 'recipe-step-photo-retry');
  const recipe = await createSyntheticRecipe(page, {
    name: 'Receta sintética con reintento de foto',
    servings: 2,
    ingredients: [{ name: 'Verduras sintéticas', quantity: 1, unit: 'unit' }],
    instructionsByLevel: {
      basic: [{ stepNumber: 1, instruction: 'Pica las verduras con cuidado.' }],
      intermediate: [{ stepNumber: 1, instruction: 'Corta las verduras en trozos regulares.' }],
      expert: [{ stepNumber: 1, instruction: 'Corta las verduras en brunoise uniforme.' }]
    }
  });

  try {
    await page.goto(`/recipes?collection=all&page=1&recipe=${recipe.id}`);
    await page.getByRole('button', { name: 'Empezar a cocinar', exact: true }).click();
    const detail = page.locator('[data-test="recipe-cooking-view"]');
    const step = detail.locator('[data-test="recipe-cooking-step"][data-step-number="1"]');
    await expect(step).toContainText('Pica las verduras con cuidado.');
    const retry = step.getByRole('button', { name: 'Buscar de nuevo' });
    await expect(retry).toBeVisible();
    await retry.focus();
    await expect(retry).toBeFocused();
    await retry.press('Enter');

    const photo = step.locator('[data-test="recipe-step-photo"]');
    await expect(
      photo.getByRole('img', { name: 'Verduras troceadas sobre una tabla' })
    ).toBeVisible();
    await expect(photo).toContainText('Autora sintética E2E');
    await expect(photo.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/'
    );
    expect(photoQueries).toHaveLength(2);
    expect(
      photoQueries.every(
        (url) =>
          [...url.searchParams.keys()].join(',') === 'scene' &&
          url.searchParams.get('scene') === 'cut'
      )
    ).toBeTruthy();
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});
