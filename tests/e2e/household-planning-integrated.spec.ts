import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { devices, type BrowserContext, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { responsesCompleted, userInput, type ResponsesRequest } from './helpers/ai-responses';
import { createHousehold, registerUser } from './helpers/auth';

type ProviderRequest = ResponsesRequest;

interface MealSlot {
  date: string;
  mealType: 'breakfast' | 'lunch' | 'snack' | 'dinner';
  time: string;
  eligibleParticipants: string[];
}

interface HouseholdMember {
  id: string;
  userId: string;
  name: string;
  isActive: boolean;
  role: string;
  permissions: {
    calendar?: { view?: boolean; edit?: boolean };
    settings?: boolean;
  };
}

interface Household {
  id: string;
  name: string;
  members: HouseholdMember[];
}

interface MealPlanningSettings {
  household: {
    objective: { goals: string[]; notes: string };
    mealTypes: Record<string, boolean>;
    mealTimes: Record<string, string>;
  };
  member: {
    goalOverrideEnabled: boolean;
    scheduleOverrideEnabled: boolean;
    personalObjective: { goals: string[]; notes: string };
    personalSchedule: { mealTypes: Record<string, boolean>; mealTimes: Record<string, string> };
  };
  effective: {
    objective: { goals: string[]; notes: string; source: 'household' | 'member' };
    schedule: {
      mealTypes: Record<string, boolean>;
      mealTimes: Record<string, string>;
      source: 'household' | 'member';
    };
  };
}

interface CalendarMeal {
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

interface ShoppingList {
  id: string;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unit: string | null;
    checked: boolean | number;
    source: string;
  }>;
}

interface AutomationSnapshot {
  enabled: boolean;
  mode: 'generate' | 'repeat' | null;
  scopes: Array<'tasks' | 'meals'>;
  weekday: number | null;
  localTime: string | null;
  timeZone: string | null;
  version: number;
  nextRunAt: string | null;
  nextRun: {
    localDate: string;
    localTime: string;
    timeZone: string;
    utcInstant: string;
  } | null;
  lastRun: { status: string } | null;
}

async function responseData<T>(
  response: { status(): number; text(): Promise<string> },
  expectedStatus = 200
): Promise<T> {
  const text = await response.text();
  expect(response.status(), text).toBe(expectedStatus);
  return (JSON.parse(text) as { data: T }).data;
}

async function bearerHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
  expect(token).toBeTruthy();
  return { authorization: 'Bearer ' + String(token) };
}

async function readHousehold(page: Page, headers: Record<string, string>): Promise<Household> {
  return responseData<Household>(await page.request.get('/api/household', { headers }));
}

async function readCalendar(
  page: Page,
  headers: Record<string, string>,
  startDate: string,
  endDate: string
): Promise<CalendarMeal[]> {
  const result = await responseData<{ meals: CalendarMeal[] }>(
    await page.request.get('/api/calendar/range', {
      headers,
      params: { startDate, endDate }
    })
  );
  return result.meals;
}

async function readAutomation(
  page: Page,
  headers: Record<string, string>
): Promise<AutomationSnapshot> {
  return responseData<AutomationSnapshot>(
    await page.request.get('/api/household/planning-automation', { headers })
  );
}

function addDays(date: string, count: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + count)).toISOString().slice(0, 10);
}

function nextMonday(date: string): string {
  const day = new Date(date + 'T12:00:00.000Z').getUTCDay();
  return addDays(date, (8 - day) % 7 || 7);
}

function madridScheduleDay(offsetDays: number): { weekday: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((values, part) => {
      if (part.type !== 'literal') values[part.type] = part.value;
      return values;
    }, {});
  const target = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offsetDays)
  );
  const day = target.getUTCDay();
  return { weekday: day === 0 ? 7 : day, date: target.toISOString().slice(0, 10) };
}

function eventKey(meal: {
  date: string;
  mealType: string;
  time: string | null;
  recipeName: string;
  servings: number;
  participantIds: string[];
}): string {
  return JSON.stringify([
    meal.date,
    meal.mealType,
    meal.time,
    meal.recipeName,
    meal.servings,
    [...meal.participantIds].sort()
  ]);
}

function readRequiredTurns(payload: ProviderRequest): MealSlot[] {
  const userContent = userInput(payload)?.content;
  if (!Array.isArray(userContent)) {
    throw new Error('Provider fixture is missing multipart planning context.');
  }

  const contextFile = userContent.find(
    (part) => part.type === 'input_file' && part.filename === 'meal-planning-context.json'
  )?.file_data;
  const contextPrefix = 'data:application/json;base64,';
  if (!contextFile?.startsWith(contextPrefix)) {
    throw new Error('Provider fixture is missing the planning context attachment.');
  }

  const context = JSON.parse(
    Buffer.from(contextFile.slice(contextPrefix.length), 'base64').toString('utf8')
  ) as { requiredTurns?: MealSlot[] };
  if (!Array.isArray(context.requiredTurns)) {
    throw new Error('Provider fixture context has no required turns.');
  }
  return context.requiredTurns;
}

async function captureSyntheticScreen(page: Page, project: string, state: string): Promise<string> {
  const directory = resolve('.e2e-screenshots/household-planning-integrated');
  await mkdir(directory, { recursive: true });
  const path = join(directory, project + '-' + state + '-' + randomUUID() + '.png');
  await page.screenshot({ path, fullPage: false, animations: 'disabled' });
  console.info('[household-planning-integrated] screenshot: ' + path);
  return path;
}

test('recorre planificación del hogar y guarda automatización futura sin escrituras prematuras', async ({
  page,
  browser
}, testInfo) => {
  test.setTimeout(180_000);
  const mobile = testInfo.project.use.isMobile === true;
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const baseURL = String(testInfo.project.use.baseURL);
  const device =
    testInfo.project.name === 'mobile-safari'
      ? devices['iPhone 13']
      : mobile
        ? devices['Pixel 5']
        : devices['Desktop Chrome'];
  await page.setViewportSize(viewport);

  const memberContext: BrowserContext = await browser.newContext({
    ...device,
    baseURL,
    locale: 'es-ES',
    serviceWorkers: 'block'
  });
  const memberPage = await memberContext.newPage();
  await memberPage.setViewportSize(viewport);

  const ingredientName = 'Ingrediente integrado ' + randomUUID();
  const providerRequests: ProviderRequest[] = [];
  const provider = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      if (request.method !== 'POST' || request.url !== '/v1/responses') {
        response.writeHead(404).end();
        return;
      }
      try {
        const payload = JSON.parse(body) as ProviderRequest;
        providerRequests.push(payload);
        const slots = readRequiredTurns(payload);
        const instruction = {
          stepNumber: 1,
          instruction: 'Cocina el ingrediente sintético hasta que esté tierno.',
          duration: null,
          temperature: null,
          timerRequired: false,
          timerDuration: null,
          tips: null,
          warning: null,
          illustration: null
        };
        const recipe = {
          name: 'Comida integrada E2E',
          description: 'Receta sintética para el recorrido integrado.',
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
            basic: [instruction],
            intermediate: [instruction],
            expert: [instruction]
          },
          nutrition: null,
          storage: null,
          tags: ['synthetic-e2e']
        };
        const events = slots.flatMap((slot, index) => {
          const groups =
            index % 2 === 0
              ? [slot.eligibleParticipants]
              : slot.eligibleParticipants.map((alias) => [alias]);
          return groups.map((participantAliases) => ({
            date: slot.date,
            mealType: slot.mealType,
            time: slot.time,
            recipeAlias: 'N1',
            participantAliases,
            servings: participantAliases.length,
            objectiveSummary: 'Comida equilibrada de prueba.',
            status: 'scheduled',
            reason: null
          }));
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify(
            responsesCompleted(JSON.stringify({ newRecipes: [{ alias: 'N1', recipe }], events }))
          )
        );
      } catch {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Synthetic provider fixture failed.' } }));
      }
    });
  });
  await new Promise<void>((resolveListen) => provider.listen(0, '127.0.0.1', resolveListen));
  const providerAddress = provider.address();
  if (!providerAddress || typeof providerAddress === 'string') {
    await memberContext.close();
    throw new Error('No se pudo abrir el proveedor local sintético.');
  }

  try {
    const ownerName = 'Propietario E2E sintético';
    const memberName = 'Miembro E2E sintético';
    const householdName = 'Hogar integrado sintético';
    await registerUser(page, ownerName);
    await createHousehold(page, householdName);

    const ownerAuth = await bearerHeaders(page);
    const ownerHousehold = await readHousehold(page, ownerAuth);
    const householdId = ownerHousehold.id;
    const owner = ownerHousehold.members.find((member) => member.isActive);
    expect(owner).toBeTruthy();
    expect(ownerHousehold.members.filter((member) => member.isActive)).toHaveLength(1);
    const ownerPlanningHeaders = { ...ownerAuth, 'x-household-id': householdId };

    const aiConfig = await page.request.post('/api/ai/configs', {
      headers: ownerAuth,
      data: {
        name: 'Proveedor integrado sintético',
        provider: 'custom',
        baseUrl: 'http://127.0.0.1:' + (providerAddress as { port: number }).port + '/v1',
        apiKey: 'synthetic-e2e-only',
        model: 'synthetic-household-planner',
        retryAttempts: 0,
        concurrency: 1
      }
    });
    await responseData<{ id: string }>(aiConfig, 201);

    const householdSettingsResponse = await page.request.patch('/api/household/meal-planning', {
      headers: ownerPlanningHeaders,
      data: {
        household: {
          objective: { goals: ['balanced'], notes: 'Objetivo común sintético.' },
          mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
          mealTimes: { lunch: '13:00' }
        }
      }
    });
    const initialSettings = await responseData<MealPlanningSettings>(householdSettingsResponse);
    expect(initialSettings.household).toMatchObject({
      objective: { goals: ['balanced'], notes: 'Objetivo común sintético.' },
      mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
      mealTimes: { lunch: '13:00' }
    });

    await page.goto('/household');
    const inviteLink = (await page.locator('.invite-card__code').innerText()).trim();
    const inviteCode = new URL(inviteLink, baseURL).pathname.split('/').filter(Boolean).at(-1);
    expect(inviteCode).toBeTruthy();

    await registerUser(memberPage, memberName);
    await expect(memberPage.locator('.no-household')).toBeVisible();
    await memberPage.getByRole('button', { name: /Unirse con código/i }).click();
    await memberPage.locator('input#inviteCode').fill(inviteCode!);
    const joinResponse = memberPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/household/join'
    );
    await memberPage.locator('app-modal .join-form button[type="submit"]').click();
    expect((await joinResponse).status()).toBe(200);
    await expect(memberPage.locator('.household-info__name')).toHaveText(householdName);

    const memberAuth = await bearerHeaders(memberPage);
    const memberHousehold = await readHousehold(memberPage, memberAuth);
    expect(memberHousehold.id).toBe(householdId);
    const activeMembers = memberHousehold.members.filter((member) => member.isActive);
    expect(activeMembers).toHaveLength(2);
    expect(new Set(activeMembers.map((member) => member.userId)).size).toBe(2);
    const member = activeMembers.find((candidate) => candidate.userId !== owner!.userId);
    expect(member).toMatchObject({
      name: memberName,
      role: 'member',
      permissions: { calendar: { view: true, edit: true }, settings: false }
    });
    const memberPlanningHeaders = { ...memberAuth, 'x-household-id': householdId };

    const tasteUpdate = await memberPage.request.patch('/api/auth/taste', {
      headers: memberAuth,
      data: {
        taste: {
          goals: ['weight-loss'],
          goalNotes: 'Preferencia personal sintética.',
          allergies: [],
          likes: [],
          dislikes: [],
          notes: ''
        },
        mealTimes: { breakfast: '09:00', lunch: '13:00', snack: '16:00', dinner: '19:00' },
        mealPlan: { breakfast: false, lunch: true, snack: false, dinner: false }
      }
    });
    expect((await tasteUpdate).status()).toBe(200);

    await memberPage.goto('/household?tab=tasks&planning=settings');
    const mealSettings = memberPage.locator('[data-test="meal-settings-content"]');
    await expect(mealSettings).toBeVisible();
    await expect(memberPage.locator('[data-test="member-goal-override"]')).toHaveAttribute(
      'aria-checked',
      'false'
    );
    await expect(memberPage.locator('[data-test="member-schedule-override"]')).toHaveAttribute(
      'aria-checked',
      'false'
    );

    const deniedHouseholdEdit = await memberPage.request.patch('/api/household/meal-planning', {
      headers: memberPlanningHeaders,
      data: { household: { objective: { notes: 'Este cambio no debe guardarse.' } } }
    });
    const deniedBody = JSON.parse(await deniedHouseholdEdit.text()) as {
      success: boolean;
      code: string;
    };
    expect(deniedHouseholdEdit.status()).toBe(403);
    expect(deniedBody).toMatchObject({ success: false, code: 'HOUSEHOLD_SETTINGS_REQUIRED' });

    await memberPage.locator('[data-test="member-goal-override"]').click();
    await memberPage.locator('[data-test="member-schedule-override"]').click();
    await expect(memberPage.locator('[data-test="member-lunch-time"]')).toHaveValue('13:00');
    await expect(memberPage.locator('[data-test="member-meal-lunch"] button')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    const overrideRequest = memberPage.waitForRequest(
      (request) =>
        request.method() === 'PATCH' && request.url().includes('/api/household/meal-planning')
    );
    const overrideResponse = memberPage.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes('/api/household/meal-planning')
    );
    await memberPage.locator('[data-test="meal-settings-save"] button').click();
    const overridePatch = (await overrideRequest).postDataJSON() as {
      member?: {
        goalOverrideEnabled?: boolean;
        scheduleOverrideEnabled?: boolean;
        schedule?: { mealTypes?: Record<string, boolean>; mealTimes?: Record<string, string> };
      };
    };
    expect((await overrideResponse).status()).toBe(200);
    expect(overridePatch.member).toMatchObject({
      goalOverrideEnabled: true,
      scheduleOverrideEnabled: true,
      schedule: {
        mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
        mealTimes: { lunch: '13:00' }
      }
    });
    await expect(
      memberPage
        .locator('[data-test="household-planning-panel-settings"]')
        .getByRole('status')
        .filter({ hasText: 'Guardado' })
    ).toBeVisible();

    const memberSettings = await responseData<MealPlanningSettings>(
      await memberPage.request.get('/api/household/meal-planning', {
        headers: memberPlanningHeaders
      })
    );
    expect(memberSettings).toMatchObject({
      household: { objective: { notes: 'Objetivo común sintético.' } },
      member: {
        goalOverrideEnabled: true,
        scheduleOverrideEnabled: true,
        personalObjective: { goals: ['weight-loss'] },
        personalSchedule: {
          mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
          mealTimes: { lunch: '13:00' }
        }
      },
      effective: {
        objective: { goals: ['weight-loss'], source: 'member' },
        schedule: { mealTypes: { lunch: true }, mealTimes: { lunch: '13:00' }, source: 'member' }
      }
    });
    const ownerSettings = await responseData<MealPlanningSettings>(
      await page.request.get('/api/household/meal-planning', { headers: ownerPlanningHeaders })
    );
    expect(ownerSettings.member.goalOverrideEnabled).toBe(false);
    expect(ownerSettings.member.scheduleOverrideEnabled).toBe(false);
    expect(ownerSettings.effective.objective.source).toBe('household');

    const weekStart = addDays(nextMonday(new Date().toISOString().slice(0, 10)), 7);
    await page.goto('/household?tab=tasks&planning=meals');
    await expect(page.locator('[data-test="household-planning-panel-meals"]')).toBeVisible();
    const weekInput = page.locator('[data-test="meal-proposal-week"]');
    await weekInput.fill(weekStart);
    await weekInput.dispatchEvent('change');
    await expect(weekInput).toHaveValue(weekStart);

    const proposalRequest = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        request.url().includes('/api/household/meal-planning/proposal')
    );
    const proposalResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/household/meal-planning/proposal')
    );
    await page.locator('[data-test="meal-proposal-generate"] button').click();
    const proposalInput = (await proposalRequest).postDataJSON() as {
      weekStart: string;
      householdMemberIds: string[];
    };
    expect(proposalInput).toMatchObject({
      weekStart,
      householdMemberIds: activeMembers.map((activeMember) => activeMember.id)
    });
    const proposalHttpResponse = await proposalResponse;
    const proposalBody = await responseData<{
      proposalId: string;
      recipes: Array<{
        alias: string;
        source: 'catalog' | 'new';
        recipeId: string | null;
        recipe: { name: string };
      }>;
      events: Array<{
        id: string;
        date: string;
        mealType: string;
        time: string | null;
        recipeAlias: string | null;
        participantAliases: string[];
        participantIds: string[];
        servings: number;
        objectiveSummary: string;
        status: 'scheduled' | 'unresolved';
        reason: string | null;
      }>;
    }>(proposalHttpResponse);
    expect(proposalBody.proposalId).toBeTruthy();
    expect(proposalBody.events.length).toBeGreaterThan(1);
    expect(proposalBody.events.some((event) => event.participantIds.length === 2)).toBe(true);
    expect(proposalBody.events.some((event) => event.participantIds.length === 1)).toBe(true);
    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0]?.background).toBe(true);
    expect(providerRequests[0]?.store).toBe(true);
    expect(providerRequests[0]?.text?.format).toMatchObject({
      type: 'json_schema',
      name: 'weekly_meal_proposal',
      strict: true
    });
    expect(readRequiredTurns(providerRequests[0] ?? {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: weekStart, mealType: expect.any(String) })
      ])
    );

    const review = page.locator('[data-test="meal-proposal-review"]');
    await expect(review).toBeVisible();
    await expect(review).toContainText('Compartida');
    const noEarlyCalendarWrite = await readCalendar(
      page,
      ownerAuth,
      weekStart,
      addDays(weekStart, 6)
    );
    expect(noEarlyCalendarWrite).toHaveLength(0);

    const confirmRequest = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        request.url().includes('/api/household/meal-planning/confirm')
    );
    const confirmResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/household/meal-planning/confirm')
    );
    await page.locator('[data-test="meal-proposal-confirm"] button').click();
    const submitted = (await confirmRequest).postDataJSON() as {
      proposalId: string;
      weekStart: string;
      householdMemberIds: string[];
      recipes: typeof proposalBody.recipes;
      events: Array<{
        id: string;
        date: string;
        mealType: string;
        time: string | null;
        recipeAlias: string | null;
        participantAliases: string[];
        participantIds: string[];
        servings: number;
        objectiveSummary: string;
        status: 'scheduled' | 'unresolved';
        reason: string | null;
      }>;
    };
    expect(submitted.proposalId).toBe(proposalBody.proposalId);
    expect(submitted.weekStart).toBe(weekStart);
    expect(submitted.householdMemberIds).toEqual(proposalInput.householdMemberIds);
    expect(submitted.recipes).toEqual(proposalBody.recipes);
    const confirmation = await confirmResponse;
    const confirmationData = await responseData<{
      idempotent: boolean;
      events: Array<{ id: string; participantIds: string[] }>;
    }>(confirmation);
    expect(confirmationData.idempotent).toBe(false);
    expect(confirmationData.events).toHaveLength(submitted.events.length);
    await expect(page.getByText(/comidas añadidas al calendario/i)).toBeVisible();

    const confirmationReplay = await page.request.post('/api/household/meal-planning/confirm', {
      headers: ownerPlanningHeaders,
      data: submitted
    });
    const replayData = await responseData<{ idempotent: boolean; events: CalendarMeal[] }>(
      confirmationReplay
    );
    expect(replayData.idempotent).toBe(true);

    const weekEnd = addDays(weekStart, 6);
    const ownerCalendar = await readCalendar(page, ownerAuth, weekStart, weekEnd);
    const memberCalendar = await readCalendar(memberPage, memberAuth, weekStart, weekEnd);
    expect(ownerCalendar).toHaveLength(submitted.events.length);
    expect(memberCalendar).toHaveLength(submitted.events.length);
    expect(ownerCalendar.every((meal) => meal.isShared)).toBe(true);
    expect(memberCalendar.every((meal) => meal.isShared)).toBe(true);
    const confirmedKeys = submitted.events
      .map((event) =>
        eventKey({
          date: event.date,
          mealType: event.mealType,
          time: event.time,
          recipeName:
            submitted.recipes.find((recipe) => recipe.alias === event.recipeAlias)?.recipe.name ??
            '',
          servings: event.servings,
          participantIds: event.participantIds
        })
      )
      .sort();
    const calendarKeys = (meals: CalendarMeal[]) =>
      meals
        .map((meal) =>
          eventKey({
            date: meal.date,
            mealType: meal.meal_type,
            time: meal.time,
            recipeName: meal.recipe_name,
            servings: meal.servings,
            participantIds: meal.participantIds
          })
        )
        .sort();
    expect(calendarKeys(ownerCalendar)).toEqual(confirmedKeys);
    expect(calendarKeys(memberCalendar)).toEqual(confirmedKeys);

    await page.goto('/calendar?view=week&date=' + weekStart);
    const ownerTitles = page.locator('[data-test="timeline-block-meal"] .tl__block-title');
    await expect(ownerTitles).toHaveCount(submitted.events.length);
    expect((await ownerTitles.allTextContents()).map((title) => title.trim()).sort()).toEqual(
      ownerCalendar.map((meal) => meal.recipe_name).sort()
    );
    await ownerTitles.first().scrollIntoViewIfNeeded();
    await captureSyntheticScreen(page, testInfo.project.name, 'calendar-owner');

    await memberPage.goto('/calendar?view=week&date=' + weekStart);
    const memberTitles = memberPage.locator('[data-test="timeline-block-meal"] .tl__block-title');
    await expect(memberTitles).toHaveCount(submitted.events.length);
    expect((await memberTitles.allTextContents()).map((title) => title.trim()).sort()).toEqual(
      memberCalendar.map((meal) => meal.recipe_name).sort()
    );

    const individualForMember = memberCalendar.find(
      (meal) => meal.participantIds.length === 1 && meal.participantIds[0] === member!.userId
    );
    expect(individualForMember).toBeTruthy();
    const consumptionPath =
      '/api/household/meal-planning/meals/' +
      encodeURIComponent(individualForMember!.id) +
      '/consumption';
    const memberConsumption = await responseData<{
      status: string;
      servings: number | null;
      version: number;
    }>(await memberPage.request.get(consumptionPath, { headers: memberPlanningHeaders }));
    expect(memberConsumption).toMatchObject({ status: 'unrecorded', servings: null, version: 0 });
    const unassignedConsumption = await page.request.get(consumptionPath, {
      headers: ownerPlanningHeaders
    });
    const unassignedBody = JSON.parse(await unassignedConsumption.text()) as {
      success: boolean;
      code: string;
    };
    expect(unassignedConsumption.status()).toBe(403);
    expect(unassignedBody).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_MEAL_PARTICIPANT_REQUIRED'
    });

    const targetColumn = memberPage.locator(
      '[data-test="timeline-col"][data-date="' + individualForMember!.date + '"]'
    );
    const targetBlock = targetColumn
      .locator('button[data-test="timeline-block-meal"]')
      .filter({ hasText: individualForMember!.recipe_name });
    await expect(targetBlock).toBeVisible();
    await targetBlock.scrollIntoViewIfNeeded();
    await targetBlock.click();
    const consumptionDialog = memberPage.getByRole('dialog', { name: 'Registrar consumo' });
    await expect(consumptionDialog).toBeVisible();
    await consumptionDialog.getByLabel('Raciones realmente servidas').fill('2');
    const consumptionWrite = memberPage.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().endsWith('/consumption')
    );
    await consumptionDialog.locator('[data-test="meal-consumption-save"]').click();
    const consumptionResponse = await consumptionWrite;
    expect(consumptionResponse.status(), await consumptionResponse.text()).toBe(200);
    expect(consumptionResponse.request().postDataJSON()).toEqual({
      status: 'realized',
      servings: 2,
      expectedVersion: 0
    });
    await expect(consumptionDialog.getByText('Consumo guardado.')).toBeVisible();
    const savedConsumption = await responseData<{
      status: string;
      servings: number | null;
      version: number;
    }>(await memberPage.request.get(consumptionPath, { headers: memberPlanningHeaders }));
    expect(savedConsumption).toMatchObject({ status: 'realized', servings: 2, version: 1 });
    await consumptionDialog.locator('.modal__close').click();

    const shoppingHeaders = ownerPlanningHeaders;
    const readLists = async () =>
      responseData<Array<{ id: string }>>(
        await page.request.get('/api/shopping/lists?status=active', { headers: shoppingHeaders })
      );
    const readPantrySnapshot = async () => {
      const data = await responseData<{
        ingredients: Array<{ id: string; name: string; quantity: number; unit: string }>;
      }>(
        await page.request.get('/api/pantry/ingredients?pageSize=100', {
          headers: shoppingHeaders
        })
      );
      return data.ingredients
        .map(({ id, name, quantity, unit }) => ({ id, name, quantity, unit }))
        .sort((left, right) => left.id.localeCompare(right.id));
    };
    const pantryBefore = await readPantrySnapshot();
    expect(await readLists()).toHaveLength(0);

    await page.goto('/household?tab=tasks&planning=meals');
    const shoppingTab = page.locator('[data-test="meal-proposal-step-tab-shopping"]');
    await expect(shoppingTab).toBeVisible();
    await shoppingTab.click();
    const shoppingPanel = page.locator('[data-test="meal-shopping-step-panel"]');
    await expect(shoppingPanel).toBeVisible();
    const quantityInput = page.locator('[data-test="meal-shopping-quantity"]');
    await expect(quantityInput).toHaveCount(1);
    const originalQuantity = Number(await quantityInput.inputValue());
    expect(originalQuantity).toBeGreaterThan(0);

    await quantityInput.fill(String(originalQuantity + 10));
    await page.locator('[data-test="meal-shopping-cancel"] button').click();
    await expect(shoppingPanel).toBeHidden();
    expect(await readLists()).toHaveLength(0);
    expect(await readPantrySnapshot()).toEqual(pantryBefore);

    await shoppingTab.click();
    await expect(shoppingPanel).toBeVisible();
    await expect(quantityInput).toHaveValue(String(originalQuantity));
    await quantityInput.fill(String(originalQuantity + 10));
    const approvalRequest = page.waitForRequest(
      (request) =>
        request.method() === 'POST' && request.url().includes('/api/shopping/meal-plan/approve')
    );
    const approvalResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/shopping/meal-plan/approve')
    );
    await page.locator('[data-test="meal-shopping-approve"] button').click();
    const approvalBody = (await approvalRequest).postDataJSON() as Record<string, unknown>;
    expect((await approvalResponse).status()).toBe(201);
    await expect(page.locator('.meal-planner__shopping-success')).toContainText(/lista de compra/i);
    const lists = await readLists();
    expect(lists).toHaveLength(1);
    const listId = lists[0]!.id;
    const approvedList = await responseData<ShoppingList>(
      await page.request.get('/api/shopping/lists/' + listId, { headers: shoppingHeaders })
    );
    expect(approvedList.items).toHaveLength(1);
    const approvedLine = approvedList.items[0]!;
    expect(approvedLine).toMatchObject({
      name: ingredientName,
      quantity: originalQuantity + 10,
      unit: 'g',
      source: 'meal_plan'
    });

    const approvalReplay = await page.request.post('/api/shopping/meal-plan/approve', {
      headers: shoppingHeaders,
      data: approvalBody
    });
    const replayApprovalData = await responseData<{ idempotent: boolean }>(approvalReplay);
    expect(replayApprovalData.idempotent).toBe(true);
    const finalList = await responseData<ShoppingList>(
      await page.request.get('/api/shopping/lists/' + listId, { headers: shoppingHeaders })
    );
    expect(finalList.items).toHaveLength(1);
    expect(finalList.items[0]).toMatchObject({
      id: approvedLine.id,
      name: ingredientName,
      quantity: originalQuantity + 10,
      source: 'meal_plan'
    });
    expect(await readPantrySnapshot()).toEqual(pantryBefore);

    const scheduleTarget = madridScheduleDay(4);
    await page.goto('/household?tab=tasks&planning=settings');
    const automationPanel = page.locator('[data-test="planning-automation-settings"]');
    await expect(automationPanel).toBeVisible();
    const automationBefore = await readAutomation(page, ownerPlanningHeaders);
    expect(automationBefore).toMatchObject({ enabled: false, lastRun: null, nextRun: null });

    const generateMode = automationPanel.locator('[data-test="planning-automation-mode-generate"]');
    await generateMode.focus();
    await generateMode.press('Space');
    await expect(generateMode).toBeChecked();
    await automationPanel.locator('[data-test="planning-automation-scope-meals"]').check();
    const weekdayPicker = automationPanel.locator(
      '[data-test="planning-automation-weekday"] button'
    );
    await weekdayPicker.focus();
    await page.keyboard.press('ArrowDown');
    const weekdayList = automationPanel.getByRole('listbox', { name: 'Día de la semana' });
    await expect(weekdayList).toBeVisible();
    for (let index = 0; index < scheduleTarget.weekday - 1; index += 1) {
      await page.keyboard.press('ArrowDown');
    }
    await page.keyboard.press('Enter');
    await automationPanel.locator('[data-test="planning-automation-local-time"]').fill('23:50');
    await automationPanel
      .locator('[data-test="planning-automation-time-zone"]')
      .fill('Europe/Madrid');

    const automationSave = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes('/api/household/planning-automation')
    );
    await automationPanel.locator('[data-test="planning-automation-save"] button').click();
    expect((await automationSave).status()).toBe(200);
    await expect(
      automationPanel.getByRole('status').filter({ hasText: 'Configuración guardada' })
    ).toBeVisible();
    const savedPaused = await readAutomation(page, ownerPlanningHeaders);
    expect(savedPaused).toMatchObject({
      enabled: false,
      mode: 'generate',
      scopes: ['meals'],
      weekday: scheduleTarget.weekday,
      localTime: '23:50',
      timeZone: 'Europe/Madrid',
      nextRun: null,
      lastRun: null
    });

    const resumeAutomation = page.getByRole('button', {
      name: 'Reanudar planificación automática'
    });
    const resumeButtonHit = await resumeAutomation.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const bounds = (element: Element | null) => {
        if (!element) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        buttonHit: hit === button || button.contains(hit),
        hitTarget:
          hit?.tagName.toLowerCase() + (hit instanceof HTMLElement ? `.${hit.className}` : ''),
        button: bounds(button),
        assistantHost: bounds(document.querySelector('app-ai-action-assistant-launcher')),
        assistantButton: bounds(document.querySelector('[data-test="ai-assistant-open"]'))
      };
    });
    expect(resumeButtonHit.buttonHit, JSON.stringify(resumeButtonHit)).toBe(true);
    await resumeAutomation.click();
    await expect
      .poll(async () => (await readAutomation(page, ownerPlanningHeaders)).enabled)
      .toBe(true);
    const savedEnabled = await readAutomation(page, ownerPlanningHeaders);
    expect(savedEnabled).toMatchObject({
      enabled: true,
      mode: 'generate',
      scopes: ['meals'],
      weekday: scheduleTarget.weekday,
      localTime: '23:50',
      timeZone: 'Europe/Madrid',
      lastRun: null
    });
    expect(savedEnabled.nextRun).toMatchObject({
      localDate: scheduleTarget.date,
      localTime: '23:50',
      timeZone: 'Europe/Madrid'
    });
    expect(Date.parse(savedEnabled.nextRun!.utcInstant)).toBeGreaterThan(
      Date.now() + 48 * 60 * 60 * 1000
    );
    await page.waitForTimeout(1_000);
    expect(providerRequests).toHaveLength(1);
    expect(await readCalendar(page, ownerAuth, weekStart, weekEnd)).toHaveLength(
      submitted.events.length
    );
    await automationPanel.scrollIntoViewIfNeeded();
    await captureSyntheticScreen(page, testInfo.project.name, 'automation-saved');
  } finally {
    await memberContext.close().catch(() => undefined);
    await new Promise<void>((resolveClose, rejectClose) =>
      provider.close((error) => (error ? rejectClose(error) : resolveClose()))
    );
  }
});
