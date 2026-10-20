import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test } from '../fixtures';
import { registerWithHousehold } from '../helpers/auth';

const SYNTHETIC_KEY = 'synthetic-e2e-only';
const SYNTHETIC_BASE_URL = 'http://127.0.0.1:9/v1';
const SCREENSHOT_DIR = resolve(
  process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/ai-provider-settings'
);

async function capture(
  page: Parameters<typeof registerWithHousehold>[0],
  name: string,
  fullPage = true
) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: join(SCREENSHOT_DIR, `${test.info().project.name}-${name}.png`),
    fullPage,
    animations: 'disabled'
  });
}

async function captureElement(
  page: Parameters<typeof registerWithHousehold>[0],
  selector: string,
  name: string
): Promise<void> {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.locator(selector).screenshot({
    path: join(SCREENSHOT_DIR, `${test.info().project.name}-${name}.png`),
    animations: 'disabled'
  });
}

async function createSyntheticProvider(
  page: Parameters<typeof registerWithHousehold>[0],
  name: string,
  baseUrl = SYNTHETIC_BASE_URL
): Promise<string> {
  await page
    .getByRole('button', { name: /Agregar configuración/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Nueva Configuración' });
  await expect(dialog).toBeVisible();
  await page.locator('input#name').fill(name);
  await page.locator('select#provider').selectOption('custom');
  await page.locator('input#model').fill('synthetic-model');
  await page.locator('input#baseUrl').fill(baseUrl);
  await page.locator('input#apiKey').fill(SYNTHETIC_KEY);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/ai/configs') && response.request().method() === 'POST'
  );
  await dialog.locator('button[type="submit"]').click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const payload = (await response.json()) as { data: { id: string } };
  expect(JSON.stringify(payload)).not.toContain(SYNTHETIC_KEY);
  await expect(dialog).toHaveCount(0);
  return payload.data.id;
}

async function dismissToasts(page: Parameters<typeof registerWithHousehold>[0]): Promise<void> {
  const closeButtons = page.locator('.toast__close');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const count = await closeButtons.count();
    if (count === 0) return;
    await closeButtons.first().click();
  }
}

test.describe('AI provider settings in household', () => {
  test('assigns functions to active providers and falls back after a confirmed deactivation', async ({
    page
  }) => {
    const viewport =
      test.info().project.name === 'chromium'
        ? { width: 1440, height: 900 }
        : { width: 393, height: 851 };
    await page.setViewportSize(viewport);
    await registerWithHousehold(page, '/household?tab=settings', 'Proveedor IA hogar sintético');

    const embedded = page.locator('[data-test="household-ai-config"]');
    await expect(embedded).toBeVisible();
    await expect(
      embedded.getByRole('heading', { name: 'Configuración IA', level: 2 })
    ).toBeVisible();
    await expect(embedded.locator('h1.ai-config__title')).toHaveCount(0);
    await expect(page.locator('.sidebar__nav a[href="/ai-config"]')).toHaveCount(0);
    await expect(embedded.locator('.function-provider-row')).toHaveCount(0);

    const oldestId = await createSyntheticProvider(page, 'Proveedor sintético antiguo');
    await expect(embedded.locator('.config-card')).toHaveCount(1);
    await expect(embedded.locator('.function-provider-row')).toHaveCount(5);
    const assistantRow = embedded
      .locator('.function-provider-row')
      .filter({ hasText: 'Asistente' });
    await expect(assistantRow).toContainText('Proveedor sintético antiguo');
    await expect(assistantRow.locator('select')).toHaveCount(0);

    // SQLite stores timestamps at second precision; separating creation times makes the
    // fallback assertion deterministic without relying on random provider IDs.
    await page.waitForTimeout(1100);
    const newerId = await createSyntheticProvider(page, 'Proveedor sintético reciente');
    const oldCard = embedded
      .locator('.config-card')
      .filter({ hasText: 'Proveedor sintético antiguo' });
    const newCard = embedded
      .locator('.config-card')
      .filter({ hasText: 'Proveedor sintético reciente' });
    await expect(oldCard.locator('app-badge').first()).toContainText('Activo');
    await expect(newCard.locator('app-badge').first()).toContainText('Activo');

    const assistantProvider = embedded.locator('[data-test="ai-function-provider-assistant"]');
    await expect(assistantProvider).toBeVisible();
    const assignmentSaved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/ai/function-providers/assistant') &&
        response.request().method() === 'PUT'
    );
    await assistantProvider.selectOption({ label: 'Proveedor sintético reciente' });
    const assignmentResponse = await assignmentSaved;
    expect(assignmentResponse.status()).toBe(200);
    expect((await assignmentResponse.json()).data.configId).toBe(newerId);
    await dismissToasts(page);
    await captureElement(
      page,
      '[data-test="household-ai-config"] .function-provider-settings',
      'multiple-active-providers'
    );

    await newCard.getByRole('button', { name: /Desactivar/ }).click();
    const confirmation = page.locator('app-confirm-dialog [role="dialog"]');
    await expect(confirmation).toContainText('Asistente');
    await expect(confirmation).toContainText('proveedor activo más antiguo');
    const deactivationResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/ai/configs/${newerId}`) &&
        response.request().method() === 'PATCH'
    );
    const assignmentsRefreshed = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/ai/function-providers') &&
        response.request().method() === 'GET'
    );
    await confirmation.getByRole('button', { name: 'Desactivar' }).click();
    expect((await deactivationResponse).status()).toBe(200);
    const assignmentsResponse = await assignmentsRefreshed;
    const assignments = (await assignmentsResponse.json()).data as {
      functionKey: string;
      configId: string;
    }[];
    expect(assignments.find((assignment) => assignment.functionKey === 'assistant')?.configId).toBe(
      oldestId
    );
    await expect(newCard.locator('app-badge').first()).toContainText('Inactivo');
    await expect(assistantRow).toContainText('Proveedor sintético antiguo');
  });

  test('keeps a saved connection test locked after reload without starting a duplicate', async ({
    page
  }) => {
    await registerWithHousehold(page, '/household?tab=settings', 'Test persistente sintético');

    let resolveProviderRequest!: () => void;
    let markProviderRequestStarted!: () => void;
    const providerRequestStarted = new Promise<void>((resolveStarted) => {
      markProviderRequestStarted = resolveStarted;
    });
    const providerRequestReleased = new Promise<void>((resolveReleased) => {
      resolveProviderRequest = resolveReleased;
    });
    let providerRequestCount = 0;
    const provider = createServer((request, response) => {
      void (async () => {
        for await (const _chunk of request) {
          // Consume the synthetic OpenAI-compatible request body without persisting it.
        }
        providerRequestCount += 1;
        markProviderRequestStarted();
        await providerRequestReleased;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            choices: [{ message: { content: '{"status":"ok","message":"conexión establecida"}' } }]
          })
        );
      })().catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });

    await new Promise<void>((resolveListen, rejectListen) => {
      provider.once('error', rejectListen);
      provider.listen(0, '127.0.0.1', resolveListen);
    });
    const providerAddress = provider.address() as AddressInfo;
    const configName = 'Proveedor prueba persistente';
    let postCount = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/ai/test-connection')) {
        postCount += 1;
      }
    });

    try {
      const configId = await createSyntheticProvider(
        page,
        configName,
        `http://127.0.0.1:${providerAddress.port}/v1`
      );
      const testButton = page.locator(`[data-test="probar-${configName}"]`);
      await expect(testButton).toBeEnabled();
      await testButton.click();
      await providerRequestStarted;
      const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
      expect(token).toBeTruthy();
      const statusResponse = await page.request.get('/api/ai/configs', {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(statusResponse.status()).toBe(200);
      const statusPayload = (await statusResponse.json()) as {
        data: { id: string; testStatus?: string }[];
      };
      expect(statusPayload.data.find((config) => config.id === configId)?.testStatus).toBe(
        'testing'
      );

      await page.reload();
      const reloadedCard = page.locator('.config-card').filter({ hasText: configName });
      const reloadedTestButton = page.locator(`[data-test="probar-${configName}"]`);
      await expect(reloadedCard.locator('app-badge').nth(1)).toContainText('Probando');
      await expect(reloadedTestButton.locator('button')).toBeDisabled();
      await page.waitForTimeout(2300);
      expect(postCount).toBe(1);
      expect(providerRequestCount).toBe(1);

      resolveProviderRequest();
      await expect(reloadedCard.locator('app-badge').nth(1)).toHaveText('OK', {
        timeout: 10_000
      });
      expect(postCount).toBe(1);
      expect(providerRequestCount).toBe(1);
    } finally {
      resolveProviderRequest();
      await new Promise<void>((resolveClose, rejectClose) => {
        provider.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  });

  test('hides the assistant and blocks recipe generation with a direct setup link when unconfigured', async ({
    page
  }) => {
    await registerWithHousehold(page, '/dashboard', 'Sin proveedor IA sintético');
    const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
    expect(token).toBeTruthy();

    const ingredient = await page.request.post('/api/pantry/ingredients', {
      headers: { authorization: `Bearer ${token}` },
      data: {
        name: 'Calabacín QA sin proveedor',
        category: 'vegetables',
        quantity: 1,
        unit: 'unit',
        location: 'pantry'
      }
    });
    expect(ingredient.status()).toBe(201);

    let generationRequests = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/ai/generate-recipe')) {
        generationRequests += 1;
      }
    });
    await page.goto('/recipes');
    await expect(page.locator('h1.recipes__title')).toBeVisible();
    await expect(page.locator('[data-test="ai-assistant-open"]')).toHaveCount(0);
    await page.getByRole('button', { name: /Generar IA/ }).click();
    const ingredientOption = page
      .locator('[data-ingredient-id]')
      .filter({ hasText: 'Calabacín QA sin proveedor' });
    await expect(ingredientOption).toBeVisible();
    await ingredientOption.click();
    await page.locator('[data-test="recipe-ai-next"]').click();
    await page.locator('[data-test="recipe-ai-next"]').click();
    await expect(page.locator('[data-test="recipe-ai-step-3"]')).toBeVisible();

    await page.getByRole('button', { name: 'Generar 1 receta' }).click();
    const setupDialog = page.getByRole('dialog', { name: 'Configura la IA' });
    await expect(setupDialog).toBeVisible();
    await expect(setupDialog).toContainText('Recetas y recomendaciones');
    await expect(setupDialog.locator('.provider-required__permission')).toHaveCount(0);
    const setupLink = setupDialog.getByRole('link', { name: 'Abrir ajustes' });
    await expect(setupLink).toHaveAttribute('href', '/household?tab=settings');
    await expect(setupDialog).toHaveAttribute('aria-modal', 'true');
    const closeButton = setupDialog.getByRole('button', { name: 'Cerrar' });
    await setupLink.focus();
    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();
    expect(generationRequests).toBe(0);

    const viewport =
      test.info().project.name === 'chromium'
        ? { width: 1440, height: 900 }
        : { width: 393, height: 851 };
    await page.setViewportSize(viewport);
    await capture(page, 'no-provider-dialog', false);

    for (const width of [320, 393, 600, 601, 768, 1440]) {
      await page.setViewportSize({ width, height: 852 });
      const modal = await setupDialog.boundingBox();
      expect(modal, `modal visible at ${width}px`).not.toBeNull();
      expect(modal!.x).toBeGreaterThanOrEqual(0);
      expect(modal!.x + modal!.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `sin overflow horizontal a ${width}px`
      ).toBe(true);
    }

    await setupLink.click();
    await expect(page).toHaveURL('/household?tab=settings');
    await expect(page.locator('[data-test="household-ai-config"]')).toBeVisible();
    const householdSettings = page.locator('[data-test="household-ai-config"]');
    await expect(householdSettings.locator('.empty-state__title')).toHaveText(
      'Sin configuraciones'
    );
    await expect(householdSettings.locator('.empty-state app-button')).toHaveCount(1);
    await expect(householdSettings.locator('[data-test="ai-function-providers"]')).toHaveCount(0);
  });
});
