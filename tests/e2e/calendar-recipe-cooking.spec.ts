import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { registerWithHousehold } from './helpers/auth';
import { aiRecipeOutputSchema } from '../../server/src/schemas/recipe-ai-output.schema.js';

const TOKEN_KEY = 'hogar:v1:auth_token';
const API_KEY = 'synthetic-calendar-recipe-only';
const RECIPE_NAME = 'Receta sintética desde calendario';
const MEAL_NAME = 'Guiso sintético de calendario';
const RESPONSE_ID = 'resp_synthetic_calendar_recipe';
const SCREENSHOT_DIR = resolve('.e2e-screenshots/calendar-recipe-cooking');

test.use({ serviceWorkers: 'block' });

// Deliberately complete canonical AI recipe shape: the backend validates this response with
// aiRecipeOutputSchema before it can persist a recipe or open the cooking flow.
const recipeFixture = {
  name: RECIPE_NAME,
  description: 'Receta sintética para verificar el flujo desde una comida del calendario.',
  difficulty: 'easy',
  cuisine: null,
  totalTime: 20,
  prepTime: 10,
  cookTime: 10,
  restTime: null,
  baseServings: 1,
  calories: 320,
  ingredients: [
    {
      name: 'Lentejas sintéticas',
      quantity: 120,
      unit: 'g',
      preparation: null,
      isOptional: false,
      substitutes: [],
      notes: null
    }
  ],
  utensils: ['Olla'],
  guidance: {
    appliances: [],
    parallelTasks: [],
    tipsAndVariations: ['Remueve suavemente.'],
    batchCookingWarning: null
  },
  instructionsByLevel: {
    basic: [
      {
        stepNumber: 1,
        instruction: 'Enjuaga las lentejas sintéticas.',
        duration: 2,
        temperature: null,
        timerRequired: false,
        timerDuration: null,
        tips: null,
        warning: null,
        illustration: null
      },
      {
        stepNumber: 2,
        instruction: 'Cuece las lentejas en la olla.',
        duration: 10,
        temperature: null,
        timerRequired: false,
        timerDuration: null,
        tips: null,
        warning: null,
        illustration: null
      }
    ],
    intermediate: [
      {
        stepNumber: 1,
        instruction: 'Enjuaga las lentejas sintéticas.',
        duration: 2,
        temperature: null,
        timerRequired: false,
        timerDuration: null,
        tips: null,
        warning: null,
        illustration: null
      },
      {
        stepNumber: 2,
        instruction: 'Cuece las lentejas en la olla.',
        duration: 10,
        temperature: null,
        timerRequired: false,
        timerDuration: null,
        tips: null,
        warning: null,
        illustration: null
      }
    ],
    expert: [
      {
        stepNumber: 1,
        instruction: 'Enjuaga las lentejas sintéticas.',
        duration: 2,
        temperature: null,
        timerRequired: false,
        timerDuration: null,
        tips: null,
        warning: null,
        illustration: null
      },
      {
        stepNumber: 2,
        instruction: 'Cuece las lentejas en la olla.',
        duration: 10,
        temperature: null,
        timerRequired: false,
        timerDuration: null,
        tips: null,
        warning: null,
        illustration: null
      }
    ]
  },
  nutrition: { calories: 320, protein: 18, carbs: 48, fat: 3, fiber: 12 },
  storage: {
    method: 'Refrigerar',
    duration: '2 días',
    reheatingInstructions: null,
    container: null,
    freezingPossible: false,
    freezingDuration: null
  },
  tags: ['sintética', 'e2e']
} as const;

type ResponsesCreateBody = {
  background?: unknown;
  store?: unknown;
  input?: unknown;
  model?: unknown;
};

/** Local OpenAI-compatible WebApi stub; only the provider boundary is stubbed, never HogarIA routes. */
class LocalWebApiProvider {
  private server?: Server;
  baseUrl = '';
  createCount = 0;
  chatCompletionsCount = 0;
  cancelCount = 0;
  readonly requests: ResponsesCreateBody[] = [];

  async start(): Promise<void> {
    this.server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (request.method === 'POST' && url.pathname === '/v1/responses') {
        this.createCount += 1;
        this.requests.push(JSON.parse(body) as ResponsesCreateBody);
        response
          .writeHead(202, { 'content-type': 'application/json' })
          .end(JSON.stringify({ id: RESPONSE_ID, status: 'queued', output: [] }));
        return;
      }

      if (request.method === 'GET' && url.pathname === `/v1/responses/${RESPONSE_ID}`) {
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            id: RESPONSE_ID,
            status: 'completed',
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: JSON.stringify(recipeFixture) }]
              }
            ]
          })
        );
        return;
      }

      if (request.method === 'POST' && url.pathname === `/v1/responses/${RESPONSE_ID}/cancel`) {
        this.cancelCount += 1;
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ id: RESPONSE_ID, status: 'cancelled' }));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
        this.chatCompletionsCount += 1;
        response
          .writeHead(410, { 'content-type': 'application/json' })
          .end(
            JSON.stringify({ error: { message: 'This synthetic fixture requires Responses.' } })
          );
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' }).end('{}');
    });

    await new Promise<void>((resolveListen, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', resolveListen);
    });
    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}/v1`;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
      server.closeAllConnections();
    });
  }
}

async function authToken(page: Page): Promise<string> {
  const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'sesión sintética E2E').toBeTruthy();
  return token!;
}

async function createAndAssignRecipeProvider(
  page: Page,
  token: string,
  provider: LocalWebApiProvider
): Promise<string> {
  const response = await page.request.post('/api/ai/configs', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: 'WebApi sintética para comida de calendario',
      provider: 'custom',
      baseUrl: provider.baseUrl,
      apiKey: API_KEY,
      model: 'synthetic-recipe-model',
      temperature: 0,
      maxTokens: 2048,
      timeout: 120_000,
      retryAttempts: 0,
      concurrency: 1
    }
  });
  expect(response.status(), 'crear config de proveedor sintético').toBe(201);
  const payload = (await response.json()) as { data?: { id?: string } };
  expect(payload.data?.id).toBeTruthy();
  expect(JSON.stringify(payload)).not.toContain(API_KEY);
  const configId = payload.data!.id!;

  const assigned = await page.request.put('/api/ai/function-providers/planning', {
    headers: { authorization: `Bearer ${token}` },
    data: { configId }
  });
  expect(assigned.status(), 'asignar proveedor a recetas').toBe(200);
  return configId;
}

async function captureCookingScreenshot(page: Page, testInfo: import('@playwright/test').TestInfo) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(SCREENSHOT_DIR, `${testInfo.project.name}-cooking-step-1.png`),
    fullPage: false,
    animations: 'disabled'
  });
}

test('Cocinar una comida libre del calendario genera y guarda receta en modo cocina', async ({
  page
}, testInfo) => {
  test.setTimeout(120_000);

  const viewport =
    testInfo.project.name === 'mobile-chrome'
      ? { width: 393, height: 851 }
      : { width: 1440, height: 900 };
  await page.setViewportSize(viewport);

  // Fail early if the fixture drifts from the exact model-facing output contract.
  expect(aiRecipeOutputSchema.safeParse(recipeFixture).success).toBe(true);

  const provider = new LocalWebApiProvider();
  await provider.start();
  let token: string | null = null;
  let configId: string | null = null;
  let mealId: string | null = null;
  let recipeId: string | null = null;

  try {
    await registerWithHousehold(page, '/calendar', 'Cocinar comida de calendario E2E');
    token = await authToken(page);
    configId = await createAndAssignRecipeProvider(page, token, provider);

    const date = new Date();
    const mealDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const createdMeal = await page.request.post('/api/calendar/meals', {
      headers: { authorization: `Bearer ${token}` },
      data: {
        date: mealDate,
        mealType: 'dinner',
        customMeal: MEAL_NAME,
        servings: 1,
        notes: 'Fixture sintética de E2E.'
      }
    });
    const createdMealBody = (await createdMeal.json()) as {
      success: boolean;
      data?: { id?: string };
    };
    expect(createdMeal.status(), JSON.stringify(createdMealBody)).toBe(201);
    expect(createdMealBody.success).toBe(true);
    expect(createdMealBody.data?.id).toBeTruthy();
    mealId = createdMealBody.data!.id!;

    await page.goto('/calendar');
    const mealAction = page.getByRole('button', { name: new RegExp(`Cocinar.*${MEAL_NAME}`) });
    await expect(mealAction).toBeVisible();

    const productionResponsePromise = page.waitForResponse((response) => {
      const request = response.request();
      return (
        request.method() === 'POST' &&
        new URL(response.url()).pathname === `/api/ai/calendar-meals/${mealId}/recipe`
      );
    });
    await mealAction.focus();
    await expect(mealAction).toBeFocused();
    await page.keyboard.press('Enter');
    const productionResponse = await productionResponsePromise;
    expect(productionResponse.request().postData(), 'el endpoint se invoca sin body').toBeNull();
    const generation = (await productionResponse.json()) as {
      success: boolean;
      data?: { recipeId?: string };
    };
    expect(productionResponse.ok(), JSON.stringify(generation)).toBe(true);
    expect(generation).toMatchObject({ success: true, data: { recipeId: expect.any(String) } });
    recipeId = generation.data!.recipeId!;

    await expect.poll(() => provider.createCount, { timeout: 15_000 }).toBe(1);
    expect(provider.chatCompletionsCount).toBe(0);
    expect(provider.cancelCount).toBe(0);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({ background: true, store: true });
    expect(JSON.stringify(provider.requests[0])).toContain(MEAL_NAME);

    const calendarRange = await page.request.get(
      `/api/calendar/range?startDate=${mealDate}&endDate=${mealDate}`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    expect(calendarRange.ok()).toBe(true);
    const persistedCalendar = (await calendarRange.json()) as {
      data: { meals: Array<{ id: string; recipe_id: string | null }> };
    };
    expect(persistedCalendar.data.meals.find((meal) => meal.id === mealId)?.recipe_id).toBe(
      recipeId
    );

    const cookingView = page.locator('[data-test="recipe-cooking-view"]');
    await expect(cookingView).toBeVisible();
    await expect(cookingView.getByRole('heading', { level: 1 })).toHaveText(RECIPE_NAME);
    await expect(cookingView.locator('[data-test="recipe-cooking-step"]:visible')).toHaveCount(1);
    await expect(cookingView.locator('.recipe-cooking__instruction').first()).toContainText(
      'Enjuaga las lentejas sintéticas.'
    );
    await expect(page).toHaveURL(new RegExp(`/recipes\\?[^#]*recipe=${recipeId}[^#]*mode=cooking`));
    await captureCookingScreenshot(page, testInfo);

    // A reload must reconstruct the selected recipe and cooking intent from the persisted URL.
    await page.reload();
    await expect(cookingView).toBeVisible();
    await expect(cookingView.getByRole('heading', { level: 1 })).toHaveText(RECIPE_NAME);
    await expect(cookingView.locator('.recipe-cooking__instruction').first()).toContainText(
      'Enjuaga las lentejas sintéticas.'
    );
    await expect(page).toHaveURL(new RegExp(`/recipes\\?[^#]*recipe=${recipeId}[^#]*mode=cooking`));
    expect(provider.createCount, 'recargar no debe duplicar la llamada al proveedor').toBe(1);
  } finally {
    if (token) {
      // Delete only records/config created by this isolated scenario; an isolated run has its own DB.
      if (mealId) {
        await page.request
          .delete(`/api/calendar/meals/${mealId}`, {
            headers: { authorization: `Bearer ${token}` }
          })
          .catch(() => undefined);
      }
      if (recipeId) {
        await page.request
          .delete(`/api/recipes/${recipeId}`, {
            headers: { authorization: `Bearer ${token}` }
          })
          .catch(() => undefined);
      }
      if (configId) {
        await page.request
          .delete(`/api/ai/configs/${configId}`, {
            headers: { authorization: `Bearer ${token}` }
          })
          .catch(() => undefined);
      }
    }
    await provider.close();
  }
});
