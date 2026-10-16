import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test as baseTest } from './fixtures';
import { expectAiParticipantsSafetyNoteGeometry } from './helpers/ai-participants';
import { registerAndGoto, registerWithHousehold } from './helpers/auth';
import {
  createSyntheticRecipe,
  deleteSyntheticRecipe,
  type SyntheticRecipe
} from './helpers/recipe-fixtures';
import { mockRecipeStepPhotos } from './helpers/recipe-step-photos';

type ProviderResponse = { status?: number; content?: unknown; delayMs?: number };
type ProviderRequest = { model?: string; messages?: { content?: string }[] };

interface SyntheticProvider {
  readonly baseUrl: string;
  readonly requests: ProviderRequest[];
  enqueue(...responses: ProviderResponse[]): void;
}

const test = baseTest.extend<{ syntheticProvider: SyntheticProvider }>({
  syntheticProvider: async ({}, use) => {
    const queue: ProviderResponse[] = [];
    const requests: ProviderRequest[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
          response.writeHead(404).end();
          return;
        }

        try {
          requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as ProviderRequest);
        } catch {
          response.writeHead(400).end();
          return;
        }

        const next = queue.shift() ?? { status: 503 };
        const send = () => {
          if (response.destroyed) return;
          if (next.status && next.status >= 400) {
            response
              .writeHead(next.status, { 'content-type': 'application/json' })
              .end(JSON.stringify({ error: 'Synthetic provider failure' }));
            return;
          }

          const content =
            typeof next.content === 'string' ? next.content : JSON.stringify(next.content ?? {});
          response
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ choices: [{ message: { content } }] }));
        };

        if (next.delayMs) setTimeout(send, next.delayMs);
        else send();
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      await use({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        requests,
        enqueue: (...responses) => queue.push(...responses)
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }
});

const TOKEN_KEY = 'hogar:v1:auth_token';
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 393, height: 851 },
  { width: 320, height: 568 },
  { width: 568, height: 320 }
];

const singleRecipe = {
  name: 'Crema sintética de zanahoria',
  description: 'Receta sintética para verificar el flujo.',
  difficulty: 'easy',
  cuisine: 'Mediterránea',
  totalTime: 20,
  prepTime: 5,
  cookTime: 15,
  restTime: 5,
  baseServings: 1,
  calories: 180,
  ingredients: [
    {
      name: 'Zanahoria QA recetas',
      quantity: 2,
      unit: 'unit',
      preparation: 'lavada',
      isOptional: true,
      substitutes: ['calabacín'],
      notes: 'Añadir solo si hace falta'
    }
  ],
  utensils: ['olla'],
  guidance: {
    appliances: ['Cocina de gas'],
    parallelTasks: ['Pesa los ingredientes mientras se calienta el agua.'],
    tipsAndVariations: ['Añade limón al final para realzar el sabor.'],
    batchCookingWarning: null
  },
  instructionsByLevel: {
    basic: [
      {
        stepNumber: 1,
        instruction: 'Cocer la zanahoria.',
        duration: 15,
        temperature: null,
        timerRequired: true,
        timerDuration: 15,
        tips: 'Fixture de prueba',
        warning: 'No dejes la olla caliente sin vigilancia.',
        illustration: null
      }
    ],
    intermediate: [
      {
        stepNumber: 1,
        instruction: 'Cortar la zanahoria en trozos iguales y cocerla hasta que esté tierna.',
        duration: 15,
        temperature: null,
        timerRequired: true,
        timerDuration: 15,
        tips: 'Fixture de prueba',
        warning: 'Usa una tabla estable y seca.',
        illustration: null
      }
    ],
    expert: [
      {
        stepNumber: 1,
        instruction: 'Cortar dados uniformes de 2 cm y cocer a hervor suave hasta textura tierna.',
        duration: 15,
        temperature: null,
        timerRequired: true,
        timerDuration: 15,
        tips: 'Fixture de prueba',
        warning: '',
        illustration: null
      }
    ]
  },
  nutrition: { calories: 180, protein: 2, carbs: 20, fat: 5, fiber: null },
  storage: {
    method: 'Refrigerada',
    duration: '2 días',
    reheatingInstructions: 'Calentar',
    container: 'Tarro hermético',
    freezingPossible: true,
    freezingDuration: '1 mes'
  },
  tags: ['synthetic']
};

const singleRecipeWithAllLevels = {
  ...singleRecipe,
  instructionsByLevel: {
    basic: singleRecipe.instructionsByLevel.basic.map((step) => ({
      ...step,
      instruction: 'Cocer la zanahoria.'
    })),
    intermediate: singleRecipe.instructionsByLevel.intermediate.map((step) => ({
      ...step,
      instruction: 'Cortar la zanahoria en trozos iguales y cocerla hasta que esté tierna.'
    })),
    expert: singleRecipe.instructionsByLevel.expert.map((step) => ({
      ...step,
      instruction: 'Cortar en dados uniformes de 2 cm y cocer a hervor suave hasta textura tierna.'
    }))
  }
};

const submittedInstructionsByLevel = Object.fromEntries(
  (['basic', 'intermediate', 'expert'] as const).map((level) => [
    level,
    singleRecipeWithAllLevels.instructionsByLevel[level].map((step) => ({
      ...step,
      illustration: step.illustration ?? null
    }))
  ])
);

const persistedInstructionsByLevel = Object.fromEntries(
  (['basic', 'intermediate', 'expert'] as const).map((level) => [
    level,
    singleRecipeWithAllLevels.instructionsByLevel[level].map((step) => ({
      ...step,
      illustration: step.illustration ?? null,
      tips: step.tips?.trim() ? step.tips : null,
      warning: step.warning?.trim() ? step.warning : null
    }))
  ])
);

function recipeOption(number: number) {
  return {
    ...singleRecipe,
    name: `Opción sintética ${number}`,
    description: `Descripción sintética ${number}.`,
    ingredients: singleRecipe.ingredients.map((ingredient) => ({
      ...ingredient,
      name: `${ingredient.name} ${number}`
    })),
    instructionsByLevel: Object.fromEntries(
      (['basic', 'intermediate', 'expert'] as const).map((level) => [
        level,
        singleRecipe.instructionsByLevel[level].map((step) => ({
          ...step,
          instruction: `${step.instruction} (opción ${number})`
        }))
      ])
    )
  };
}

async function captureScreenshot(
  page: Parameters<typeof registerAndGoto>[0],
  scenario: string,
  viewport: (typeof VIEWPORTS)[number],
  projectName: string
): Promise<void> {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, `${projectName}-${scenario}-${viewport.width}x${viewport.height}.png`),
    animations: 'disabled'
  });
}

async function dismissToasts(page: Parameters<typeof registerAndGoto>[0]): Promise<void> {
  const closeButtons = page.locator('.toast__close');
  for (let attempt = 0; attempt < 5 && (await closeButtons.count()) > 0; attempt += 1) {
    await closeButtons.first().click();
  }
}

async function openGenerator(
  page: Parameters<typeof registerAndGoto>[0],
  viewport: (typeof VIEWPORTS)[number],
  providerBaseUrl: string,
  advanceToOptions = true
) {
  await page.setViewportSize(viewport);
  await mockRecipeStepPhotos(page);
  await registerWithHousehold(page, '/dashboard', 'qa-recipes-ai-flow');
  const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'la prueba debe usar la sesión sintética del runner aislado').toBeTruthy();

  const ingredientResponse = await page.request.post('/api/pantry/ingredients', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: 'Zanahoria QA recetas',
      category: 'vegetables',
      quantity: 2,
      unit: 'unit',
      location: 'pantry'
    }
  });
  expect(
    ingredientResponse.ok(),
    'se debe crear el ingrediente solo en la SQLite temporal'
  ).toBeTruthy();
  const secondIngredientResponse = await page.request.post('/api/pantry/ingredients', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: 'Leche QA recetas',
      category: 'dairy',
      quantity: 1,
      unit: 'l',
      location: 'fridge'
    }
  });
  expect(secondIngredientResponse.ok(), 'el segundo ingrediente también es sintético').toBeTruthy();

  const providerResponse = await page.request.post('/api/ai/configs', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: 'Proveedor sintético QA',
      provider: 'custom',
      baseUrl: providerBaseUrl,
      apiKey: 'synthetic-e2e-only',
      model: 'synthetic-test-model',
      timeout: 300,
      retryAttempts: 0
    }
  });
  expect(
    providerResponse.status(),
    'la configuración debe apuntar únicamente al stub local temporal'
  ).toBe(201);

  await page.goto('/recipes');
  await expect(page.locator('h1.recipes__title')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Generar IA/ }).click();
  const ingredient = page
    .locator('[data-ingredient-id]')
    .filter({ hasText: 'Zanahoria QA recetas' });
  await expect(ingredient).toBeVisible();
  await ingredient.click();
  await expect(
    page.locator('.ai-form__ingredients app-tag').filter({ hasText: 'Zanahoria QA recetas' })
  ).toBeVisible();
  if (advanceToOptions) await advanceRecipeWizardToOptions(page);
}

async function advanceRecipeWizardToOptions(page: Parameters<typeof registerAndGoto>[0]) {
  await page.locator('[data-test="recipe-ai-next"]').click();
  await page.locator('[data-test="recipe-ai-next"]').click();
}

test.describe('Generación de recetas IA', () => {
  test('los filtros rápidos muestran resultados reales y conservan la pestaña en URL e historial', async ({
    page,
    syntheticProvider
  }, testInfo) => {
    const viewport = testInfo.project.name === 'chromium' ? VIEWPORTS[0] : VIEWPORTS[1];
    const searchStem = `Filtro recetas QA ${Date.now()}`;
    const quickName = `${searchStem} manual rápida`;
    const slowName = `${searchStem} manual lenta`;
    const aiName = `${searchStem} generada IA`;
    syntheticProvider.enqueue({ content: { ...singleRecipe, name: aiName } });

    let quickRecipe: SyntheticRecipe | undefined;
    let slowRecipe: SyntheticRecipe | undefined;
    let aiRecipe: SyntheticRecipe | undefined;

    try {
      await openGenerator(page, viewport, syntheticProvider.baseUrl);
      quickRecipe = await createSyntheticRecipe(page, { name: quickName, totalTime: 15 });
      slowRecipe = await createSyntheticRecipe(page, { name: slowName, totalTime: 60 });
      const favoriteResponse = await page.request.post(`/api/recipes/${quickRecipe.id}/favorite`, {
        headers: { authorization: `Bearer ${quickRecipe.token}` }
      });
      expect(favoriteResponse.status()).toBe(200);

      const generatedResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/ai/generate-recipe') &&
          response.request().method() === 'POST'
      );
      await page.getByRole('button', { name: 'Generar 1 receta' }).click();
      expect((await generatedResponse).status()).toBe(200);

      const saveResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/recipes') && response.request().method() === 'POST'
      );
      await page.getByRole('button', { name: 'Guardar receta' }).click();
      const savedResponse = await saveResponse;
      expect(savedResponse.status()).toBe(201);
      const savedPayload = (await savedResponse.json()) as {
        data: { id: string; name: string; author: string; authorId: string };
      };
      aiRecipe = {
        id: savedPayload.data.id,
        name: savedPayload.data.name,
        token: quickRecipe.token
      };
      expect(savedPayload.data.author).toBe('ai');
      expect(savedPayload.data.authorId).toBeTruthy();
      expect(savedPayload.data.name).toBe(aiName);
      expect(syntheticProvider.requests).toHaveLength(1);

      await page.goto(`/recipes?search=${encodeURIComponent(searchStem)}`);
      const matchingCards = page.locator('.recipe-card');
      const quickCard = matchingCards.filter({ hasText: quickName });
      const slowCard = matchingCards.filter({ hasText: slowName });
      const aiCard = matchingCards.filter({ hasText: aiName });
      await expect(matchingCards).toHaveCount(3);
      await expect(quickCard).toHaveCount(1);
      await expect(slowCard).toHaveCount(1);
      await expect(aiCard).toHaveCount(1);

      const favoritesTab = page.getByRole('button', { name: 'Favoritas', exact: true });
      await favoritesTab.click();
      await expect(favoritesTab).toHaveAttribute('aria-pressed', 'true');
      await expect(matchingCards).toHaveCount(1);
      await expect(quickCard).toBeVisible();
      await expect(slowCard).toHaveCount(0);
      await expect(aiCard).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get('isFavorite')).toBe('true');

      const quickTab = page.getByRole('button', { name: 'Rápidas', exact: true });
      await quickTab.click();
      await expect(quickTab).toHaveAttribute('aria-pressed', 'true');
      await expect(matchingCards).toHaveCount(2);
      await expect(quickCard).toBeVisible();
      await expect(aiCard).toBeVisible();
      await expect(slowCard).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get('maxTime')).toBe('30');
      expect(new URL(page.url()).searchParams.get('isFavorite')).toBeNull();

      const aiTab = page.getByRole('button', { name: 'IA', exact: true });
      await aiTab.click();
      await expect(aiTab).toHaveAttribute('aria-pressed', 'true');
      await expect(matchingCards).toHaveCount(1);
      await expect(aiCard).toBeVisible();
      await expect(quickCard).toHaveCount(0);
      await expect(slowCard).toHaveCount(0);
      expect(new URL(page.url()).searchParams.get('author')).toBe('ai');
      expect(new URL(page.url()).searchParams.get('search')).toBe(searchStem);
      await captureScreenshot(page, 'recipe-quick-filter-ai', viewport, testInfo.project.name);

      await page.goBack();
      await expect(quickTab).toHaveAttribute('aria-pressed', 'true');
      await expect(matchingCards).toHaveCount(2);
      await page.goForward();
      await expect(aiTab).toHaveAttribute('aria-pressed', 'true');
      await expect(matchingCards).toHaveCount(1);
      await page.reload();
      await expect(aiTab).toHaveAttribute('aria-pressed', 'true');
      await expect(aiCard).toHaveCount(1);

      for (const responsiveViewport of VIEWPORTS.slice(2)) {
        await page.setViewportSize(responsiveViewport);
        await expect(aiTab).toHaveAttribute('aria-pressed', 'true');
        await expect(aiCard).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          responsiveViewport.width
        );
        if (testInfo.project.name === 'mobile-chrome') {
          await captureScreenshot(
            page,
            'recipe-quick-filter-ai',
            responsiveViewport,
            testInfo.project.name
          );
        }
      }
      await page.setViewportSize(viewport);

      const allTab = page.getByRole('button', { name: 'Todas', exact: true });
      await allTab.click();
      await expect(allTab).toHaveAttribute('aria-pressed', 'true');
      await expect(matchingCards).toHaveCount(3);
      const query = new URL(page.url()).searchParams;
      expect(query.get('search')).toBe(searchStem);
      expect(query.get('isFavorite')).toBeNull();
      expect(query.get('author')).toBeNull();
      expect(query.get('maxTime')).toBeNull();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width
      );

      await page.route('**/api/recipes**', async (route) => {
        const requestUrl = new URL(route.request().url());
        if (
          requestUrl.pathname.endsWith('/api/recipes') &&
          requestUrl.searchParams.get('search') === searchStem &&
          requestUrl.searchParams.get('author') === 'ai'
        ) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, message: 'Synthetic list failure' })
          });
          return;
        }
        await route.continue();
      });
      const failedFilterResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/recipes?') &&
          response.url().includes('author=ai') &&
          response.status() === 503
      );
      await aiTab.click();
      expect((await failedFilterResponse).status()).toBe(503);
      await expect(aiTab).toHaveAttribute('aria-pressed', 'true');
      expect(new URL(page.url()).searchParams.get('author')).toBe('ai');
      const loadError = page.locator('[data-test="recipes-load-error"]');
      await expect(loadError).toBeVisible();
      await expect(loadError).toContainText('desfasados');
      await expect(matchingCards).toHaveCount(3);
      await expect(page.locator('.empty-state')).toHaveCount(0);
      const retryButton = page.getByRole('button', { name: 'Reintentar', exact: true });
      await captureScreenshot(
        page,
        'recipe-quick-filter-load-error',
        viewport,
        testInfo.project.name
      );
      for (const errorViewport of VIEWPORTS.slice(2)) {
        await page.setViewportSize(errorViewport);
        await expect(loadError).toBeVisible();
        await expect(matchingCards).toHaveCount(3);
        await retryButton.scrollIntoViewIfNeeded();
        await expect(retryButton).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          errorViewport.width
        );
        if (testInfo.project.name === 'mobile-chrome') {
          await captureScreenshot(
            page,
            'recipe-quick-filter-load-error',
            errorViewport,
            testInfo.project.name
          );
        }
      }
      await page.setViewportSize(viewport);
      await page.unroute('**/api/recipes**');
      await retryButton.click();
      await expect(aiCard).toBeVisible();
      await expect(page.locator('[data-test="recipes-load-error"]')).toHaveCount(0);

      await page.goto(`/recipes?search=${encodeURIComponent(`${searchStem} sin coincidencias`)}`);
      await expect(page.locator('.recipe-card')).toHaveCount(0);
      await expect(page.locator('.empty-state')).toBeVisible();
    } finally {
      if (aiRecipe) await deleteSyntheticRecipe(page, aiRecipe);
      if (slowRecipe) await deleteSyntheticRecipe(page, slowRecipe);
      if (quickRecipe) await deleteSyntheticRecipe(page, quickRecipe);
    }
  });

  for (const viewport of VIEWPORTS.slice(0, 2)) {
    test(`wizard, filtros de ingredientes y preferencias de invitado (${viewport.width}×${viewport.height})`, async ({
      page,
      syntheticProvider
    }, testInfo) => {
      syntheticProvider.enqueue({ content: singleRecipe });
      await openGenerator(page, viewport, syntheticProvider.baseUrl, false);
      const dialog = page.getByRole('dialog', { name: 'Generar Receta con IA' });
      await expect(page.locator('[data-test="recipe-ai-step-1"]')).toBeVisible();
      await expect(page.locator('[data-test="selected-ingredient-count"]')).toContainText(
        'Selección: 1'
      );
      await captureScreenshot(
        page,
        'recipe-generator-ingredients',
        viewport,
        testInfo.project.name
      );

      const pantryCount = await page
        .locator('[data-test="recipe-ai-pantry-options"] [data-ingredient-id]')
        .count();
      await page.locator('[data-test="recipe-ai-select-all"]').click();
      await expect(page.locator('[data-test="selected-ingredient-count"]')).toContainText(
        `Selección: ${pantryCount}`
      );
      const dairyCategory = dialog.getByRole('button', { name: /Lácteos/ });
      await dairyCategory.click();
      await expect(dairyCategory).toHaveAttribute('aria-pressed', 'true');
      const dairyOptions = page.locator(
        '[data-test="recipe-ai-pantry-options"] [data-ingredient-id]'
      );
      await expect(dairyOptions).toHaveCount(1);
      await expect(page.locator('[data-test="selected-ingredient-count"]')).toContainText(
        `Selección: ${pantryCount}`
      );
      await expect(page.locator('[data-test="recipe-ai-pantry-options"]')).toContainText(
        'Leche QA recetas'
      );
      await expect(page.locator('[data-test="recipe-ai-review-ingredients"]')).toHaveCount(0);
      await page.locator('[data-test="recipe-ai-clear-ingredients"]').click();
      await expect(page.locator('[data-test="selected-ingredient-count"]')).toContainText(
        'Selección: 0'
      );
      await dialog.getByRole('button', { name: /Verduras/ }).click();
      await page
        .locator('[data-ingredient-id]')
        .filter({ hasText: 'Zanahoria QA recetas' })
        .click();
      await expect(page.locator('[data-test="selected-ingredient-count"]')).toContainText(
        'Selección: 1'
      );

      await page.locator('[data-test="recipe-ai-next"]').click();
      await expect(page.locator('[data-test="recipe-ai-step-2"]')).toBeVisible();
      const safetyNote = page.locator('[data-test="ai-participants-safety-note"]');
      await expect(safetyNote).toContainText('La app no puede garantizar');
      await expect(safetyNote).toBeInViewport({ ratio: 0.9 });
      await expectAiParticipantsSafetyNoteGeometry(safetyNote);
      await captureScreenshot(
        page,
        'recipe-generator-allergy-safety-note',
        viewport,
        testInfo.project.name
      );
      await page.locator('[data-test="ai-add-guest"]').click();
      await page.locator('[data-test="ai-guest-0-allergies-toggle"]').click();
      const eggPreset = page.locator('[data-test="ai-guest-0-allergies-option-huevo"]');
      await expect(eggPreset).toHaveText('🥚 Huevo');
      await eggPreset.focus();
      await expect(eggPreset).toBeFocused();
      await page.keyboard.press('Space');
      await expect(eggPreset).toHaveAttribute('aria-pressed', 'true');
      await page.locator('[data-test="ai-guest-0-likes-toggle"]').click();
      await page
        .locator('[data-test="ai-guest-0-likes-custom-input"]')
        .fill('  pupusas de queso  ');
      await page.locator('[data-test="ai-guest-0-likes-custom-add"]').click();
      await expect(page.locator('[data-test="ai-guest-0-likes-selected"]')).toContainText(
        'pupusas de queso'
      );
      await captureScreenshot(
        page,
        'recipe-generator-participants',
        viewport,
        testInfo.project.name
      );

      await page.locator('[data-test="recipe-ai-next"]').click();
      await expect(page.locator('[data-test="recipe-ai-step-3"]')).toBeVisible();
      await expect(page.locator('[data-test="recipe-ai-review-ingredients"]')).toContainText(
        'Zanahoria QA recetas'
      );
      await expect(dialog.locator('#recipe-serving-input')).toBeVisible();
      await page.locator('[data-test="recipe-ai-back"]').click();
      await expect(page.locator('[data-test="ai-guest-0-allergies-selected"]')).toContainText(
        'Huevo'
      );
      await expect(page.locator('[data-test="ai-guest-0-likes-selected"]')).toContainText(
        'pupusas de queso'
      );
      await page.locator('[data-test="recipe-ai-next"]').click();

      const generationRequest = page.waitForRequest((request) =>
        request.url().includes('/api/ai/generate-recipe')
      );
      const generationResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/ai/generate-recipe') &&
          response.request().method() === 'POST'
      );
      await page.getByRole('button', { name: 'Generar 1 receta' }).click();
      const payload = (await generationRequest).postDataJSON() as {
        guests: { allergies: string[]; likes: string[] }[];
      };
      expect(payload.guests).toEqual([
        expect.objectContaining({ allergies: ['huevo'], likes: ['pupusas de queso'] })
      ]);
      expect((await generationResponse).ok()).toBeTruthy();
      expect(syntheticProvider.requests).toHaveLength(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width
      );
    });
  }

  test('bloquea la generación sin ingredientes o con raciones no válidas', async ({
    page,
    syntheticProvider
  }) => {
    const viewport = VIEWPORTS[0];
    await openGenerator(page, viewport, syntheticProvider.baseUrl, false);
    await page.locator('[data-test="recipe-ai-clear-ingredients"]').click();
    await advanceRecipeWizardToOptions(page);

    const singleRecipeButton = page.getByRole('button', { name: 'Generar 1 receta' });
    const multipleRecipeButton = page.getByRole('button', { name: 'Generar 3 opciones' });
    await expect(singleRecipeButton).toBeDisabled();
    await expect(multipleRecipeButton).toBeDisabled();

    const servings = page.locator('#recipe-serving-input');
    await servings.fill('0');
    await expect(singleRecipeButton).toBeDisabled();
    await servings.fill('2');
    await expect(singleRecipeButton).toBeDisabled();
    await expect(multipleRecipeButton).toBeDisabled();
  });

  test('preselecciona las raciones activas y el nivel de cocina de principiante', async ({
    page
  }, testInfo) => {
    const viewport = testInfo.project.name === 'chromium' ? VIEWPORTS[0] : VIEWPORTS[1];
    await page.setViewportSize(viewport);
    await registerWithHousehold(page, '/recipes', 'qa-default-servings');
    await expect(page.locator('h1.recipes__title')).toBeVisible();
    await page.getByRole('button', { name: /Generar IA/ }).click();

    const dialog = page.getByRole('dialog', { name: 'Generar Receta con IA' });
    await advanceRecipeWizardToOptions(page);
    await expect(dialog.locator('#recipe-serving-input')).toHaveValue('1');
    await expect(dialog.locator('#recipe-detail-level')).toHaveAccessibleName('Nivel de detalle');
    await expect(dialog.locator('#recipe-detail-level')).toHaveValue('basic');
    await captureScreenshot(page, 'active-household-defaults', viewport, testInfo.project.name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width
    );
  });

  for (const viewport of VIEWPORTS.slice(0, 2)) {
    test(`cambia el nivel solo en pantalla y conserva las tres variantes al guardar/reabrir (${viewport.width}×${viewport.height})`, async ({
      page,
      syntheticProvider
    }, testInfo) => {
      const recipeName = `${singleRecipe.name} ${viewport.width}`;
      const batchCookingWarning = 'Dora la zanahoria en dos tandas para que se dore y no se cueza.';
      syntheticProvider.enqueue({
        content: {
          ...singleRecipeWithAllLevels,
          name: recipeName,
          guidance: { ...singleRecipe.guidance, batchCookingWarning }
        }
      });
      await openGenerator(page, viewport, syntheticProvider.baseUrl);
      const recipeDialog = page.getByRole('dialog', { name: 'Generar Receta con IA' });
      await expect(recipeDialog).toHaveClass(/modal--lg/);
      await expect(recipeDialog.locator('.ai-form')).toBeVisible();
      // A new household starts with one member, so its default portion count is one.
      await expect(recipeDialog.locator('#recipe-serving-input')).toHaveValue('1');
      await recipeDialog.locator('#recipe-serving-input').fill('4');

      const generate = page.getByRole('button', { name: 'Generar 1 receta' });
      const generationRequest = page.waitForRequest((request) =>
        request.url().includes('/api/ai/generate-recipe')
      );
      const generatedResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/ai/generate-recipe') &&
          response.request().method() === 'POST'
      );
      await generate.click();
      const response = await generatedResponse;
      expect(response.status(), await response.text()).toBe(200);
      expect((await generationRequest).postDataJSON().servings).toBe(4);
      await expect(recipeDialog).toHaveClass(/modal--full/);
      await expect(recipeDialog.locator('.ai-form')).toBeHidden();

      const generatedSelector = page.locator('.generated-recipe__detail-level select');
      await expect(generatedSelector).toHaveValue('basic');
      await expect(generatedSelector).toHaveAccessibleName('Nivel de detalle');
      await expect(page.locator('.generated-recipe__steps')).toContainText('Cocer la zanahoria.');
      await expect(recipeDialog.locator('.generated-recipe__meta')).toContainText('4 porciones');
      await expect(recipeDialog.locator('.generated-recipe__meta')).not.toContainText('20 min');
      await expect(page.locator('.generated-recipe__list')).toContainText(
        'Añadir solo si hace falta'
      );
      const generatedPreview = page.locator('.generated-recipe');
      const generatedServings = generatedPreview.locator('[data-test="generated-serving-count"]');
      await expect(generatedServings).toHaveValue('4');
      const generatedIngredients = generatedPreview.locator('.generated-recipe__list li').first();
      await expect(generatedIngredients).toContainText('8 unit de Zanahoria QA recetas');
      await expect(
        generatedPreview.locator('[data-test="generated-recipe-batch-warning"]')
      ).toContainText(batchCookingWarning);
      await generatedServings.fill('3');
      await expect(generatedIngredients).toContainText('6 unit de Zanahoria QA recetas');
      await expect(generatedServings).toHaveValue('3');
      expect(syntheticProvider.requests).toHaveLength(1);
      await expect(generatedPreview.locator('.generated-recipe__list li')).toContainText(
        '(lavada) · Añadir solo si hace falta'
      );
      const timings = generatedPreview.locator('[data-test="generated-recipe-timings"]');
      await expect(timings).toContainText('20 min');
      await expect(timings).toContainText('Tiempo total');
      await expect(timings).toContainText('Preparación');
      await expect(timings).toContainText('Cocción');
      await expect(timings).toContainText('Reposo');
      await expect(
        generatedPreview.locator('[data-test="generated-recipe-nutrition"]')
      ).toContainText('Proteínas');
      await expect(
        generatedPreview.locator('[data-test="generated-recipe-nutrition"]')
      ).toContainText('20 g');
      const storage = generatedPreview.locator('[data-test="generated-recipe-storage"]');
      await expect(storage).toContainText('Conservación');
      await expect(storage).toContainText('En frigorífico: 2 días');
      await expect(storage).toContainText('Tarro hermético');
      await expect(storage).toContainText('Congelación: 1 mes');
      await expect(storage).toContainText('Recalentar: Calentar');
      await expect(
        generatedPreview.locator('[data-test="generated-recipe-warning"]')
      ).toContainText('No dejes la olla caliente sin vigilancia.');
      await expect(generatedPreview).toContainText('Cocina de gas');
      await expect(generatedPreview).toContainText('Utensilios: olla');
      await expect(generatedPreview).toContainText(
        'Pesa los ingredientes mientras se calienta el agua.'
      );
      await expect(generatedPreview).toContainText('Añade limón al final para realzar el sabor.');
      await expect(generatedPreview.locator('.step__illustration')).toHaveCount(0);
      const generatedOrder = [
        timings,
        generatedPreview.locator('[data-test="generated-recipe-nutrition"]'),
        generatedPreview.locator('[data-test="generated-recipe-ingredients"]'),
        generatedPreview.locator('[data-test="generated-recipe-equipment"]'),
        generatedPreview.locator('[data-test="generated-recipe-preparation"]'),
        generatedPreview.locator('[data-test="generated-recipe-parallel-tasks"]'),
        generatedPreview.locator('[data-test="generated-recipe-tips-variations"]'),
        storage
      ];
      const generatedSectionTops = await Promise.all(
        generatedOrder.map(async (section) => (await section.boundingBox())?.y ?? Number.NaN)
      );
      expect(
        generatedSectionTops,
        'el borrador debe seguir el orden de lectura indicado en el prompt'
      ).toEqual([...generatedSectionTops].sort((left, right) => left - right));
      const generatedStepPhoto = generatedPreview.locator('[data-test="recipe-step-photo"]');
      await expect(generatedStepPhoto).toHaveCount(1);
      await expect(generatedStepPhoto.locator('img')).toHaveAttribute(
        'alt',
        'Imagen sintética de referencia: cook'
      );
      await recipeDialog.getByRole('button', { name: 'Editar ingredientes' }).click();
      await expect(recipeDialog.locator('.ai-form')).toBeVisible();
      await recipeDialog.getByRole('button', { name: 'Ocultar formulario' }).click();
      await expect(recipeDialog.locator('.ai-form')).toBeHidden();
      await generatedSelector.focus();
      await expect(generatedSelector).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(generatedSelector).toHaveValue('intermediate');
      await page.keyboard.press('ArrowDown');
      await expect(generatedSelector).toHaveValue('expert');
      await expect(generatedStepPhoto).toHaveCount(1);
      await expect(page.locator('.generated-recipe__steps')).toContainText(
        'dados uniformes de 2 cm'
      );
      expect(syntheticProvider.requests).toHaveLength(1);
      await dismissToasts(page);
      await recipeDialog.locator('.modal__body').evaluate((body) => {
        body.scrollTop = 0;
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await captureScreenshot(
        page,
        'generated-recipe-detail-level',
        viewport,
        testInfo.project.name
      );

      const saveRequest = page.waitForRequest(
        (request) => request.url().endsWith('/api/recipes') && request.method() === 'POST'
      );
      const saveResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/recipes') && response.request().method() === 'POST'
      );
      await page.getByRole('button', { name: 'Guardar receta' }).click();
      const savePayload = (await saveRequest).postDataJSON();
      expect(savePayload.servings).toBe(1);
      expect(savePayload.instructionsByLevel).toEqual(submittedInstructionsByLevel);
      expect(savePayload).not.toHaveProperty('steps');
      expect(savePayload.ingredients).toEqual(singleRecipeWithAllLevels.ingredients);
      expect(savePayload.guidance.batchCookingWarning).toBe(batchCookingWarning);
      expect(savePayload.nutrition.fiber).toBeNull();
      expect(savePayload.storage).toEqual({
        method: 'Refrigerada',
        duration: '2 días',
        reheatingInstructions: 'Calentar',
        container: 'Tarro hermético',
        freezingPossible: true,
        freezingDuration: '1 mes'
      });
      expect((await saveResponse).status()).toBe(201);
      await expect(recipeDialog).not.toBeVisible();
      await page.getByRole('button', { name: /Generar IA/ }).click();
      const reopenedDialog = page.getByRole('dialog', { name: 'Generar Receta con IA' });
      await expect(reopenedDialog).toHaveClass(/modal--lg/);
      await expect(reopenedDialog.locator('.ai-form')).toBeVisible();

      const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
      expect(token).toBeTruthy();
      const recipesResponse = await page.request.get('/api/recipes', {
        headers: { authorization: `Bearer ${token}` }
      });
      const recipesPayload = (await recipesResponse.json()) as {
        data: { recipes: Record<string, unknown>[] };
      };
      const saved = recipesPayload.data.recipes.filter((recipe) => recipe.name === recipeName);
      expect(saved).toHaveLength(1);
      expect(saved[0].instructionsByLevel).toEqual(persistedInstructionsByLevel);
      expect(saved[0]).not.toHaveProperty('steps');
      expect(saved[0].servings).toBe(1);
      expect(saved[0].ingredients).toMatchObject(singleRecipeWithAllLevels.ingredients);
      expect((saved[0].guidance as { batchCookingWarning: string }).batchCookingWarning).toBe(
        batchCookingWarning
      );
      expect(saved[0].nutrition).toMatchObject(singleRecipeWithAllLevels.nutrition);
      expect(saved[0].storage).toEqual({
        method: 'Refrigerada',
        duration: '2 días',
        reheatingInstructions: 'Calentar',
        container: 'Tarro hermético',
        freezingPossible: true,
        freezingDuration: '1 mes'
      });
      expect(syntheticProvider.requests).toHaveLength(1);

      await page.reload();
      if (viewport.width <= 600) {
        const featured = page
          .locator('[data-test="recipe-featured"]')
          .filter({ hasText: recipeName });
        await expect(featured).toBeVisible();
        await featured.locator('.recipes__featured-title-button').click();
      } else {
        const card = page.locator('.recipe-card:visible').filter({ hasText: recipeName }).first();
        await expect(card).toBeVisible();
        await card.locator('.recipe-card__open').click();
      }
      await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const savedBasicLevel = page.locator('[data-test="recipe-detail-level-basic"]');
      await expect(savedBasicLevel).toBeVisible();
      await savedBasicLevel.click();
      await expect(savedBasicLevel).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.recipe-detail__steps')).toContainText('Cocer la zanahoria.');
      const ingredientsTab = page.locator('[data-test="recipe-detail-tab-ingredients"]');
      await ingredientsTab.click();
      await expect(ingredientsTab).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('[data-test="recipe-serving-count"]')).toHaveValue('1');
      await expect(page.locator('[data-test="recipe-ingredients"] li').first()).toContainText(
        '2 unit'
      );
      await expect(page.locator('[data-test="recipe-batch-warning"]')).toContainText(
        batchCookingWarning
      );
      const savedServings = page.locator('[data-test="recipe-serving-count"]');
      await savedServings.fill('4');
      await expect(page.locator('[data-test="recipe-ingredients"] li').first()).toContainText(
        '8 unit'
      );
      await savedServings.fill('1');
      await page
        .locator(
          '[data-test="recipe-cooking-open"]:visible button, [data-test="recipe-cooking-open-sidebar"]:visible button'
        )
        .click();
      const cookingView = page.locator('[data-test="recipe-cooking-view"]');
      await expect(cookingView).toBeVisible();
      await expect(cookingView.locator('[data-test="recipe-step-photo"]')).toHaveCount(1);
      await expect(page.locator('[data-test="cooking-batch-warning"]')).toContainText(
        batchCookingWarning
      );
      const cookingServings = page.locator('[data-test="cooking-serving-count"]');
      await expect(cookingServings).toHaveValue('1');
      await cookingServings.fill('4');
      await cookingServings.press('Tab');
      await expect(page.locator('[data-test="cooking-ingredient"]')).toContainText('8 unit');
      expect(syntheticProvider.requests).toHaveLength(1);
      await captureScreenshot(
        page,
        'saved-recipe-cooking-batches',
        viewport,
        testInfo.project.name
      );
      expect(syntheticProvider.requests).toHaveLength(1);
      await dismissToasts(page);
      await captureScreenshot(page, 'saved-recipe-detail-level', viewport, testInfo.project.name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width
      );
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`la generación individual informa error y permite reintentar (${viewport.width}×${viewport.height})`, async ({
      page,
      syntheticProvider
    }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      syntheticProvider.enqueue({ content: singleRecipe, delayMs: 900 }, { content: singleRecipe });
      await openGenerator(page, viewport, syntheticProvider.baseUrl);

      const generate = page.getByRole('button', { name: 'Generar 1 receta' });
      const firstRequest = page.waitForRequest((request) =>
        request.url().includes('/api/ai/generate-recipe')
      );
      const firstResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/ai/generate-recipe') &&
          response.request().method() === 'POST'
      );
      await generate.click();
      const firstPayload = (await firstRequest).postDataJSON();
      expect(firstPayload.ingredients).toContainEqual(
        expect.objectContaining({ name: 'Zanahoria QA recetas', quantity: 2 })
      );
      expect((await firstResponse).status()).toBe(500);
      expect(syntheticProvider.requests).toHaveLength(1);
      expect(JSON.stringify(syntheticProvider.requests[0].messages)).toContain(
        'Zanahoria QA recetas'
      );
      // The global interceptor owns the user-facing server-error copy; assert the
      // error state, not wording that varies by API response/language.
      await expect(page.locator('.toast--error')).toBeVisible();
      expect(await page.getByText('¡Receta generada!', { exact: true }).count()).toBe(0);
      await expect(generate).toBeEnabled();
      await dismissToasts(page);

      const retryResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/ai/generate-recipe') &&
          response.request().method() === 'POST'
      );
      await generate.click();
      expect((await retryResponse).status()).toBe(200);
      expect(syntheticProvider.requests).toHaveLength(2);
      await expect(page.locator('.generated-recipe__title')).toHaveText(singleRecipe.name);
      await expect(page.getByText('¡Receta generada!', { exact: true })).toBeVisible();
      await expect(generate).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Editar ingredientes' })).toBeVisible();
      await dismissToasts(page);
      const dialog = page.getByRole('dialog');
      const dialogBounds = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      expect(dialogBounds.left).toBeGreaterThanOrEqual(0);
      expect(dialogBounds.right).toBeLessThanOrEqual(viewport.width);
      await captureScreenshot(page, 'recipes-ai-single', viewport, test.info().project.name);

      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(viewport.width);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`muestra y permite guardar una candidata múltiple tras recuperarse de una respuesta no utilizable (${viewport.width}×${viewport.height})`, async ({
      page,
      syntheticProvider
    }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      syntheticProvider.enqueue(
        { content: '[]' },
        { content: recipeOption(1) },
        { content: recipeOption(2) },
        { content: recipeOption(3) }
      );
      await openGenerator(page, viewport, syntheticProvider.baseUrl);
      const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
      expect(token, 'la verificación debe seguir usando la sesión sintética').toBeTruthy();
      const baselineResponse = await page.request.get('/api/recipes', {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(baselineResponse.ok()).toBeTruthy();
      const baselinePayload = (await baselineResponse.json()) as {
        data: { recipes: { name: string }[] };
      };
      const candidateNames = [1, 2, 3].map((number) => `Opción sintética ${number}`);
      const baselineCounts = candidateNames.map(
        (name) => baselinePayload.data.recipes.filter((recipe) => recipe.name === name).length
      );

      const generate = page.getByRole('button', { name: 'Generar 3 opciones' });
      const firstRequest = page.waitForRequest((request) =>
        request.url().includes('/api/ai/generate-multiple-recipes')
      );
      const firstResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/ai/generate-multiple-recipes') &&
          response.request().method() === 'POST'
      );
      await generate.click();
      const firstPayload = (await firstRequest).postDataJSON();
      expect(firstPayload.count).toBe(3);
      expect(firstPayload.ingredients).toContainEqual(
        expect.objectContaining({ name: 'Zanahoria QA recetas', quantity: 2 })
      );
      await expect(page.locator('.toast--error')).toBeVisible();
      expect((await firstResponse).status()).toBe(500);
      expect(syntheticProvider.requests).toHaveLength(1);
      expect(await page.getByText('¡Recetas generadas!', { exact: true }).count()).toBe(0);
      await expect(generate).toBeEnabled();
      await dismissToasts(page);

      const retryResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/ai/generate-multiple-recipes') &&
          response.request().method() === 'POST'
      );
      await generate.click();
      expect((await retryResponse).status()).toBe(200);
      expect(syntheticProvider.requests).toHaveLength(4);
      const optionsRegion = page.getByRole('region', {
        name: 'Elige una receta para guardar'
      });
      const generatedOptions = optionsRegion.getByRole('article');
      await expect(generatedOptions).toHaveCount(3);
      const firstOptionLevel = generatedOptions
        .nth(0)
        .locator('.generated-option__detail-level select');
      await expect(firstOptionLevel).toHaveAccessibleName('Nivel de detalle');
      await expect(firstOptionLevel).toHaveValue('basic');
      await firstOptionLevel.selectOption('expert');
      await expect(generatedOptions.nth(0).locator('.generated-option__steps')).toContainText(
        'opción 1'
      );
      expect(syntheticProvider.requests).toHaveLength(4);
      for (const [index, option] of [1, 2, 3].entries()) {
        const generatedOption = generatedOptions.nth(index);
        await expect(generatedOption.getByRole('heading')).toHaveText(`Opción sintética ${option}`);
        await expect(generatedOption.locator('.generated-option__meta')).toContainText(
          '1 porciones'
        );
      }
      await expect(page.getByText('¡Recetas generadas!', { exact: true })).toBeVisible();
      await dismissToasts(page);
      const recipeDialog = page.getByRole('dialog', { name: 'Generar Receta con IA' });
      await expect(recipeDialog).toHaveClass(/modal--full/);
      await expect(recipeDialog.locator('.ai-form')).toBeHidden();

      await generatedOptions.nth(0).getByRole('button', { name: 'Ver receta completa' }).click();
      const optionPreview = page.locator('.generated-recipe');
      await expect(
        optionPreview.getByRole('heading', { name: 'Opción sintética 1' })
      ).toBeVisible();
      await expect(optionPreview.locator('.generated-recipe__meta')).toContainText('1 porciones');
      await expect(optionPreview.locator('[data-test="generated-recipe-timings"]')).toContainText(
        'Preparación'
      );
      await expect(optionPreview.locator('.generated-recipe__list')).toContainText(
        'Zanahoria QA recetas'
      );
      await expect(optionPreview.locator('[data-test="generated-recipe-nutrition"]')).toContainText(
        'Proteínas'
      );
      await expect(optionPreview.locator('[data-test="generated-recipe-storage"]')).toContainText(
        'Tarro hermético'
      );
      const optionSectionOrder = [
        optionPreview.locator('[data-test="generated-recipe-timings"]'),
        optionPreview.locator('[data-test="generated-recipe-nutrition"]'),
        optionPreview.locator('[data-test="generated-recipe-ingredients"]'),
        optionPreview.locator('[data-test="generated-recipe-equipment"]'),
        optionPreview.locator('[data-test="generated-recipe-preparation"]'),
        optionPreview.locator('[data-test="generated-recipe-parallel-tasks"]'),
        optionPreview.locator('[data-test="generated-recipe-tips-variations"]'),
        optionPreview.locator('[data-test="generated-recipe-storage"]')
      ];
      const optionSectionTops = await Promise.all(
        optionSectionOrder.map(async (section) => (await section.boundingBox())?.y ?? Number.NaN)
      );
      expect(
        optionSectionTops,
        'cada candidata completa debe conservar el orden del prompt'
      ).toEqual([...optionSectionTops].sort((left, right) => left - right));
      await expect(optionPreview).toContainText('Cocina de gas');
      await expect(optionPreview).toContainText(
        'Pesa los ingredientes mientras se calienta el agua.'
      );
      await expect(optionPreview.locator('.generated-recipe__detail-level select')).toHaveValue(
        'expert'
      );
      expect(syntheticProvider.requests).toHaveLength(4);
      await recipeDialog.locator('.modal__body').evaluate((body) => {
        body.scrollTop = 0;
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await captureScreenshot(
        page,
        'generated-option-full-detail',
        viewport,
        test.info().project.name
      );
      await optionPreview.getByRole('button', { name: 'Volver a las opciones' }).click();
      await expect(generatedOptions).toHaveCount(3);
      await recipeDialog.getByRole('button', { name: 'Editar ingredientes' }).click();
      await expect(recipeDialog.locator('.ai-form')).toBeVisible();

      syntheticProvider.enqueue({ status: 503 });
      const failedRetry = page.waitForResponse(
        (response) =>
          response.url().includes('/api/ai/generate-multiple-recipes') &&
          response.request().method() === 'POST'
      );
      await generate.click();
      expect((await failedRetry).status()).toBe(500);
      await expect(page.locator('.toast--error')).toBeVisible();
      await expect(generatedOptions).toHaveCount(3);
      for (const [index, option] of [1, 2, 3].entries()) {
        await expect(generatedOptions.nth(index).getByRole('heading')).toHaveText(
          `Opción sintética ${option}`
        );
      }
      await dismissToasts(page);

      const dialog = page.getByRole('dialog');
      const dialogBounds = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      expect(dialogBounds.left).toBeGreaterThanOrEqual(0);
      expect(dialogBounds.right).toBeLessThanOrEqual(viewport.width);
      await generatedOptions.nth(0).scrollIntoViewIfNeeded();
      const firstOptionBounds = await generatedOptions.nth(0).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
      expect(firstOptionBounds.left).toBeGreaterThanOrEqual(0);
      expect(firstOptionBounds.right).toBeLessThanOrEqual(viewport.width);
      await captureScreenshot(page, 'recipes-ai-multiple', viewport, test.info().project.name);

      const draftResponse = await page.request.get('/api/recipes', {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(draftResponse.ok()).toBeTruthy();
      const draftPayload = (await draftResponse.json()) as {
        data: { recipes: { name: string }[] };
      };
      candidateNames.forEach((name, index) => {
        expect(
          draftPayload.data.recipes.filter((recipe) => recipe.name === name),
          `generar una candidata no debe persistir ${name}`
        ).toHaveLength(baselineCounts[index]);
      });

      const save = generatedOptions.nth(1).getByRole('button', { name: 'Guardar receta' });
      const saveResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/recipes') && response.request().method() === 'POST'
      );
      await save.focus();
      await expect(save).toBeFocused();
      await page.keyboard.press('Enter');
      expect((await saveResponse).status()).toBe(201);

      const recipesResponse = await page.request.get('/api/recipes', {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(recipesResponse.ok()).toBeTruthy();
      const recipesPayload = (await recipesResponse.json()) as {
        data: { recipes: { name: string }[] };
      };
      candidateNames.forEach((name, index) => {
        expect(
          recipesPayload.data.recipes.filter((recipe) => recipe.name === name),
          `solo guardar la candidata elegida debe añadir ${name}`
        ).toHaveLength(baselineCounts[index] + (name === 'Opción sintética 2' ? 1 : 0));
      });
      await expect(page.locator('.modal-overlay')).toHaveCount(0);
      await page.reload();
      const savedRecipeInLibrary = page
        .locator(
          '[data-test="recipe-featured"]:visible h2:visible, [data-test="recipe-card"]:visible .recipe-card__name:visible'
        )
        .filter({ hasText: 'Opción sintética 2' });
      await expect(savedRecipeInLibrary).toHaveCount(1);

      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(viewport.width);
      expect(pageErrors).toEqual([]);
    });
  }

  test('cancela las candidatas sin persistirlas, ni tras recargar (320×568)', async ({
    page,
    syntheticProvider
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
    const viewport = { width: 320, height: 568 };
    const candidateNames = [1, 2, 3].map((number) => `Opción sintética ${number}`);
    syntheticProvider.enqueue(
      { content: recipeOption(1) },
      { content: recipeOption(2) },
      { content: recipeOption(3) }
    );
    await openGenerator(page, viewport, syntheticProvider.baseUrl);

    const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
    expect(token, 'la verificación debe seguir usando la sesión sintética').toBeTruthy();
    const baselineResponse = await page.request.get('/api/recipes', {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(baselineResponse.ok()).toBeTruthy();
    const baselinePayload = (await baselineResponse.json()) as {
      data: { recipes: { name: string }[] };
    };
    const baselineCounts = candidateNames.map(
      (name) => baselinePayload.data.recipes.filter((recipe) => recipe.name === name).length
    );

    const generate = page.getByRole('button', { name: 'Generar 3 opciones' });
    const generationResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/ai/generate-multiple-recipes') &&
        response.request().method() === 'POST'
    );
    await generate.click();
    expect((await generationResponse).status()).toBe(200);
    await expect(
      page.getByRole('region', { name: 'Elige una receta para guardar' }).getByRole('article')
    ).toHaveCount(3);
    expect(syntheticProvider.requests).toHaveLength(3);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const afterCancelResponse = await page.request.get('/api/recipes', {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(afterCancelResponse.ok()).toBeTruthy();
    const afterCancelPayload = (await afterCancelResponse.json()) as {
      data: { recipes: { name: string }[] };
    };
    candidateNames.forEach((name, index) => {
      expect(
        afterCancelPayload.data.recipes.filter((recipe) => recipe.name === name),
        `cancelar debe descartar ${name}`
      ).toHaveLength(baselineCounts[index]);
    });

    await page.reload();
    const afterReloadResponse = await page.request.get('/api/recipes', {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(afterReloadResponse.ok()).toBeTruthy();
    const afterReloadPayload = (await afterReloadResponse.json()) as {
      data: { recipes: { name: string }[] };
    };
    candidateNames.forEach((name, index) => {
      expect(afterReloadPayload.data.recipes.filter((recipe) => recipe.name === name)).toHaveLength(
        baselineCounts[index]
      );
    });
    expect(pageErrors).toEqual([]);
  });
});
