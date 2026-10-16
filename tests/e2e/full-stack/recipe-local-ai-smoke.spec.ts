import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../fixtures';
import { registerWithHousehold } from '../helpers/auth';

const enabled = process.env.HOGARIA_RECIPE_LOCAL_AI_SMOKE === '1';
const ollamaBaseUrl = 'http://127.0.0.1:11434/v1';
const model = 'qwen3:8b';

async function addPantryIngredient(
  page: Parameters<typeof registerWithHousehold>[0],
  name: string,
  amount: string
): Promise<void> {
  await page.getByRole('button', { name: '+ Agregar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agregar Ingrediente' });
  await expect(dialog).toBeVisible();
  await dialog.locator('input#ingredientName').fill(name);
  await dialog.locator('input#quantity').fill(amount);
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator('[data-test="pantry-tabla-inventario"] tr.ingredient-item').filter({
      hasText: name
    })
  ).toHaveCount(1);
}

async function capture(page: Parameters<typeof registerWithHousehold>[0], name: string) {
  const directory = join(process.cwd(), '.e2e-screenshots', 'recipe-local-ai-smoke-20261016');
  mkdirSync(directory, { recursive: true });
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Playwright viewport must be set before capturing QA evidence.');
  await page.screenshot({
    path: join(directory, `${name}-${viewport.width}x${viewport.height}.png`),
    fullPage: true,
    animations: 'disabled'
  });
}

test.describe('recipe generation with a real local AI model', () => {
  test.skip(!enabled, 'Opt-in: requires the local Ollama server and qwen3:8b model.');

  test('generates, reviews, saves and reloads a recipe using Ollama through the UI', async ({
    page
  }, testInfo) => {
    testInfo.setTimeout(360_000);
    test.skip(
      testInfo.project.name !== 'mobile-chrome',
      'Run the real-model workflow once on mobile Chrome.'
    );

    const modelResponse = await fetch('http://127.0.0.1:11434/api/tags');
    expect(modelResponse.ok, 'Ollama must be listening on the loopback interface').toBeTruthy();
    const modelList = (await modelResponse.json()) as { models?: { name: string }[] };
    expect(modelList.models?.some((candidate) => candidate.name === model)).toBeTruthy();

    await page.setViewportSize({ width: 393, height: 851 });
    await registerWithHousehold(page, '/ai-config', 'QA receta IA local');

    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    const configDialog = page.getByRole('dialog', { name: 'Nueva Configuración' });
    await expect(configDialog).toBeVisible();
    await page.locator('input#name').fill('Ollama local QA');
    await page.locator('select[name="provider"]').selectOption('custom');
    await page.locator('input#model').fill(model);
    await page.locator('input#baseUrl').fill(ollamaBaseUrl);
    // Ollama auth is disabled; this explicitly non-secret placeholder only satisfies the required field.
    await page.locator('input#apiKey').fill('ollama-local-no-auth-placeholder');
    await page.locator('input#timeout').fill('240000');
    await page.locator('input#retryAttempts').fill('0');
    await configDialog.locator('button[type="submit"]').click();
    await expect(configDialog).toHaveCount(0);
    await expect(page.locator('.toast--success').last()).toContainText('guardada');

    await page.goto('/pantry');
    await expect(page.locator('h1.pantry__title')).toBeVisible();
    await addPantryIngredient(page, 'Patata QA IA local', '3');
    await addPantryIngredient(page, 'Huevo QA IA local', '4');
    await addPantryIngredient(page, 'Cebolla QA IA local', '1');

    await page.goto('/recipes');
    await expect(page.locator('h1.recipes__title')).toBeVisible();
    await page.getByRole('button', { name: /Generar IA/ }).click();
    for (const name of ['Patata QA IA local', 'Huevo QA IA local', 'Cebolla QA IA local']) {
      const ingredient = page.locator('[data-ingredient-id]').filter({ hasText: name });
      await expect(ingredient).toBeVisible();
      await ingredient.click();
      await expect(
        page.locator('.ai-form__ingredients app-tag').filter({ hasText: name })
      ).toBeVisible();
    }
    await page.locator('[data-test="recipe-ai-next"]').click();
    await page.locator('[data-test="recipe-ai-next"]').click();
    await expect(page.locator('[data-test="recipe-ai-step-3"]')).toBeVisible();
    await expect(page.locator('#recipe-serving-input')).toHaveValue('1');
    await capture(page, 'mobile-generator-review');

    const generationResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/ai/generate-recipe') &&
        response.request().method() === 'POST',
      { timeout: 300_000 }
    );
    await page.getByRole('button', { name: 'Generar 1 receta' }).click();
    const generationResponse = await generationResponsePromise;
    expect(generationResponse.status()).toBe(200);
    const generatedPayload = (await generationResponse.json()) as {
      data: {
        name: string;
        instructionsByLevel: Record<string, { instruction: string }[]>;
      };
    };
    const recipeName = generatedPayload.data.name.trim();
    expect(recipeName.length).toBeGreaterThan(0);
    for (const level of ['basic', 'intermediate', 'expert']) {
      expect(generatedPayload.data.instructionsByLevel[level]?.length).toBeGreaterThan(0);
    }
    await expect
      .poll(() => page.locator('.modal__body').evaluate((body) => body.scrollTop))
      .toBe(0);
    await expect(page.locator('.generated-recipe__title')).toBeFocused();
    await expect(page.locator('.generated-recipe__title')).toHaveText(recipeName);
    const toastCloseButtons = page.locator('.toast__close');
    if ((await toastCloseButtons.count()) > 0) await toastCloseButtons.last().click();

    for (const viewport of [
      { width: 393, height: 851 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('.generated-recipe__title')).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      await capture(page, `recipe-preview-${viewport.width}`);
    }

    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/recipes') && response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Guardar receta' }).click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.status()).toBe(201);
    const savedPayload = (await saveResponse.json()) as { data: { id: string; name: string } };
    expect(savedPayload.data.name).toBe(recipeName);

    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto(`/recipes?search=${encodeURIComponent(recipeName)}`);
    const recipeCard = page.locator('[data-test="recipe-card"]').filter({ hasText: recipeName });
    await expect(recipeCard).toHaveCount(1);
    await capture(page, 'mobile-persisted-recipe');
    await page.reload();
    await expect(
      page.locator('[data-test="recipe-card"]').filter({ hasText: recipeName })
    ).toHaveCount(1);

    await page
      .locator('[data-test="recipe-card"]')
      .filter({ hasText: recipeName })
      .locator('.recipe-card__open')
      .click();
    await expect(page.locator('[data-test="recipe-detail-title"]')).toContainText(recipeName);
    for (const viewport of [
      { width: 393, height: 851 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('[data-test="recipe-detail-title"]')).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      await capture(page, `persisted-detail-${viewport.width}`);
    }
    expect(new URL(page.url()).searchParams.get('recipe')).toBe(savedPayload.data.id);
  });
});
