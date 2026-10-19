import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test } from './fixtures';
import { createHousehold, registerUser } from './helpers/auth';

interface Slot {
  date: string;
  mealType: 'breakfast' | 'lunch' | 'snack' | 'dinner';
  time: string;
  eligibleParticipants: string[];
}

interface ProviderRequest {
  messages?: Array<{
    role?: string;
    content?: string | Array<{ type?: string; file?: { filename?: string; file_data?: string } }>;
  }>;
  response_format?: { type?: string; json_schema?: { strict?: boolean } };
}

const screenshotDirectory = resolve('.e2e-screenshots/household-meal-consumption');

function mondayOf(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return [
    monday.getFullYear(),
    String(monday.getMonth() + 1).padStart(2, '0'),
    String(monday.getDate()).padStart(2, '0')
  ].join('-');
}

test('registra raciones reales o una comida omitida desde el calendario, en escritorio y móvil', async ({
  page
}, testInfo) => {
  test.setTimeout(120_000);
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  const providerRequests: ProviderRequest[] = [];
  const provider = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      const payload = JSON.parse(body) as ProviderRequest;
      providerRequests.push(payload);
      const userContent = payload.messages?.find((message) => message.role === 'user')?.content;
      const contextFile = Array.isArray(userContent)
        ? userContent.find((part) => part.file?.filename === 'meal-planning-context.json')?.file
            ?.file_data
        : undefined;
      const contextPrefix = 'data:application/json;base64,';
      const slots =
        contextFile?.startsWith(contextPrefix) === true
          ? ((
              JSON.parse(
                Buffer.from(contextFile.slice(contextPrefix.length), 'base64').toString('utf8')
              ) as { requiredTurns?: Slot[] }
            ).requiredTurns ?? [])
          : [];
      const instruction = {
        stepNumber: 1,
        instruction: 'Cocina las lentejas sintéticas hasta que estén tiernas.',
        duration: null,
        temperature: null,
        timerRequired: false,
        timerDuration: null,
        tips: null,
        warning: null,
        illustration: null
      };
      const recipe = {
        name: 'Plato E2E compartido',
        description: 'Receta sintética para probar el registro de consumo.',
        difficulty: 'easy',
        cuisine: 'casera',
        totalTime: 30,
        prepTime: 10,
        cookTime: 20,
        restTime: null,
        baseServings: 1,
        calories: null,
        ingredients: [
          {
            name: 'lentejas',
            quantity: 100,
            unit: 'g',
            preparation: null,
            isOptional: false,
            substitutes: [],
            notes: null
          }
        ],
        utensils: ['cacerola'],
        guidance: {
          appliances: [],
          parallelTasks: [],
          tipsAndVariations: [],
          batchCookingWarning: null
        },
        instructionsByLevel: {
          basic: [instruction],
          intermediate: [instruction],
          expert: [instruction]
        },
        nutrition: null,
        storage: null,
        tags: ['synthetic-e2e']
      };
      const events = slots.map((slot) => ({
        date: slot.date,
        mealType: slot.mealType,
        time: slot.time,
        recipeAlias: 'N1',
        participantAliases: slot.eligibleParticipants,
        servings: slot.eligibleParticipants.length,
        objectiveSummary: 'Comida sintética.',
        status: 'scheduled',
        reason: null
      }));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({ newRecipes: [{ alias: 'N1', recipe }], events })
              }
            }
          ]
        })
      );
    });
  });
  await new Promise<void>((resolveListen) => provider.listen(0, '127.0.0.1', resolveListen));
  const providerPort = (provider.address() as AddressInfo).port;

  try {
    await registerUser(page, 'Consumo sintético');
    await expect(page).toHaveURL(/\/household$/);
    await expect(page.locator('.no-household')).toBeVisible();
    await createHousehold(page, 'Hogar consumo E2E');
    const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
    expect(token).toBeTruthy();
    const householdHeaders = { authorization: `Bearer ${token}` };
    const householdResponse = await page.request.get('/api/household', {
      headers: householdHeaders
    });
    expect(householdResponse.ok(), await householdResponse.text()).toBeTruthy();
    const household = (await householdResponse.json()) as {
      data: { id: string; members: Array<{ id: string; isActive: boolean }> };
    };
    const householdId = household.data.id;
    const memberId = household.data.members.find((member) => member.isActive)?.id;
    expect(memberId).toBeTruthy();

    const configResponse = await page.request.post('/api/ai/configs', {
      headers: householdHeaders,
      data: {
        name: 'Proveedor sintético consumo',
        provider: 'custom',
        baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        apiKey: 'synthetic-e2e-only',
        model: 'synthetic-meal-planner',
        retryAttempts: 0,
        concurrency: 1
      }
    });
    expect(configResponse.status(), await configResponse.text()).toBe(201);

    const weekStart = mondayOf(new Date());
    const planningHeaders = { ...householdHeaders, 'x-household-id': householdId };
    const scheduleResponse = await page.request.patch('/api/household/meal-planning', {
      headers: planningHeaders,
      data: {
        household: {
          mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
          mealTimes: { lunch: '13:00' }
        }
      }
    });
    expect(scheduleResponse.ok(), await scheduleResponse.text()).toBeTruthy();

    const proposalResponse = await page.request.post('/api/household/meal-planning/proposal', {
      headers: planningHeaders,
      data: { weekStart, householdMemberIds: [memberId] }
    });
    expect(proposalResponse.ok(), await proposalResponse.text()).toBeTruthy();
    const proposal = (await proposalResponse.json()) as {
      data: {
        proposalId: string;
        weekStart: string;
        recipes: Array<{
          alias: string;
          source: 'new' | 'catalog';
          recipeId: string | null;
          recipe: Record<string, unknown>;
        }>;
        events: Array<Record<string, unknown>>;
      };
    };
    expect(proposal.data.events.length).toBeGreaterThanOrEqual(2);
    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0]?.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true }
    });

    const confirmResponse = await page.request.post('/api/household/meal-planning/confirm', {
      headers: planningHeaders,
      data: {
        proposalId: proposal.data.proposalId,
        weekStart,
        householdMemberIds: [memberId],
        recipes: proposal.data.recipes,
        events: proposal.data.events
      }
    });
    expect(confirmResponse.ok(), await confirmResponse.text()).toBeTruthy();
    const rangeResponse = await page.request.get('/api/calendar/range', {
      headers: householdHeaders,
      params: { startDate: weekStart, endDate: shiftDate(weekStart, 6) }
    });
    expect(rangeResponse.ok(), await rangeResponse.text()).toBeTruthy();
    const range = (await rangeResponse.json()) as {
      data: {
        meals: Array<{ id: string; title?: string; isShared?: boolean; participantIds?: string[] }>;
      };
    };
    const sharedMeals = range.data.meals.filter((meal) => meal.isShared === true);
    expect(sharedMeals.length).toBeGreaterThanOrEqual(2);
    expect(sharedMeals.every((meal) => meal.participantIds?.length === 1)).toBe(true);

    await page.goto(`/calendar?view=week&date=${weekStart}`);
    const plannedMeals = page
      .locator('[data-test="timeline-block-meal"]')
      .filter({ hasText: 'Plato E2E compartido' });
    await expect(plannedMeals).toHaveCount(sharedMeals.length, { timeout: 30000 });
    await plannedMeals.nth(0).click();

    const dialog = page.getByRole('dialog', { name: 'Registrar consumo' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-test="meal-consumption-form"]')).toBeVisible();
    await expect(dialog.getByLabel('Raciones realmente servidas')).toBeVisible();
    const realizedOption = dialog.locator('[data-test="meal-consumption-status-realized"]');
    const notRealizedOption = dialog.locator('[data-test="meal-consumption-status-not-realized"]');
    await realizedOption.focus();
    await page.keyboard.press('ArrowDown');
    await expect(notRealizedOption).toBeChecked();
    await page.keyboard.press('ArrowUp');
    await expect(realizedOption).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width
    );

    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(
        screenshotDirectory,
        testInfo.project.name === 'mobile-chrome'
          ? 'mobile-chrome-consumption.png'
          : 'chromium-consumption.png'
      ),
      fullPage: false,
      animations: 'disabled'
    });

    if (testInfo.project.name === 'mobile-chrome') {
      for (const size of [
        { width: 320, height: 568 },
        { width: 568, height: 320 }
      ]) {
        await page.setViewportSize(size);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          size.width
        );
        await expect(dialog.getByLabel('Raciones realmente servidas')).toBeVisible();
        await expect(dialog.locator('[data-test="meal-consumption-save"]')).toBeVisible();
      }
      await page.setViewportSize(viewport);
    }

    const servingsInput = dialog.getByLabel('Raciones realmente servidas');
    await servingsInput.fill('2');
    const realizedRequest = page.waitForResponse(
      (response) =>
        response.url().includes('/api/household/meal-planning/meals/') &&
        response.url().endsWith('/consumption') &&
        response.request().method() === 'PUT'
    );
    await dialog.locator('[data-test="meal-consumption-save"]').click();
    const realizedResponse = await realizedRequest;
    expect(realizedResponse.status(), await realizedResponse.text()).toBe(200);
    expect(realizedResponse.request().postDataJSON()).toEqual({
      status: 'realized',
      servings: 2,
      expectedVersion: 0
    });
    await expect(dialog.getByText('Consumo guardado.')).toBeVisible();
    const realizedMealId = sharedMeals[0]!.id;
    const realizedStateResponse = await page.request.get(
      `/api/household/meal-planning/meals/${encodeURIComponent(realizedMealId)}/consumption`,
      { headers: planningHeaders }
    );
    expect(realizedStateResponse.ok(), await realizedStateResponse.text()).toBeTruthy();
    expect((await realizedStateResponse.json()).data).toMatchObject({
      status: 'realized',
      servings: 2,
      version: 1
    });

    await dialog.locator('.modal__close').click();
    await plannedMeals.nth(1).click();
    const notRealizedDialog = page.getByRole('dialog', { name: 'Registrar consumo' });
    await expect(notRealizedDialog).toBeVisible();
    await notRealizedDialog.locator('[data-test="meal-consumption-status-not-realized"]').check();
    const notRealizedRequest = page.waitForResponse(
      (response) =>
        response.url().includes('/api/household/meal-planning/meals/') &&
        response.url().endsWith('/consumption') &&
        response.request().method() === 'PUT'
    );
    await notRealizedDialog.locator('[data-test="meal-consumption-save"]').click();
    const notRealizedResponse = await notRealizedRequest;
    expect(notRealizedResponse.status(), await notRealizedResponse.text()).toBe(200);
    expect(notRealizedResponse.request().postDataJSON()).toMatchObject({
      status: 'not_realized',
      servings: 0,
      expectedVersion: 0
    });
    await expect(notRealizedDialog.getByText('Consumo guardado.')).toBeVisible();
  } finally {
    await new Promise<void>((resolveClose, rejectClose) =>
      provider.close((error) => (error ? rejectClose(error) : resolveClose()))
    );
  }
});

function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year!, month! - 1, day!);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}
