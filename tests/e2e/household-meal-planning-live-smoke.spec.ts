import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { createHousehold, registerUser } from './helpers/auth';

const TOKEN_KEY = 'hogar:v1:auth_token';
const AI_LIVE_SMOKE_KEY_MARKER = '__HOGARIA_AI_REAL_SMOKE_PROVIDER_KEY__';
const MODE_ENABLED =
  process.env.HOGARIA_AI_REAL_SMOKE === '1' &&
  process.env.HOGARIA_AI_REAL_SMOKE_RUNNER === '1' &&
  process.env.HOGARIA_AI_REAL_SMOKE_HOUSEHOLD_MEAL_ONLY === '1';
const HOUSEHOLD_NAME = 'HogarIA smoke hogar';
const MEMBER_NAMES = ['HogarIA miembro QA uno', 'HogarIA miembro QA dos'] as const;
function smokeSetting(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid isolated household meal smoke setting: ${name}`);
  }
  return value;
}

const LIVE_RECIPE_MAX_TOKENS = smokeSetting('HOGARIA_AI_REAL_SMOKE_RECIPE_MAX_TOKENS', 4096);
const LIVE_CONFIG_TIMEOUT_MS = smokeSetting('HOGARIA_AI_REAL_SMOKE_CONFIG_TIMEOUT_MS', 240_000);
const LIVE_REQUEST_TIMEOUT_MS = smokeSetting('HOGARIA_AI_REAL_SMOKE_REQUEST_TIMEOUT_MS', 270_000);
const LIVE_SMOKE_PHASE_FILE = process.env.E2E_RUN_DIR
  ? join(process.env.E2E_RUN_DIR, 'ai-live-smoke-phase')
  : undefined;

test.skip(!MODE_ENABLED, 'El smoke real solo se ejecuta desde su coordinador aislado opt-in.');

interface ActiveMember {
  id: string;
  userId: string;
  isActive: boolean;
}

interface MealProposalEvent {
  date: string;
  mealType: string;
  time: string | null;
  participantIds: string[];
  servings: number;
  status: string;
  recipe: { name: string } | null;
}

interface CalendarRange {
  data: { meals: unknown[] };
}

function phase(value: string): void {
  if (!LIVE_SMOKE_PHASE_FILE) return;
  try {
    writeFileSync(LIVE_SMOKE_PHASE_FILE, value, 'utf8');
  } catch {
    // Progress breadcrumbs are optional and must not affect the isolated smoke.
  }
}

function weekStartMonday(): string {
  const now = new Date();
  const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
  const nextMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilMonday);
  return nextMonday.toISOString().slice(0, 10);
}

async function tokenFrom(page: Parameters<typeof registerUser>[0]): Promise<string> {
  const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'La E2E debe usar una sesión temporal propia.').toBeTruthy();
  return token!;
}

async function configureTaste(page: import('@playwright/test').Page, token: string, member: 0 | 1) {
  const preferences =
    member === 0
      ? { likes: ['tofu'], dislikes: ['pollo'] }
      : { likes: ['pollo'], dislikes: ['tofu'] };
  const response = await page.request.patch('/api/auth/taste', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      taste: {
        goals: ['balanced'],
        goalNotes: '',
        allergies: [],
        ...preferences,
        notes: ''
      }
    }
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function readCalendarMeals(
  page: import('@playwright/test').Page,
  headers: Record<string, string>,
  weekStart: string,
  weekEnd: string
): Promise<unknown[]> {
  const response = await page.request.get('/api/calendar/range', {
    headers,
    params: { startDate: weekStart, endDate: weekEnd }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as CalendarRange).data.meals;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Seeds only through existing APIs against the runner's isolated server/database. The prior
 * calendar is confirmed through the non-AI confirmation endpoint; no proposal/provider request is
 * made here. Confirmation requires complete eligible-slot coverage, so all seven prior-week
 * lunches are synthetic and explicitly assigned to P1/P2.
 */
async function seedSmokePlanningContext(
  page: import('@playwright/test').Page,
  ownerHeaders: Record<string, string>,
  householdHeaders: Record<string, string>,
  activeMembers: ActiveMember[],
  targetWeekStart: string
): Promise<{ previousWeekStart: string; previousWeekEnd: string }> {
  const pantry = await page.request.post('/api/pantry/ingredients', {
    headers: ownerHeaders,
    data: {
      name: 'SMOKE_PANTRY_RICE',
      category: 'other',
      quantity: 500,
      unit: 'g',
      location: 'pantry'
    }
  });
  expect(pantry.status(), await pantry.text()).toBe(201);

  const utensil = await page.request.post('/api/pantry/utensils', {
    headers: ownerHeaders,
    data: { name: 'SMOKE_UTENSIL_POT', category: 'cookware', available: true }
  });
  expect(utensil.status(), await utensil.text()).toBe(201);

  const recipe = await page.request.post('/api/recipes', {
    headers: ownerHeaders,
    data: {
      name: 'SMOKE_RECIPE_TEST',
      description: 'Receta sintética accesible para el smoke de planificación.',
      difficulty: 'easy',
      totalTime: 15,
      prepTime: 5,
      cookTime: 10,
      servings: 2,
      ingredients: [{ name: 'SMOKE_PANTRY_RICE', quantity: 80, unit: 'g' }],
      utensils: ['SMOKE_UTENSIL_POT'],
      steps: [{ stepNumber: 1, instruction: 'Cocer el arroz sintético.' }]
    }
  });
  expect(recipe.status(), await recipe.text()).toBe(201);

  const previousWeekStart = addDays(targetWeekStart, -7);
  const previousWeekEnd = addDays(previousWeekStart, 6);
  expect(previousWeekEnd).toBe(addDays(targetWeekStart, -1));
  expect(activeMembers).toHaveLength(2);
  const events = Array.from({ length: 7 }, (_, day) => ({
    id: `smoke-previous-meal-${day + 1}`,
    date: addDays(previousWeekStart, day),
    mealType: 'lunch',
    time: '13:00',
    recipe: {
      name: 'SMOKE_PREVIOUS_MEAL',
      description: 'Comida sintética de la semana anterior.',
      baseServings: 1,
      prepTimeMinutes: 5,
      cookTimeMinutes: 10,
      ingredients: [
        {
          name: 'SMOKE_PANTRY_RICE',
          quantity: 80,
          unit: 'g',
          preparation: null,
          isOptional: false,
          notes: null
        }
      ],
      instructions: ['Cocer arroz sintético.']
    },
    participantAliases: ['P1', 'P2'],
    servings: activeMembers.length,
    objectiveSummary: 'Comida equilibrada.',
    status: 'scheduled',
    reason: null
  }));
  const confirmation = await page.request.post('/api/household/meal-planning/confirm', {
    headers: { ...householdHeaders, 'content-type': 'application/json' },
    data: {
      proposalId: 'smoke-previous-plan',
      weekStart: previousWeekStart,
      householdMemberIds: activeMembers.map((member) => member.id),
      events
    }
  });
  expect(confirmation.status(), await confirmation.text()).toBe(200);
  const confirmed = (await confirmation.json()) as {
    success: boolean;
    data: { weekStart: string; idempotent: boolean; events: unknown[] };
  };
  expect(confirmed).toMatchObject({
    success: true,
    data: { weekStart: previousWeekStart, idempotent: false }
  });
  expect(confirmed.data.events).toHaveLength(7);

  return { previousWeekStart, previousWeekEnd };
}

test('envía una propuesta semanal compartida al proveedor y no la persiste antes de confirmar', async ({
  page,
  browser
}) => {
  phase('household-start');
  await registerUser(page, MEMBER_NAMES[0]);
  await createHousehold(page, HOUSEHOLD_NAME);
  const ownerToken = await tokenFrom(page);
  const ownerHeaders = { authorization: `Bearer ${ownerToken}` };

  const householdResponse = await page.request.get('/api/household', { headers: ownerHeaders });
  expect(householdResponse.ok(), await householdResponse.text()).toBeTruthy();
  const householdBody = (await householdResponse.json()) as {
    data: { id: string; inviteCode: string; members: ActiveMember[] };
  };
  const { id: householdId, inviteCode } = householdBody.data;
  expect(householdId).toBeTruthy();
  expect(inviteCode).toMatch(/^[A-Z0-9_-]{8,}$/);

  const memberPage = await browser.newPage({ locale: 'es-ES' });
  try {
    await registerUser(memberPage, MEMBER_NAMES[1]);
    const memberToken = await tokenFrom(memberPage);
    const memberHeaders = { authorization: `Bearer ${memberToken}` };
    const join = await memberPage.request.post(
      `/api/household/join/${encodeURIComponent(inviteCode)}`,
      { headers: memberHeaders }
    );
    expect(join.ok(), await join.text()).toBeTruthy();
    phase('household-ready');

    const model = process.env.HOGARIA_AI_REAL_SMOKE_MODEL;
    const proxyUrl = process.env.HOGARIA_AI_REAL_SMOKE_PROXY_URL;
    expect(model).toBe('gpt-5');
    expect(proxyUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    const configResponse = await page.request.post('/api/ai/configs', {
      headers: ownerHeaders,
      data: {
        name: 'Smoke aislado de planificación de comidas',
        provider: 'custom',
        baseUrl: proxyUrl,
        apiKey: AI_LIVE_SMOKE_KEY_MARKER,
        model,
        maxTokens: LIVE_RECIPE_MAX_TOKENS,
        timeout: LIVE_CONFIG_TIMEOUT_MS,
        retryAttempts: 0,
        concurrency: 1
      }
    });
    expect(configResponse.status(), await configResponse.text()).toBe(201);
    const config = (await configResponse.json()) as {
      data?: { id?: string; retryAttempts?: number; concurrency?: number; isActive?: boolean };
    };
    expect(config.data?.id).toBeTruthy();
    expect(config.data).toMatchObject({ retryAttempts: 0, concurrency: 1, isActive: true });
    const modelSettings = await page.request.patch(`/api/ai/configs/${config.data!.id}`, {
      headers: ownerHeaders,
      data: {
        temperature: null,
        maxTokens: LIVE_RECIPE_MAX_TOKENS,
        timeout: LIVE_CONFIG_TIMEOUT_MS,
        retryAttempts: 0,
        concurrency: 1
      }
    });
    expect(modelSettings.ok(), await modelSettings.text()).toBeTruthy();

    const householdSettings = await page.request.patch('/api/household/meal-planning', {
      headers: { ...ownerHeaders, 'x-household-id': householdId },
      data: {
        household: {
          objective: { goals: ['balanced'], notes: 'Comidas variadas para el hogar.' },
          mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
          mealTimes: { lunch: '13:00' }
        },
        member: { goalOverrideEnabled: false, scheduleOverrideEnabled: false }
      }
    });
    expect(householdSettings.ok(), await householdSettings.text()).toBeTruthy();
    const memberSettings = await memberPage.request.patch('/api/household/meal-planning', {
      headers: { ...memberHeaders, 'x-household-id': householdId },
      data: { member: { goalOverrideEnabled: false, scheduleOverrideEnabled: false } }
    });
    expect(memberSettings.ok(), await memberSettings.text()).toBeTruthy();

    await configureTaste(page, ownerToken, 0);
    await configureTaste(memberPage, memberToken, 1);
    phase('profiles-ready');

    const membersResponse = await page.request.get('/api/household', { headers: ownerHeaders });
    expect(membersResponse.ok(), await membersResponse.text()).toBeTruthy();
    const membersBody = (await membersResponse.json()) as {
      data: { id: string; members: Array<ActiveMember & { name: string }> };
    };
    expect(membersBody.data.id).toBe(householdId);
    const activeMembers = membersBody.data.members.filter((member) => member.isActive);
    expect(activeMembers).toHaveLength(2);
    const householdHeaders = { ...ownerHeaders, 'x-household-id': householdId };
    const start = weekStartMonday();
    const end = addDays(start, 6);
    const previousPlan = await seedSmokePlanningContext(
      page,
      ownerHeaders,
      householdHeaders,
      activeMembers,
      start
    );
    expect(previousPlan.previousWeekEnd).toBe(addDays(start, -1));
    expect(await readCalendarMeals(page, householdHeaders, start, end)).toHaveLength(0);
    phase('calendar-empty');

    const proposalResponse = await page.request.post('/api/household/meal-planning/proposal', {
      headers: { ...householdHeaders, 'content-type': 'application/json' },
      data: { weekStart: start, householdMemberIds: activeMembers.map((member) => member.id) },
      timeout: LIVE_REQUEST_TIMEOUT_MS
    });
    phase('proposal-returned');
    expect(proposalResponse.status(), await proposalResponse.text()).toBe(200);
    const result = (await proposalResponse.json()) as {
      success: boolean;
      data: {
        proposalId: string;
        weekStart: string;
        participants: Array<{ alias: string; householdMemberId: string }>;
        events: MealProposalEvent[];
      };
    };
    expect(result.success).toBe(true);
    expect(result.data.proposalId).toBeTruthy();
    expect(result.data.weekStart).toBe(start);
    expect(result.data.participants).toHaveLength(2);
    expect(new Set(result.data.participants.map((participant) => participant.alias))).toEqual(
      new Set(['P1', 'P2'])
    );
    expect(result.data.events.length).toBeGreaterThan(0);

    const selectedUsers = activeMembers.map((member) => member.userId).sort();
    const assigned = new Set<string>();
    for (const event of result.data.events) {
      const slotKey = `${event.date}|${event.mealType}|${event.time ?? ''}`;
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(event.mealType).toBe('lunch');
      for (const participantId of event.participantIds) {
        const assignmentKey = `${slotKey}|${participantId}`;
        expect(assigned.has(assignmentKey), 'No duplicar una persona en el mismo turno.').toBe(
          false
        );
        assigned.add(assignmentKey);
      }
    }
    const expectedDates = Array.from({ length: 7 }, (_, day) =>
      new Date(Date.parse(`${start}T00:00:00.000Z`) + day * 86_400_000).toISOString().slice(0, 10)
    );
    expect(assigned.size).toBe(14);
    expect([...new Set(result.data.events.map((event) => event.date))].sort()).toEqual(
      expectedDates
    );
    for (const date of expectedDates) {
      const participantIds = result.data.events
        .filter((event) => event.date === date)
        .flatMap((event) => event.participantIds)
        .sort();
      expect(participantIds).toEqual(selectedUsers);
    }
    expect(
      result.data.events.some(
        (event) =>
          [...event.participantIds].sort().join('|') === selectedUsers.join('|') &&
          event.servings === selectedUsers.length &&
          event.status === 'scheduled' &&
          event.recipe?.name
      ),
      'Los gustos distintos son blandos: al menos un turno debe quedar compartido y seguro.'
    ).toBe(true);

    const finalCalendar = await readCalendarMeals(page, householdHeaders, start, end);
    expect(finalCalendar).toHaveLength(0);
    phase('calendar-still-empty');
  } finally {
    await memberPage.close();
  }
});
