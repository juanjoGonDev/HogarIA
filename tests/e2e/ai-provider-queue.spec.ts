import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';

type QueueJob = {
  id: string;
  status: 'queued' | 'running' | 'failed';
  queueOrder: number;
  retryable: boolean;
};

type ProviderBehavior = 'hold' | 'fail' | 'success';

const syntheticRecipe = {
  name: 'Receta sintética de zanahoria',
  description: 'Borrador sintético para validar la cola.',
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
      unit: 'unit',
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

class LocalAiProvider {
  private server?: Server;
  private behaviors: ProviderBehavior[] = [];
  private held: ServerResponse[] = [];
  requestCount = 0;
  abortCount = 0;
  baseUrl = '';

  async start(): Promise<void> {
    this.server = createServer(async (request, response) => {
      for await (const _chunk of request) {
        // Consume the synthetic OpenAI request body; never inspect or persist it.
      }
      this.requestCount += 1;
      const behavior = this.behaviors.shift() ?? 'success';
      response.once('close', () => {
        if (!response.writableEnded) this.abortCount += 1;
      });

      if (behavior === 'hold') {
        this.held.push(response);
        return;
      }
      if (behavior === 'fail') {
        response.writeHead(503, { 'content-type': 'text/plain' }).end('synthetic provider failure');
        return;
      }
      this.sendSuccess(response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', resolve);
    });
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1`;
  }

  setNextBehaviors(...behaviors: ProviderBehavior[]): void {
    this.behaviors.push(...behaviors);
  }

  async close(): Promise<void> {
    for (const response of this.held.splice(0)) {
      if (!response.writableEnded && !response.destroyed) this.sendSuccess(response);
    }
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  private sendSuccess(response: ServerResponse): void {
    if (response.writableEnded || response.destroyed) return;
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(syntheticRecipe) } }]
      })
    );
  }
}

type ApiReply = { status: number; body: any };

async function createConfig(
  page: Page,
  provider: LocalAiProvider,
  concurrency: number,
  name = `Synthetic queue ${concurrency}`
) {
  const reply = await page.evaluate(
    async ({ baseUrl, concurrency, name }) => {
      const token = localStorage.getItem('hogar:v1:auth_token');
      const response = await fetch('/api/ai/configs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name,
          provider: 'custom',
          baseUrl,
          apiKey: 'synthetic-key-not-for-display',
          model: 'synthetic-model',
          concurrency,
          retryAttempts: 0,
          timeout: 15000
        })
      });
      return { status: response.status, body: await response.json() };
    },
    { baseUrl: provider.baseUrl, concurrency, name }
  );
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  return String(reply.body.data.id);
}

async function assignRecipeProvider(page: Page, configId: string): Promise<void> {
  const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
  const response = await page
    .context()
    .request.put(new URL('/api/ai/function-providers/recipes', page.url()).toString(), {
      headers: { authorization: `Bearer ${token}` },
      data: { configId }
    });
  expect(response.status()).toBe(200);
}

async function startQueuedRecipeGeneration(page: Page): Promise<{ result: Promise<ApiReply> }> {
  const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
  const result = page
    .context()
    .request.post(new URL('/api/ai/generate-recipe', page.url()).toString(), {
      headers: { authorization: `Bearer ${token}` },
      data: {
        ingredients: [
          { id: 'synthetic-carrot', name: 'Zanahoria sintética', quantity: 1, unit: 'unit' }
        ],
        utensils: [],
        servings: 1,
        difficulty: 'easy',
        detailLevel: 'intermediate'
      }
    })
    .then(async (response) => ({ status: response.status(), body: await response.json() }));
  return { result };
}

async function queueJobs(page: Page, configId: string): Promise<QueueJob[]> {
  return page.evaluate(async (id) => {
    const token = localStorage.getItem('hogar:v1:auth_token');
    const response = await fetch(`/api/ai/configs/${encodeURIComponent(id)}/queue`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Queue API failed: ${response.status}`);
    return body.data.jobs;
  }, configId);
}

async function waitForProviderRequest(provider: LocalAiProvider, count: number): Promise<void> {
  await expect.poll(() => provider.requestCount, { timeout: 10000 }).toBeGreaterThanOrEqual(count);
}

async function captureQueueUi(
  page: Page,
  view: 'providers' | 'manager',
  width: number
): Promise<void> {
  const directory = process.env.E2E_SCREENSHOT_DIR ?? process.env.E2E_OUTPUT_DIR ?? 'test-results';
  const tag = (process.env.E2E_SEED ?? Date.now().toString()).replace(/[^a-zA-Z0-9_-]/g, '_');
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: join(
      directory,
      `ai-provider-queue-${tag}-${view}-${width < 1024 ? 'mobile' : 'desktop'}.png`
    )
  });
}

test.describe('gestor de cola de IA por proveedor', () => {
  test.use({ serviceWorkers: 'block' });
  let provider: LocalAiProvider;

  test.beforeEach(async ({ page }) => {
    provider = new LocalAiProvider();
    await provider.start();
    await registerAndGoto(page, '/ai-config', 'ai-provider-queue');
    await expect(page.locator('h1.ai-config__title')).toBeVisible();
  });

  test.afterEach(async () => {
    await provider?.close();
  });

  test('muestra límites, reordena con ratón/teclado y cancela generaciones en mobile y desktop', async ({
    page
  }) => {
    await createConfig(page, provider, 2, 'Synthetic queue 2');
    await createConfig(page, provider, 3, 'Synthetic queue 3');
    const configId = await createConfig(page, provider, 1);
    await assignRecipeProvider(page, configId);
    await page.reload();
    await expect(page.locator('.config-card')).toHaveCount(3);
    await expect(page.locator('[data-test="ai-provider-queue"]')).toHaveCount(0);
    await expect(page.locator('[data-test="ai-queue-link"]')).toHaveCount(3);
    for (const width of [393, 1440]) {
      await page.setViewportSize({ width, height: width === 393 ? 851 : 900 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      if (width === 393) {
        const sidebar = page.locator('.sidebar');
        if (await sidebar.evaluate((element) => element.classList.contains('sidebar--open'))) {
          await page.locator('.sidebar__close').click();
        }
        await expect(sidebar).not.toHaveClass(/sidebar--open/);
        await expect(page.locator('.sidebar-overlay')).toBeHidden();
        await expect
          .poll(() =>
            sidebar.evaluate((element) => Math.round(element.getBoundingClientRect().right))
          )
          .toBeLessThanOrEqual(0);
      }
      await captureQueueUi(page, 'providers', width);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const providerCard = page.locator('.config-card').filter({ hasText: 'Synthetic queue 1' });
    await providerCard.getByRole('link', { name: 'Gestionar cola' }).click();
    await expect(page).toHaveURL(new RegExp(`/ai-config/${configId}/queue$`));
    const manager = page.locator('[data-test="ai-provider-queue"]');
    await expect(manager).toBeVisible();

    provider.setNextBehaviors('hold', 'success');
    const calls = [
      await startQueuedRecipeGeneration(page),
      await startQueuedRecipeGeneration(page),
      await startQueuedRecipeGeneration(page)
    ];
    await waitForProviderRequest(provider, 1);
    await expect(page.locator('[data-test="ai-queue-job-running"]')).toHaveCount(1);
    await expect(page.locator('[data-test="ai-queue-job-queued"]')).toHaveCount(2);
    const initial = await queueJobs(page, configId);
    const initialOrder = initial
      .filter((job) => job.status === 'queued')
      .sort((a, b) => a.queueOrder - b.queueOrder)
      .map((job) => job.id);
    expect(initialOrder).toHaveLength(2);

    for (const size of [
      { width: 320, height: 568 },
      { width: 393, height: 851 },
      { width: 568, height: 320 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(size.width);
      if (size.width < 1024) {
        const sidebar = page.locator('.sidebar');
        if (await sidebar.evaluate((element) => element.classList.contains('sidebar--open'))) {
          await page.locator('.sidebar__close').click();
        }
        await expect(sidebar).not.toHaveClass(/sidebar--open/);
        await expect(page.locator('.sidebar-overlay')).toBeHidden();
        await expect
          .poll(() =>
            sidebar.evaluate((element) => Math.round(element.getBoundingClientRect().right))
          )
          .toBeLessThanOrEqual(0);
        await page.evaluate(() => window.scrollTo({ left: 0, top: window.scrollY }));
        expect(await page.evaluate(() => window.scrollX)).toBe(0);
      } else {
        await expect
          .poll(() =>
            page
              .locator('.sidebar')
              .evaluate((element) => Math.round(element.getBoundingClientRect().left))
          )
          .toBe(0);
      }
      await expect(manager).toBeVisible();
      await expect(manager.locator('[role="status"][aria-live="polite"]')).toHaveCount(1);
      const managerBounds = await manager.boundingBox();
      expect(managerBounds).not.toBeNull();
      expect(managerBounds!.x).toBeGreaterThanOrEqual(0);
      expect(managerBounds!.x + managerBounds!.width).toBeLessThanOrEqual(size.width);
      const touchTargets = await manager
        .locator('.ai-queue__action-button')
        .evaluateAll((buttons) =>
          buttons.map((button) => {
            const rect = button.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          })
        );
      expect(touchTargets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true);
      const actionHeights = touchTargets.map((target) => target.height);
      expect(Math.max(...actionHeights) - Math.min(...actionHeights)).toBeLessThanOrEqual(1);
      if (size.width === 1440 || size.width === 393) {
        await manager.scrollIntoViewIfNeeded();
        if (size.width === 393) {
          await page.evaluate(() => window.scrollTo({ left: 0, top: window.scrollY }));
          expect(await page.evaluate(() => window.scrollX)).toBe(0);
        }
        await captureQueueUi(page, 'manager', size.width);
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const [firstId, secondId] = initialOrder;
    const firstRow = page.locator(`.ai-queue__job[data-job-id="${firstId}"]`);
    const secondRow = page.locator(`.ai-queue__job[data-job-id="${secondId}"]`);
    await firstRow.locator('.ai-queue__drag-handle').dragTo(secondRow, {
      targetPosition: { x: 8, y: 8 }
    });
    await expect
      .poll(async () =>
        (await queueJobs(page, configId))
          .filter((job) => job.status === 'queued')
          .sort((a, b) => a.queueOrder - b.queueOrder)
          .map((job) => job.id)
      )
      .toEqual([secondId, firstId]);

    const rowMovedToSecond = page.locator(`.ai-queue__job[data-job-id="${firstId}"]`);
    const moveUp = rowMovedToSecond.locator('button[data-action="move-up"]');
    await moveUp.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(async () =>
        (await queueJobs(page, configId))
          .filter((job) => job.status === 'queued')
          .sort((a, b) => a.queueOrder - b.queueOrder)
          .map((job) => job.id)
      )
      .toEqual(initialOrder);
    await expect(page.locator(':focus')).toHaveAttribute('data-job-id', firstId);

    const queuedToCancel = page.locator(`.ai-queue__job[data-job-id="${secondId}"]`);
    await queuedToCancel.getByRole('button', { name: /Cancelar/ }).click();
    await expect(page.locator('[data-test="ai-queue-job-queued"]')).toHaveCount(1);

    const runningId = (await queueJobs(page, configId)).find((job) => job.status === 'running')?.id;
    expect(runningId).toBeTruthy();
    const runningRow = page.locator(`.ai-queue__job[data-job-id="${runningId}"]`);
    await runningRow.getByRole('button', { name: /Cancelar/ }).click();
    await expect.poll(() => provider.abortCount, { timeout: 10000 }).toBeGreaterThan(0);
    await expect(page.locator('[data-test="ai-queue-job-queued"]')).toHaveCount(0);
    await expect(page.locator('[data-test="ai-queue-job-running"]')).toHaveCount(0);
    await waitForProviderRequest(provider, 2);
    expect((await queueJobs(page, configId)).some((job) => job.status === 'failed')).toBe(false);

    const replies = await Promise.all(calls.map(({ result }) => result));
    expect(replies[0].status).toBeGreaterThanOrEqual(400);
    expect(replies[1].status).toBe(200);
    expect(replies[2].status).toBeGreaterThanOrEqual(400);
  });

  test('copia solo el diagnóstico del job elegido y permite reintentar un fallo terminal', async ({
    page
  }, testInfo) => {
    const configId = await createConfig(page, provider, 1);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as Window & { __hogariaCopiedDiagnostic?: string }).__hogariaCopiedDiagnostic =
              text;
          }
        }
      });
    });
    await page.reload();
    const providerCard = page.locator('.config-card').filter({ hasText: 'Synthetic queue 1' });
    await providerCard.getByRole('link', { name: 'Gestionar cola' }).click();
    await expect(page).toHaveURL(new RegExp(`/ai-config/${configId}/queue$`));
    const manager = page.locator('[data-test="ai-provider-queue"]');
    await expect(manager).toBeVisible();
    await assignRecipeProvider(page, configId);
    provider.setNextBehaviors('fail', 'hold', 'success');

    const call = await startQueuedRecipeGeneration(page);
    await expect(page.locator('[data-test="ai-queue-job-failed"]')).toHaveCount(1);
    const otherCall = await startQueuedRecipeGeneration(page);
    await waitForProviderRequest(provider, 2);
    await expect(page.locator('[data-test="ai-queue-job-running"]')).toHaveCount(1);

    const jobsBeforeCopy = await queueJobs(page, configId);
    const failed = jobsBeforeCopy.find((job) => job.status === 'failed');
    const other = jobsBeforeCopy.find((job) => job.status === 'running');
    expect(failed?.retryable).toBe(true);
    expect(other).toBeTruthy();
    expect(JSON.stringify(await queueJobs(page, configId))).not.toContain(
      'synthetic-key-not-for-display'
    );
    expect(JSON.stringify(await queueJobs(page, configId))).not.toContain(
      'synthetic provider failure'
    );

    const failedRow = page.locator(`.ai-queue__job[data-job-id="${failed!.id}"]`);
    const copyButton = failedRow.getByRole('button', { name: /Copiar diagnóstico/ });
    const copyBounds = await copyButton.boundingBox();
    expect(copyBounds?.height).toBeGreaterThanOrEqual(44);
    await copyButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[role="status"][aria-live="polite"]')).toContainText(
      'Diagnóstico copiado.'
    );
    const copiedText = await page.evaluate(
      () => (window as Window & { __hogariaCopiedDiagnostic?: string }).__hogariaCopiedDiagnostic
    );
    expect(copiedText).toBeTruthy();
    const copied = JSON.parse(copiedText!) as Record<string, unknown>;
    expect(copied).toMatchObject({ jobId: failed!.id, kind: 'recipe', status: 'failed' });
    expect(copiedText).not.toContain(other!.id);
    expect(copiedText).not.toContain('synthetic-key-not-for-display');
    expect(copiedText).not.toContain(provider.baseUrl);
    expect(copiedText).not.toContain('synthetic provider failure');

    if (process.env.E2E_SCREENSHOT_DIR) {
      const width = testInfo.project.name === 'chromium' ? 1440 : 393;
      await page.setViewportSize({ width, height: width === 393 ? 851 : 900 });
      await captureQueueUi(page, 'manager', width);
    }

    await page
      .locator(`.ai-queue__job[data-job-id="${other!.id}"]`)
      .getByRole('button', { name: /Cancelar/ })
      .click();
    await expect.poll(() => provider.abortCount, { timeout: 10000 }).toBeGreaterThan(0);
    expect((await otherCall.result).status).toBeGreaterThanOrEqual(400);

    await failedRow.getByRole('button', { name: /Reintentar/ }).click();
    await expect(page.locator('[data-test="ai-queue-job-failed"]')).toHaveCount(0);
    const reply = await call.result;
    expect(reply.status).toBe(200);
    expect(reply.body.success).toBe(true);
    expect(provider.requestCount).toBe(3);
  });

  test('traduce formulario y gestor al inglés y oculta la cola en límite cero', async ({
    page
  }) => {
    const configId = await createConfig(page, provider, 1);
    await page.evaluate(() => localStorage.setItem('hogar:v1:language', 'en'));
    await page.reload();
    const providerCard = page.locator('.config-card').filter({ hasText: 'Synthetic queue 1' });
    await providerCard.getByRole('link', { name: 'Manage queue' }).click();
    await expect(page).toHaveURL(new RegExp(`/ai-config/${configId}/queue$`));
    const manager = page.locator('[data-test="ai-provider-queue"]');
    await expect(manager).toBeVisible();
    await expect(manager.getByRole('heading', { name: 'Queue manager' })).toBeVisible();

    await page.getByRole('link', { name: 'Back to providers' }).click();
    const configCard = page.locator('.config-card').filter({ hasText: 'Synthetic queue 1' });
    await configCard.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByLabel('Maximum concurrency')).toBeVisible();
    await expect(
      page.getByText('0 = unlimited; maximum 8. Applies to all AI requests.')
    ).toBeVisible();
    await page.keyboard.press('Escape');

    const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
    const update = await page.evaluate(
      async ({ id, token }) => {
        const response = await fetch(`/api/ai/configs/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ concurrency: 0 })
        });
        return { status: response.status, body: await response.json() };
      },
      { id: configId, token }
    );
    expect(update.status, JSON.stringify(update.body)).toBe(200);
    await page.reload();
    await expect(page.locator('[data-test="ai-queue-link"]')).toHaveCount(0);
    await expect(page.locator('[data-test="ai-provider-queue"]')).toHaveCount(0);
    await page.goto(`/ai-config/${configId}/queue`);
    await expect(page.locator('[data-test="ai-provider-queue"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to providers' })).toBeVisible();
  });
});
