import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';
import { createHousehold } from './helpers/auth';

interface ProviderRequest {
  messages?: Array<{
    role?: string;
    content?:
      | string
      | Array<{
          type?: string;
          text?: string;
          file?: { filename?: string; file_data?: string };
        }>;
  }>;
  response_format?: {
    type?: string;
    json_schema?: {
      name?: string;
      strict?: boolean;
      schema?: {
        properties?: {
          events?: {
            minItems?: number;
            items?: { properties?: { recipeAlias?: unknown } };
          };
          newRecipes?: {
            type?: string;
            items?: { properties?: { alias?: unknown; recipe?: unknown } };
          };
        };
      };
    };
  };
}

interface ExpectedSlot {
  date: string;
  mealType: 'breakfast' | 'lunch' | 'snack' | 'dinner';
  time: string;
  eligibleParticipants: string[];
}

interface ProviderMealContext {
  version: number;
  participants: Array<{ alias: string; preferences: unknown }>;
  requiredTurns: ExpectedSlot[];
  pantry: Array<{ name: string; quantity: number; unit: string }>;
  utensils: Array<{ name: string; category: string | null }>;
  previousConfirmedPlan: unknown;
}

interface CompleteRecipeFixture {
  name: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';
  cuisine: string | null;
  totalTime: number;
  prepTime: number;
  cookTime: number;
  restTime: number | null;
  baseServings: 1;
  calories: number | null;
  ingredients: Array<{
    name: string;
    quantity: number;
    unit: string;
    preparation: string | null;
    isOptional: boolean;
    substitutes: string[];
    notes: string | null;
  }>;
  utensils: string[];
  guidance: {
    appliances: string[];
    parallelTasks: string[];
    tipsAndVariations: string[];
    batchCookingWarning: string | null;
  };
  instructionsByLevel: Record<
    'basic' | 'intermediate' | 'expert',
    Array<{
      stepNumber: number;
      instruction: string;
      duration: number | null;
      temperature: { value: number; unit: 'C' | 'F' } | null;
      timerRequired: boolean;
      timerDuration: number | null;
      tips: string | null;
      warning: string | null;
      illustration: null;
    }>
  >;
  nutrition: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number | null;
  } | null;
  storage: {
    method: string;
    duration: string;
    reheatingInstructions: string | null;
    container: string | null;
    freezingPossible: boolean;
    freezingDuration: string | null;
  } | null;
  tags: string[];
}

interface ProviderCatalog {
  version: number;
  recipes: Array<{ alias: string; recipeId?: string | null; recipe: CompleteRecipeFixture }>;
}

interface ProviderMealInputs {
  context: ProviderMealContext;
  catalog: ProviderCatalog;
}

const recipeDetailFixture = (name: string, ingredientName: string): CompleteRecipeFixture => ({
  name,
  description: `Receta completa sintética: ${name}.`,
  difficulty: 'easy',
  cuisine: 'mediterránea',
  totalTime: 30,
  prepTime: 10,
  cookTime: 20,
  restTime: null,
  baseServings: 1,
  calories: 420,
  ingredients: [
    {
      name: ingredientName,
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
    basic: [
      {
        stepNumber: 1,
        instruction: `${name}: paso básico sintético.`,
        duration: 20,
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
        instruction: `${name}: paso intermedio sintético.`,
        duration: 20,
        temperature: null,
        timerRequired: false,
        timerDuration: null,
        tips: 'Remueve de forma regular.',
        warning: null,
        illustration: null
      }
    ],
    expert: [
      {
        stepNumber: 1,
        instruction: `${name}: paso experto sintético.`,
        duration: 20,
        temperature: { value: 95, unit: 'C' },
        timerRequired: true,
        timerDuration: 20,
        tips: 'Ajusta el punto de cocción.',
        warning: null,
        illustration: null
      }
    ]
  },
  nutrition: { calories: 420, protein: 22, carbs: 48, fat: 12, fiber: 9 },
  storage: {
    method: 'Refrigerar en recipiente cerrado.',
    duration: '2 días',
    reheatingInstructions: 'Calentar hasta que esté bien caliente.',
    container: 'Recipiente hermético',
    freezingPossible: true,
    freezingDuration: '1 mes'
  },
  tags: ['sintética']
});

function decodeJsonAttachment(
  content: Array<{ type?: string; file?: { filename?: string; file_data?: string } }>,
  filename: string
): unknown | null {
  const files = content.filter((part) => part.type === 'file');
  const matchingFiles = files.filter((part) => part.file?.filename === filename);
  if (files.length !== 2 || matchingFiles.length !== 1) return null;
  const fileData = matchingFiles[0]?.file?.file_data;
  const prefix = 'data:application/json;base64,';
  if (typeof fileData !== 'string' || !fileData.startsWith(prefix)) return null;
  try {
    return JSON.parse(
      Buffer.from(fileData.slice(prefix.length), 'base64').toString('utf8')
    ) as unknown;
  } catch {
    return null;
  }
}

function readProviderMealInputs(request: ProviderRequest): ProviderMealInputs | null {
  const userMessage = request.messages?.find((message) => message.role === 'user');
  if (!Array.isArray(userMessage?.content)) return null;
  const context = decodeJsonAttachment(
    userMessage.content,
    'meal-planning-context.json'
  ) as ProviderMealContext | null;
  const catalog = decodeJsonAttachment(
    userMessage.content,
    'household-recipes-catalog.json'
  ) as ProviderCatalog | null;
  if (!context || !catalog) return null;
  return { context, catalog };
}

function catalogRecipeApiInput(recipe: CompleteRecipeFixture) {
  const step = (instructions: CompleteRecipeFixture['instructionsByLevel']['basic']) =>
    instructions.map((instruction) => ({ ...instruction }));
  return {
    name: recipe.name,
    description: recipe.description,
    difficulty: recipe.difficulty,
    cuisine: recipe.cuisine,
    totalTime: recipe.totalTime,
    prepTime: recipe.prepTime,
    cookTime: recipe.cookTime,
    restTime: recipe.restTime,
    servings: recipe.baseServings,
    calories: recipe.calories,
    ingredients: recipe.ingredients,
    utensils: recipe.utensils,
    guidance: recipe.guidance,
    instructionsByLevel: {
      basic: step(recipe.instructionsByLevel.basic),
      intermediate: step(recipe.instructionsByLevel.intermediate),
      expert: step(recipe.instructionsByLevel.expert)
    },
    nutrition: { ...recipe.nutrition, sugar: 0, sodium: 0 },
    storage: recipe.storage
      ? {
          method: recipe.storage.method,
          duration: recipe.storage.duration,
          reheatingInstructions: recipe.storage.reheatingInstructions,
          container: recipe.storage.container,
          freezingPossible: recipe.storage.freezingPossible,
          freezingDuration: recipe.storage.freezingDuration
        }
      : null,
    tags: recipe.tags,
    isPublic: false
  };
}

interface CalendarMealProjection {
  id: string;
  date: string;
  meal_type: string;
  time: string | null;
  recipe_name: string;
  servings: number;
  isShared: boolean;
  participantIds: string[];
  participants: Array<{ id: string; name: string }>;
}

const screenshotDirectory = resolve('.e2e-screenshots/household-meal-planning');

async function expectTabsToReferencePanels(
  page: import('@playwright/test').Page,
  tabListSelector: string
) {
  const tabs = page.locator(`${tabListSelector} [role="tab"]`);
  for (let index = 0; index < (await tabs.count()); index += 1) {
    const panelId = await tabs.nth(index).getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    await expect(page.locator(`[id="${panelId}"][role="tabpanel"]`)).toHaveCount(1);
  }
}

async function expectOneActivePanel(
  page: import('@playwright/test').Page,
  panelSelector: string,
  expectedPanels = 3
) {
  await expect(page.locator(panelSelector)).toHaveCount(expectedPanels);
  await expect(page.locator(`${panelSelector}:not([hidden])`)).toHaveCount(1);
}

async function registerWithoutAssumingOnboarding(
  page: import('@playwright/test').Page,
  name: string
) {
  await page.goto('/auth/register');
  await page.locator('input#name').waitFor({ state: 'visible' });
  await page.locator('input#name').fill(name);
  await page.locator('input#email').fill(`meal-proposal-${randomUUID()}@example.test`);
  await page.locator('input#password').fill('Test1234');
  await page.locator('input#confirm-password').fill('Test1234');
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/auth/register')
  );
  await page.locator('button[type="submit"]').click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  await expect(page).toHaveURL(/\/(dashboard|onboarding|household)(\?|$)/, { timeout: 45000 });
  if (new URL(page.url()).pathname.endsWith('/onboarding')) {
    await page.getByRole('button', { name: /Saltar por ahora/i }).click();
    await expect(page).toHaveURL(/\/(dashboard|household)/, { timeout: 45000 });
  }
  await page.goto('/household');
}

test('genera, revisa y confirma comidas con navegación de planificación en escritorio y móvil', async ({
  page,
  browser
}, testInfo) => {
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 390, height: 844 };
  await page.setViewportSize(viewport);

  const secondPage = await browser.newPage({ locale: 'es-ES', viewport });
  const providerRequests: ProviderRequest[] = [];
  const provider = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      const payload = JSON.parse(body) as ProviderRequest;
      providerRequests.push(payload);
      const inputs = readProviderMealInputs(payload);
      const slots = inputs?.context.requiredTurns ?? [];
      const catalogRecipe = inputs?.catalog.recipes.find(
        (entry) => entry.recipe.name === 'SMOKE_E2E_CATALOG'
      );
      const catalogAlias = catalogRecipe?.alias ?? 'UNRESOLVED_CATALOG_ALIAS';
      const newRecipeAlias = 'N1';
      const newRecipe = recipeDetailFixture('Guiso sintético nuevo', 'garbanzos');
      const { baseServings, ...newRecipeWithoutBaseServings } = newRecipe;
      const newRecipes = [
        {
          alias: newRecipeAlias,
          recipe: { ...newRecipeWithoutBaseServings, baseServings }
        }
      ];
      const events = slots.flatMap((slot, slotIndex) => {
        const groups =
          slotIndex % 2 === 0
            ? [slot.eligibleParticipants]
            : slot.eligibleParticipants.map((alias) => [alias]);
        return groups.map((participantAliases, groupIndex) => ({
          date: slot.date,
          mealType: slot.mealType,
          time: slot.time,
          recipeAlias: (slotIndex + groupIndex) % 2 === 0 ? newRecipeAlias : catalogAlias,
          participantAliases,
          servings: participantAliases.length,
          objectiveSummary: 'Almuerzo equilibrado.',
          status: 'scheduled',
          reason: null
        }));
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify({ newRecipes, events }) }
            }
          ]
        })
      );
    });
  });
  await new Promise<void>((resolveListen) => provider.listen(0, '127.0.0.1', resolveListen));
  const providerPort = (provider.address() as AddressInfo).port;

  try {
    await registerWithoutAssumingOnboarding(page, 'Planificador sintético uno');
    await createHousehold(page, 'Hogar sintético de comidas');
    const firstToken = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
    expect(firstToken).toBeTruthy();
    const firstHeaders = { authorization: `Bearer ${firstToken}` };

    const savedCatalogRecipe = recipeDetailFixture('SMOKE_E2E_CATALOG', 'arroz');
    const savedCatalogRecipeResponse = await page.request.post('/api/recipes', {
      headers: firstHeaders,
      data: catalogRecipeApiInput(savedCatalogRecipe)
    });
    expect(savedCatalogRecipeResponse.status(), await savedCatalogRecipeResponse.text()).toBe(201);
    const savedCatalogRecipeBody = (await savedCatalogRecipeResponse.json()) as {
      data: { id: string };
    };
    const savedCatalogRecipeId = savedCatalogRecipeBody.data.id;
    expect(savedCatalogRecipeId).toBeTruthy();

    await registerWithoutAssumingOnboarding(secondPage, 'Planificador sintético dos');
    await createHousehold(secondPage, 'Hogar proveedor sintético');
    const ownerToken = await secondPage.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
    expect(ownerToken).toBeTruthy();
    const ownerHeaders = { authorization: `Bearer ${ownerToken}` };
    const ownerHouseholdResponse = await secondPage.request.get('/api/household', {
      headers: ownerHeaders
    });
    expect(ownerHouseholdResponse.ok(), await ownerHouseholdResponse.text()).toBeTruthy();
    const ownerHousehold = (await ownerHouseholdResponse.json()) as {
      data: { id: string; members: Array<{ id: string; isActive: boolean }> };
    };
    const householdId = ownerHousehold.data.id;
    const ownerMemberId = ownerHousehold.data.members.find((member) => member.isActive)?.id;
    expect(ownerMemberId).toBeTruthy();

    const configResponse = await secondPage.request.post('/api/ai/configs', {
      headers: ownerHeaders,
      data: {
        name: 'Proveedor sintético de comidas',
        provider: 'custom',
        baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        apiKey: 'synthetic-e2e-only',
        model: 'synthetic-meal-planner',
        retryAttempts: 0,
        concurrency: 1
      }
    });
    expect(configResponse.status(), await configResponse.text()).toBe(201);

    const scheduleResponse = await secondPage.request.patch('/api/household/meal-planning', {
      headers: { ...ownerHeaders, 'x-household-id': householdId },
      data: {
        household: {
          mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
          mealTimes: { lunch: '13:00' }
        }
      }
    });
    expect(scheduleResponse.ok(), await scheduleResponse.text()).toBeTruthy();

    const inviteUrl = (await secondPage.locator('.invite-card__code').innerText()).trim();
    const inviteCode = new URL(inviteUrl).pathname.split('/').at(-1);
    expect(inviteCode).toBeTruthy();
    await page.goto('/household');
    await page.getByRole('button', { name: 'Unirse a otro hogar' }).click();
    const joinDialog = page.getByRole('dialog', { name: 'Unirse a un Hogar' });
    await joinDialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode!);
    await joinDialog.getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(page.locator('.household-info__name')).toHaveText('Hogar proveedor sintético');

    const householdResponse = await page.request.get('/api/household', { headers: firstHeaders });
    expect(householdResponse.ok(), await householdResponse.text()).toBeTruthy();
    const household = (await householdResponse.json()) as {
      data: {
        id: string;
        members: Array<{ id: string; userId: string; name: string; isActive: boolean }>;
      };
    };
    expect(household.data.id).toBe(householdId);
    const activeMembers = household.data.members.filter((member) => member.isActive);
    expect(activeMembers).toHaveLength(2);
    expect(activeMembers.map((member) => member.id)).toContain(ownerMemberId);
    const memberByUserId = new Map(activeMembers.map((member) => [member.userId, member]));
    const ownerMember = activeMembers.find((member) => member.id === ownerMemberId);
    expect(ownerMember).toBeTruthy();

    await page.goto('/household?tab=tasks&planning=meals&source=synthetic-e2e');
    const planningTabs = page.locator('.household-planning-tabs');
    await expect(planningTabs).toHaveAttribute('role', 'tablist');
    await expectTabsToReferencePanels(page, '.household-tabs');
    await expectTabsToReferencePanels(page, '.household-planning-tabs');
    const householdTabMetrics = await page
      .locator('[data-test="household-tab-tasks"]')
      .evaluate((tab) => {
        const bounds = tab.getBoundingClientRect();
        return {
          fontSize: Number.parseFloat(getComputedStyle(tab).fontSize),
          height: bounds.height
        };
      });
    expect(householdTabMetrics.fontSize).toBeGreaterThanOrEqual(14);
    expect(householdTabMetrics.height).toBeGreaterThanOrEqual(44);
    if (testInfo.project.name === 'mobile-chrome') {
      const tabOverflow = await page.locator('.household-tabs').evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        overflowX: getComputedStyle(element).overflowX
      }));
      expect(tabOverflow.overflowX).toBe('auto');
      expect(tabOverflow.scrollWidth).toBeGreaterThan(tabOverflow.clientWidth);
    }
    await expect(page).toHaveURL(/tab=tasks.*planning=meals.*source=synthetic-e2e/);
    await expect(page.locator('[data-test="household-planning-tab-meals"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expectOneActivePanel(page, '[data-test^="household-planning-panel-"]');

    const settingsTab = page.locator('[data-test="household-planning-tab-settings"]');
    await settingsTab.click();
    await expect(page).toHaveURL(/planning=settings.*source=synthetic-e2e/);
    await expectOneActivePanel(page, '[data-test^="household-planning-panel-"]');
    await expect(page.locator('[data-test="meal-settings-content"]')).toBeVisible();
    await settingsTab.focus();
    await page.keyboard.press('Home');
    await expect(page.locator('[data-test="household-planning-tab-meals"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page).toHaveURL(/planning=meals.*source=synthetic-e2e/);
    await expectOneActivePanel(page, '[data-test^="household-planning-panel-"]');

    const proposalRequest = page.waitForRequest(
      (request) =>
        request.url().includes('/api/household/meal-planning/proposal') &&
        request.method() === 'POST'
    );
    const proposalResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/household/meal-planning/proposal') &&
        response.request().method() === 'POST'
    );
    await page.locator('[data-test="meal-proposal-generate"] button').click();
    const generatedRequest = (await proposalRequest).postDataJSON() as {
      weekStart: string;
      householdMemberIds: string[];
    };
    expect(generatedRequest.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(generatedRequest.householdMemberIds).toEqual(activeMembers.map((member) => member.id));
    const generatedResponse = await proposalResponse;
    expect(generatedResponse.status(), await generatedResponse.text()).toBe(200);
    const generatedProposal = (await generatedResponse.json()) as {
      data: {
        recipes: Array<{
          alias: string;
          source: 'new' | 'catalog';
          recipeId: string | null;
          recipe: CompleteRecipeFixture;
        }>;
        events: Array<{ recipeAlias: string; status: string; servings: number }>;
      };
    };
    expect(generatedProposal.data.recipes).toHaveLength(2);
    expect(generatedProposal.data.recipes.map((recipe) => recipe.source).sort()).toEqual([
      'catalog',
      'new'
    ]);
    expect(generatedProposal.data.recipes.map((recipe) => recipe.alias)).toContain('N1');
    const generatedCatalogRecipe = generatedProposal.data.recipes.find(
      (recipe) => recipe.source === 'catalog'
    );
    expect(generatedCatalogRecipe?.recipeId).toBe(savedCatalogRecipeId);
    expect(generatedProposal.data.events.some((event) => event.recipeAlias === 'N1')).toBe(true);
    expect(
      generatedProposal.data.events.some(
        (event) => event.recipeAlias === generatedCatalogRecipe?.alias
      )
    ).toBe(true);
    const review = page.locator('[data-test="meal-proposal-review"]');
    await expect(review).toBeVisible();
    await expect(page.locator('[data-test="meal-proposal-step-tab-review"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expectTabsToReferencePanels(page, '.meal-planner__steps');
    await expectOneActivePanel(page, '[data-test^="meal-proposal-step-panel-"]', 2);
    const reviewStepTab = page.locator('[data-test="meal-proposal-step-tab-review"]');
    await reviewStepTab.focus();
    await page.keyboard.press('Home');
    await expect(page.locator('[data-test="meal-proposal-step-tab-prepare"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expectOneActivePanel(page, '[data-test^="meal-proposal-step-panel-"]', 2);
    await expect(review).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(reviewStepTab).toHaveAttribute('aria-selected', 'true');
    await expect(review).toContainText('Compartida');
    await expect(review).toContainText('2 raciones');
    await expect(review).toContainText('Planificador sintético uno');
    await expect(review).toContainText('Planificador sintético dos');
    await expect(page.locator('[data-test="meal-proposal-confirm"] button')).toBeEnabled();
    const reviewDay = page.locator('[data-test="meal-proposal-review-day"]');
    await expect(reviewDay).toBeVisible();
    await expect(page.locator('[data-test^="meal-proposal-event-"]')).toHaveCount(1);
    const sharedProposalEvent = page.locator('[data-test^="meal-proposal-event-"]').first();
    await expect(sharedProposalEvent).toContainText('Guiso sintético nuevo');
    const sharedRecipeDetails = sharedProposalEvent.locator('details.meal-planner__recipe-details');
    await sharedRecipeDetails.locator('summary').click();
    await expect(sharedRecipeDetails).toContainText('200 g');
    for (const level of ['basic', 'intermediate', 'expert'] as const) {
      const levelSelector = sharedRecipeDetails.locator(
        `[data-test="meal-proposal-recipe-level-${level}"]`
      );
      await expect(levelSelector).toBeVisible();
      await levelSelector.click();
      const visibleLevel = { basic: 'básico', intermediate: 'intermedio', expert: 'experto' }[
        level
      ];
      await expect(sharedRecipeDetails).toContainText(`paso ${visibleLevel} sintético`);
    }
    await sharedRecipeDetails.scrollIntoViewIfNeeded();
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-recipe-details.png`),
      fullPage: false,
      animations: 'disabled'
    });
    await reviewDay.locator('button[aria-haspopup="listbox"]').click();
    await page.getByRole('option').nth(1).click();
    await expect(page.locator('[data-test^="meal-proposal-event-"]')).toHaveCount(2);
    await expect(review).toContainText('Individual');
    const catalogRecipeEvent = page
      .locator('[data-test^="meal-proposal-event-"]')
      .filter({ hasText: 'SMOKE_E2E_CATALOG' });
    await expect(catalogRecipeEvent).toHaveCount(1);
    await expect(catalogRecipeEvent).toContainText('100 g');
    await reviewDay.locator('button[aria-haspopup="listbox"]').click();
    await page.getByRole('option').nth(0).click();
    const selectedProposalDay = await reviewDay.locator('.picker__trigger').innerText();
    await page.locator('[data-test="household-planning-tab-tasks"]').click();
    await expectOneActivePanel(page, '[data-test^="household-planning-panel-"]');
    await expect(review).toBeHidden();
    await page.locator('[data-test="household-planning-tab-settings"]').click();
    await expectOneActivePanel(page, '[data-test^="household-planning-panel-"]');
    await expect(review).toBeHidden();
    await page.locator('[data-test="household-planning-tab-meals"]').click();
    await expect
      .poll(() => {
        const query = new URL(page.url()).searchParams;
        return [query.get('planning'), query.get('source')];
      })
      .toEqual(['meals', 'synthetic-e2e']);
    await expectTabsToReferencePanels(page, '.household-planning-tabs');
    await expectOneActivePanel(page, '[data-test^="household-planning-panel-"]');
    await expect(page.locator('[data-test="meal-proposal-step-tab-review"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(review).toBeVisible();
    await expect(reviewDay.locator('.picker__trigger')).toHaveText(selectedProposalDay);
    await expect(page.locator('[data-test^="meal-proposal-event-"]')).toHaveCount(1);
    expect(providerRequests).toHaveLength(1);
    if (testInfo.project.name === 'mobile-chrome') {
      const reviewHeight = await review.evaluate((element) => element.scrollHeight);
      expect(reviewHeight).toBeLessThan(1600);
    }
    const confirmButton = page.locator('[data-test="meal-proposal-confirm"] button');
    await expect(confirmButton).toBeVisible();
    if (testInfo.project.name === 'mobile-chrome') {
      await confirmButton.scrollIntoViewIfNeeded();
      await expect(confirmButton).toBeInViewport();
      const confirmationSpace = await confirmButton.evaluate((button) => {
        const buttonBottom = button.getBoundingClientRect().bottom;
        const navigation = document.querySelector('.bottom-nav');
        return {
          buttonBottom,
          navigationTop: navigation?.getBoundingClientRect().top ?? window.innerHeight
        };
      });
      expect(confirmationSpace.buttonBottom).toBeLessThan(confirmationSpace.navigationTop);
    }

    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0]?.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'weekly_meal_proposal',
        strict: true,
        schema: {
          properties: {
            events: { minItems: 1 },
            newRecipes: { type: 'array' }
          }
        }
      }
    });
    expect(
      providerRequests[0]?.response_format?.json_schema?.schema?.properties?.events?.items
        ?.properties?.recipeAlias
    ).toBeDefined();
    const userMessage = providerRequests[0]?.messages?.find((message) => message.role === 'user');
    const contentParts = Array.isArray(userMessage?.content) ? userMessage.content : [];
    const attachedJsonFiles = contentParts.filter((part) => part.type === 'file');
    expect(attachedJsonFiles.map((part) => part.file?.filename).sort()).toEqual([
      'household-recipes-catalog.json',
      'meal-planning-context.json'
    ]);
    expect(
      attachedJsonFiles.every((part) =>
        part.file?.file_data?.startsWith('data:application/json;base64,')
      )
    ).toBe(true);
    const textPrompt = contentParts
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('\n');
    const providerInputs = readProviderMealInputs(providerRequests[0]!);
    expect(providerInputs).not.toBeNull();
    const context = providerInputs?.context;
    const catalog = providerInputs?.catalog;
    expect(context).not.toHaveProperty('recipes');
    expect(context).toMatchObject({
      version: 2,
      participants: [{ alias: 'P1' }, { alias: 'P2' }],
      pantry: expect.any(Array),
      utensils: expect.any(Array)
    });
    expect(context?.requiredTurns).toHaveLength(7);
    expect(context?.requiredTurns.every((slot) => slot.eligibleParticipants.length > 0)).toBe(true);
    expect(textPrompt).toContain('meal-planning-context.json');
    expect(textPrompt).toContain('household-recipes-catalog.json');
    expect(catalog?.version).toBe(1);
    expect(
      catalog?.recipes.some(
        (recipe) =>
          recipe.alias === generatedCatalogRecipe?.alias &&
          recipe.recipe.name === 'SMOKE_E2E_CATALOG'
      )
    ).toBe(true);
    const catalogFixture = catalog?.recipes.find(
      (recipe) => recipe.recipe.name === 'SMOKE_E2E_CATALOG'
    );
    expect(catalogFixture).toBeTruthy();
    expect(catalogFixture).not.toHaveProperty('id');
    expect(catalogFixture).not.toHaveProperty('recipeId');
    const prompt = `${textPrompt}\n${JSON.stringify(context)}`;
    for (const member of activeMembers) {
      expect(prompt).not.toContain(member.name);
      expect(prompt).not.toContain(member.userId);
    }

    await mkdir(screenshotDirectory, { recursive: true });
    if (testInfo.project.name === 'mobile-chrome') {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: resolve(screenshotDirectory, 'mobile-chrome-proposal-top.png'),
        fullPage: false,
        animations: 'disabled'
      });
      await confirmButton.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(screenshotDirectory, 'mobile-chrome-proposal.png'),
        animations: 'disabled'
      });
    } else {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: resolve(screenshotDirectory, 'chromium-proposal.png'),
        fullPage: true,
        animations: 'disabled'
      });
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width
    );
    if (testInfo.project.name === 'mobile-chrome') {
      for (const size of [
        { width: 320, height: 568 },
        { width: 568, height: 320 }
      ]) {
        await page.setViewportSize(size);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(size.width);
        await expect(page.locator('[data-test="household-planning-tab-meals"]')).toBeVisible();
        await expectOneActivePanel(page, '[data-test^="household-planning-panel-"]');
      }
      await page.setViewportSize(viewport);
    }

    const noEarlyConfirm = await page.request.get('/api/calendar/range', {
      headers: firstHeaders,
      params: {
        startDate: generatedRequest.weekStart,
        endDate: new Date(
          new Date(`${generatedRequest.weekStart}T00:00:00.000Z`).getTime() + 6 * 86400000
        )
          .toISOString()
          .slice(0, 10)
      }
    });
    expect(noEarlyConfirm.ok(), await noEarlyConfirm.text()).toBeTruthy();
    const noEarlyConfirmBody = (await noEarlyConfirm.json()) as {
      data: { meals: Array<{ date: string; mealType: string }> };
    };
    expect(noEarlyConfirmBody.data.meals).toHaveLength(0);

    let confirmCalls = 0;
    const confirmRequest = page.waitForRequest(
      (request) =>
        request.url().includes('/api/household/meal-planning/confirm') &&
        request.method() === 'POST'
    );
    const confirmResponse = page.waitForResponse((response) => {
      const matches =
        response.url().includes('/api/household/meal-planning/confirm') &&
        response.request().method() === 'POST';
      if (matches) confirmCalls += 1;
      return matches;
    });
    await page.locator('[data-test="meal-proposal-confirm"] button').click();
    const submitted = (await confirmRequest).postDataJSON() as {
      proposalId: string;
      weekStart: string;
      householdMemberIds: string[];
      recipes: Array<{
        alias: string;
        source: 'new' | 'catalog';
        recipeId: string | null;
        recipe: CompleteRecipeFixture;
      }>;
      events: Array<{
        id: string;
        date: string;
        mealType: string;
        time: string | null;
        recipeAlias: string;
        participantAliases: string[];
        participantIds: string[];
        servings: number;
      }>;
    };
    expect(submitted.proposalId).toBeTruthy();
    expect(submitted.weekStart).toBe(generatedRequest.weekStart);
    expect(submitted.householdMemberIds).toEqual(generatedRequest.householdMemberIds);
    expect(submitted.recipes).toHaveLength(2);
    expect(new Set(submitted.recipes.map((recipe) => recipe.alias)).size).toBe(2);
    expect(submitted.recipes.map((recipe) => recipe.source).sort()).toEqual(['catalog', 'new']);
    expect(submitted.recipes.find((recipe) => recipe.source === 'catalog')?.recipeId).toBe(
      savedCatalogRecipeId
    );
    expect(submitted.recipes.find((recipe) => recipe.source === 'new')?.recipeId).toBeNull();
    expect(submitted.events.length).toBeGreaterThan(0);
    expect(
      submitted.events.every(
        (event) =>
          typeof event.recipeAlias === 'string' &&
          submitted.recipes.some((recipe) => recipe.alias === event.recipeAlias) &&
          !('recipe' in event)
      )
    ).toBe(true);
    expect(submitted.events.some((event) => event.participantIds.length === 2)).toBe(true);
    expect(submitted.events.some((event) => event.participantIds.length === 1)).toBe(true);
    expect(submitted.events.some((event) => event.servings === 2)).toBe(true);
    const confirmation = await confirmResponse;
    const confirmationText = await confirmation.text();
    expect(confirmation.status(), confirmationText).toBe(200);
    await expect(page.getByText(/comidas añadidas al calendario/i)).toBeVisible();
    expect(confirmCalls).toBe(1);
    const savedGeneratedRecipesResponse = await page.request.get('/api/recipes', {
      headers: firstHeaders,
      params: { search: 'Guiso sintético nuevo' }
    });
    expect(
      savedGeneratedRecipesResponse.ok(),
      await savedGeneratedRecipesResponse.text()
    ).toBeTruthy();
    const savedGeneratedRecipes = (await savedGeneratedRecipesResponse.json()) as {
      data: { recipes: Array<{ name: string; isPublic?: boolean }> };
    };
    const matchingGeneratedRecipes = savedGeneratedRecipes.data.recipes.filter(
      (recipe) => recipe.name === 'Guiso sintético nuevo'
    );
    expect(matchingGeneratedRecipes).toHaveLength(1);
    expect(matchingGeneratedRecipes[0]?.isPublic).toBe(false);

    const weekEnd = new Date(
      new Date(`${generatedRequest.weekStart}T00:00:00.000Z`).getTime() + 6 * 86400000
    )
      .toISOString()
      .slice(0, 10);
    const calendarRange = { startDate: generatedRequest.weekStart, endDate: weekEnd };
    const firstMemberCalendarResponse = await page.request.get('/api/calendar/range', {
      headers: firstHeaders,
      params: calendarRange
    });
    expect(firstMemberCalendarResponse.ok(), await firstMemberCalendarResponse.text()).toBeTruthy();
    const firstMemberCalendar = (await firstMemberCalendarResponse.json()) as {
      data: { meals: CalendarMealProjection[] };
    };
    const ownerCalendarResponse = await secondPage.request.get('/api/calendar/range', {
      headers: ownerHeaders,
      params: calendarRange
    });
    expect(ownerCalendarResponse.ok(), await ownerCalendarResponse.text()).toBeTruthy();
    const ownerCalendar = (await ownerCalendarResponse.json()) as {
      data: { meals: CalendarMealProjection[] };
    };

    const expectedMealKeys = submitted.events
      .map((event) => {
        const recipeName = submitted.recipes.find((recipe) => recipe.alias === event.recipeAlias)
          ?.recipe.name;
        expect(recipeName).toBeTruthy();
        return JSON.stringify([
          event.date,
          event.mealType,
          event.time,
          recipeName,
          event.servings,
          [...event.participantIds].sort()
        ]);
      })
      .sort();
    const calendarMealKeys = (meals: CalendarMealProjection[]) =>
      meals
        .map((meal) =>
          JSON.stringify([
            meal.date,
            meal.meal_type,
            meal.time,
            meal.recipe_name,
            meal.servings,
            [...meal.participantIds].sort()
          ])
        )
        .sort();
    for (const memberMeals of [firstMemberCalendar.data.meals, ownerCalendar.data.meals]) {
      expect(memberMeals).toHaveLength(submitted.events.length);
      expect(memberMeals.every((meal) => meal.isShared)).toBe(true);
      expect(calendarMealKeys(memberMeals)).toEqual(expectedMealKeys);
      for (const meal of memberMeals) {
        const expectedParticipants = meal.participantIds
          .map((userId) => {
            const member = memberByUserId.get(userId);
            expect(member, `calendar includes unknown participant ${userId}`).toBeTruthy();
            return { id: userId, name: member!.name };
          })
          .sort((left, right) => left.id.localeCompare(right.id));
        expect(
          [...meal.participants].sort((left, right) => left.id.localeCompare(right.id))
        ).toEqual(expectedParticipants);
      }
    }
    expect(calendarMealKeys(firstMemberCalendar.data.meals)).toEqual(
      calendarMealKeys(ownerCalendar.data.meals)
    );

    const expectedCalendarTitles = firstMemberCalendar.data.meals
      .map((meal) => meal.recipe_name)
      .sort();
    for (const [memberPage, account] of [
      [page, 'member'],
      [secondPage, 'owner']
    ] as const) {
      await memberPage.goto(`/calendar?view=week&date=${generatedRequest.weekStart}`);
      const renderedMeals = memberPage.locator(
        '[data-test="timeline-block-meal"] .tl__block-title'
      );
      await expect(renderedMeals).toHaveCount(submitted.events.length);
      await expect(renderedMeals.first()).toBeVisible();
      expect((await renderedMeals.allTextContents()).map((title) => title.trim()).sort()).toEqual(
        expectedCalendarTitles
      );
      await renderedMeals.first().scrollIntoViewIfNeeded();
      const screenshotDirectoryForProject = resolve(screenshotDirectory, testInfo.project.name);
      await mkdir(screenshotDirectoryForProject, { recursive: true });
      await memberPage.screenshot({
        path: resolve(screenshotDirectoryForProject, `shared-meals-calendar-${account}.png`),
        fullPage: false,
        animations: 'disabled'
      });
    }

    await page.goto('/household');
    await page.evaluate(() => window.scrollTo(0, 0));
    // Everyone can see the household plan, but only the assigned participant can
    // read consumption state. GET keeps this check read-only and does not alter stock.
    const individualMeal = firstMemberCalendar.data.meals.find(
      (meal) => meal.participantIds.length === 1
    );
    expect(individualMeal).toBeTruthy();
    const assignedUserId = individualMeal!.participantIds[0]!;
    const assignedHeaders = {
      ...(assignedUserId === ownerMember!.userId ? ownerHeaders : firstHeaders),
      'x-household-id': householdId
    };
    const unassignedHeaders = {
      ...(assignedUserId === ownerMember!.userId ? firstHeaders : ownerHeaders),
      'x-household-id': householdId
    };
    const consumptionPath = `/api/household/meal-planning/meals/${individualMeal!.id}/consumption`;
    const assignedConsumption = await page.request.get(consumptionPath, {
      headers: assignedHeaders
    });
    expect(assignedConsumption.status(), await assignedConsumption.text()).toBe(200);
    expect(await assignedConsumption.json()).toMatchObject({
      success: true,
      data: { status: 'unrecorded', servings: null, version: 0 }
    });
    const unassignedConsumption = await page.request.get(consumptionPath, {
      headers: unassignedHeaders
    });
    expect(unassignedConsumption.status(), await unassignedConsumption.text()).toBe(403);
    expect(await unassignedConsumption.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_MEAL_PARTICIPANT_REQUIRED'
    });

    const sidebar = page.locator('.sidebar');
    if (
      testInfo.project.name === 'mobile-chrome' &&
      !(await sidebar.evaluate((element) => element.classList.contains('sidebar--open')))
    ) {
      await page.locator('.header__menu').click();
    }
    const householdPicker = page.locator('[data-test="active-household-select"]');
    await expect(householdPicker).toBeVisible();
    await householdPicker.locator('.picker__trigger').click();
    await page.getByRole('option').filter({ hasText: 'Hogar sintético de comidas' }).click();
    await expect(page.locator('.household-info__name')).toHaveText('Hogar sintético de comidas');
    if (
      testInfo.project.name === 'mobile-chrome' &&
      (await sidebar.evaluate((element) => element.classList.contains('sidebar--open')))
    ) {
      await page.locator('.sidebar__close').click();
    }
    await page.locator('[data-test="household-tab-tasks"]').click();
    await page.locator('[data-test="household-planning-tab-meals"]').click();
    await expectOneActivePanel(page, '[data-test^="household-planning-panel-"]');
    await expect(page.locator('[data-test="meal-proposal-step-tab-prepare"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator('[data-test="meal-proposal-review"]')).toHaveCount(0);
    await expect(page.locator('[data-test="meal-proposal-review-day"]')).toHaveCount(0);
    expect(providerRequests).toHaveLength(1);
  } finally {
    await secondPage.close();
    await new Promise<void>((resolveClose, rejectClose) =>
      provider.close((error) => (error ? rejectClose(error) : resolveClose()))
    );
  }
});
