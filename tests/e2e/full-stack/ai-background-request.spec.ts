import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '../fixtures';
import { registerWithHousehold } from '../helpers/auth';

const SYNTHETIC_API_KEY = 'synthetic-background-only';
const RESPONSE_ID = 'resp_synthetic_background_recipe';
const SCREENSHOT_DIR = resolve(
  process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/ai-background-request'
);

const syntheticRecipe = {
  name: 'Receta sintética pendiente',
  description: 'Borrador sintético para comprobar trabajo en segundo plano.',
  difficulty: 'easy',
  cuisine: null,
  totalTime: 15,
  prepTime: 5,
  cookTime: 10,
  restTime: null,
  baseServings: 1,
  calories: 180,
  ingredients: [
    {
      name: 'Zanahoria sintética',
      quantity: 1,
      unit: 'ud',
      preparation: null,
      isOptional: false,
      substitutes: [],
      notes: null
    }
  ],
  utensils: [],
  guidance: {
    appliances: [],
    parallelTasks: [],
    tipsAndVariations: [],
    batchCookingWarning: null
  },
  instructionsByLevel: Object.fromEntries(
    (['basic', 'intermediate', 'expert'] as const).map((level) => [
      level,
      [
        {
          stepNumber: 1,
          instruction: `Cocer la zanahoria (${level}).`,
          duration: 10,
          temperature: null,
          timerRequired: false,
          timerDuration: null,
          tips: null,
          warning: null,
          illustration: null
        }
      ]
    ])
  ),
  nutrition: { calories: 180, protein: 2, carbs: 20, fat: 5, fiber: null },
  storage: {
    method: 'Refrigerada',
    duration: '2 días',
    reheatingInstructions: null,
    container: null,
    freezingPossible: false,
    freezingDuration: null
  },
  tags: ['synthetic']
};

type ProviderState = 'in_progress' | 'completed' | 'cancelled';

/** Local-only Responses background provider; it never calls or stores external data. */
class LocalResponsesProvider {
  private server?: Server;
  private state: ProviderState = 'in_progress';
  baseUrl = '';
  createCount = 0;
  backgroundRequestCount = 0;
  storedRequestCount = 0;
  chatCompletionsCount = 0;
  cancelCount = 0;

  async start(): Promise<void> {
    this.server = createServer(async (request, response) => {
      let requestBody = '';
      for await (const chunk of request) requestBody += Buffer.from(chunk).toString('utf8');
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');

      if (request.method === 'POST' && url.pathname === '/v1/responses') {
        this.createCount += 1;
        const payload = JSON.parse(requestBody) as { background?: unknown; store?: unknown };
        if (payload.background === true) this.backgroundRequestCount += 1;
        if (payload.store === true) this.storedRequestCount += 1;
        response
          .writeHead(202, { 'content-type': 'application/json' })
          .end(JSON.stringify({ id: RESPONSE_ID, status: 'queued', output: [] }));
        return;
      }

      if (request.method === 'GET' && url.pathname === `/v1/responses/${RESPONSE_ID}`) {
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            id: RESPONSE_ID,
            status: this.state,
            output: this.state === 'completed' ? this.output() : []
          })
        );
        return;
      }

      if (request.method === 'POST' && url.pathname === `/v1/responses/${RESPONSE_ID}/cancel`) {
        this.cancelCount += 1;
        this.state = 'cancelled';
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
            JSON.stringify({ error: { message: 'Chat Completions is disabled in this fixture' } })
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

  complete(): void {
    this.state = 'completed';
  }

  async close(): Promise<void> {
    this.complete();
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
      server.closeAllConnections();
    });
  }

  private output(): Array<{
    type: 'message';
    content: Array<{ type: 'output_text'; text: string }>;
  }> {
    return [
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(syntheticRecipe) }]
      }
    ];
  }
}

async function createProvider(page: Page, provider: LocalResponsesProvider): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
  expect(token).toBeTruthy();
  const response = await page.request.post('/api/ai/configs', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: 'Proveedor de fondo sintético',
      provider: 'custom',
      baseUrl: provider.baseUrl,
      apiKey: SYNTHETIC_API_KEY,
      model: 'synthetic-model',
      concurrency: 1,
      retryAttempts: 0,
      timeout: 120_000
    }
  });
  expect(response.status()).toBe(201);
  const payload = (await response.json()) as { data: { id: string } };
  expect(JSON.stringify(payload)).not.toContain(SYNTHETIC_API_KEY);
  return payload.data.id;
}

async function assignRecipeProvider(page: Page, configId: string): Promise<void> {
  const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
  const response = await page.request.put('/api/ai/function-providers/recipes', {
    headers: { authorization: `Bearer ${token}` },
    data: { configId }
  });
  expect(response.status()).toBe(200);
}

type ActiveJob = {
  id: string;
  kind: string;
  status: 'queued' | 'running';
  createdAt: string;
  startedAt: string | null;
};

async function activeJobs(page: Page, token: string): Promise<ActiveJob[]> {
  const response = await page.request.get('/api/ai/queue/active', {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as { success: boolean; data: { jobs: ActiveJob[] } };
  expect(payload.success).toBe(true);
  return payload.data.jobs;
}

async function captureActiveIndicator(page: Page, project: string): Promise<void> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Playwright viewport is required for screenshot evidence.');
  await page.screenshot({
    path: join(SCREENSHOT_DIR, `${project}-${viewport.width}x${viewport.height}.png`),
    fullPage: false,
    animations: 'disabled'
  });
}

test.describe('solicitudes IA persistentes en segundo plano', () => {
  test.use({ serviceWorkers: 'block' });

  test('cierra la pestaña y recupera el estado activo sin abortar ni duplicar la solicitud', async ({
    page
  }, testInfo) => {
    const viewport =
      testInfo.project.name === 'chromium'
        ? { width: 1440, height: 900 }
        : { width: 393, height: 851 };
    await page.setViewportSize(viewport);

    const provider = new LocalResponsesProvider();
    await provider.start();
    const context = page.context();

    try {
      await registerWithHousehold(page, '/ai-config', 'Trabajo IA de fondo sintético');
      const configId = await createProvider(page, provider);
      await assignRecipeProvider(page, configId);
      await page.goto('/recipes');
      await expect(page.locator('h1.recipes__title')).toBeVisible();

      const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
      expect(token).toBeTruthy();

      // A real browser-owned request: closing this page aborts the client socket, not the server job.
      await page.evaluate((authToken) => {
        const request = fetch('/api/ai/generate-recipe', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            ingredients: [
              {
                id: 'synthetic-carrot',
                name: 'Zanahoria sintética',
                quantity: 1,
                unit: 'ud'
              }
            ],
            utensils: [],
            servings: 1,
            difficulty: 'easy',
            detailLevel: 'intermediate'
          })
        });
        (window as Window & { __syntheticAiRequest?: Promise<unknown> }).__syntheticAiRequest =
          request.then((response) => response.json()).catch(() => undefined);
      }, token);

      await expect.poll(() => provider.createCount, { timeout: 15_000 }).toBe(1);
      expect(provider.backgroundRequestCount).toBe(1);
      expect(provider.storedRequestCount).toBe(1);
      expect(provider.chatCompletionsCount).toBe(0);

      const beforeClose = await activeJobs(page, token!);
      const activeJob = beforeClose.find((job) => job.kind === 'recipe');
      expect(activeJob).toBeTruthy();
      expect(['queued', 'running']).toContain(activeJob!.status);

      await page.close();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500));
      expect(provider.cancelCount).toBe(0);
      expect(provider.createCount).toBe(1);

      const reopened = await context.newPage();
      await reopened.setViewportSize(viewport);
      await reopened.goto('/dashboard');
      await expect(reopened.locator('.dashboard__title')).toBeVisible();

      const indicator = reopened.locator('[data-test="ai-active-jobs-indicator"]:visible').first();
      await expect(indicator).toBeVisible({ timeout: 10_000 });
      await expect(indicator).toContainText('1');
      expect(
        await reopened.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `no horizontal overflow at ${viewport.width}px`
      ).toBe(true);
      const indicatorTargets = await reopened
        .locator('[data-test="ai-active-jobs-indicator"]:visible')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const bounds = element.getBoundingClientRect();
            return { width: bounds.width, height: bounds.height };
          })
        );
      expect(indicatorTargets.length).toBeGreaterThan(0);
      expect(
        indicatorTargets.every((bounds) => bounds.width >= 44 && bounds.height >= 44),
        'the visible activity indicator has a touch target of at least 44×44 CSS px'
      ).toBe(true);
      expect(
        Math.max(...indicatorTargets.map((bounds) => bounds.width)) -
          Math.min(...indicatorTargets.map((bounds) => bounds.width))
      ).toBeLessThanOrEqual(1);
      expect(
        Math.max(...indicatorTargets.map((bounds) => bounds.height)) -
          Math.min(...indicatorTargets.map((bounds) => bounds.height))
      ).toBeLessThanOrEqual(1);
      await expect
        .poll(async () =>
          (await activeJobs(reopened, token!)).some((job) => job.id === activeJob!.id)
        )
        .toBe(true);
      await captureActiveIndicator(reopened, testInfo.project.name);

      provider.complete();
      await expect
        .poll(
          async () => (await activeJobs(reopened, token!)).some((job) => job.id === activeJob!.id),
          {
            timeout: 15_000
          }
        )
        .toBe(false);
      await expect(indicator).toHaveCount(0, { timeout: 10_000 });
      expect(provider.createCount).toBe(1);
      expect(provider.cancelCount).toBe(0);
      expect(provider.chatCompletionsCount).toBe(0);
    } finally {
      provider.complete();
      if (context.pages().some((candidate) => !candidate.isClosed())) {
        for (const candidate of context.pages()) {
          if (!candidate.isClosed()) await candidate.close();
        }
      }
      await provider.close();
    }
  });
});
