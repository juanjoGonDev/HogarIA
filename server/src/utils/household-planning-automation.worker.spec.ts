import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMealProposalResponseFormat } from '../schemas/household-meal-proposal.schema.js';
import { HOUSEHOLD_TASK_PROPOSAL_RESPONSE_FORMAT } from '../schemas/household-task-proposal.schema.js';
import type { AiMessage } from './ai-client.js';
import { AiCallError } from './ai-client.js';
import type { AiResponseFormat } from '../schemas/ai-response-format.js';
import { nextHouseholdWeeklyOccurrence } from './household-weekly-schedule.js';
import type { HouseholdWeeklySchedule } from './household-weekly-schedule.js';
import { persistSharedMeals } from './shared-meal-calendar.store.js';
import {
  retryHouseholdPlanningAutomationRun,
  runHouseholdPlanningAutomationOccurrence,
  startHouseholdPlanningAutomationRetry
} from './household-planning-automation.worker.js';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type Mode = 'generate' | 'repeat';
type Scope = 'tasks' | 'meals';

const HOUSEHOLD_ID = 'automation-home';
const SCHEDULE: HouseholdWeeklySchedule = {
  weekday: 1,
  localTime: '09:30',
  timeZone: 'Europe/Madrid'
};
const OCCURRENCE = nextHouseholdWeeklyOccurrence(SCHEDULE, new Date('2026-10-12T06:30:00.000Z'));
const RUN_NOW = new Date('2026-10-12T08:00:00.000Z');
const TARGET_WEEK = '2026-10-19';

let db: Sql;
let closeDatabase: () => void;
let automationStore: typeof import('./household-planning-automation.store.js');
let automationRuns: typeof import('./household-planning-automation-runs.store.js');

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function mealProposal(weekStart = TARGET_WEEK): string {
  return JSON.stringify({
    newRecipes: [
      {
        alias: 'N1',
        recipe: {
          name: 'Arroz del día',
          description: 'Plato sintético de prueba',
          difficulty: 'easy',
          cuisine: 'española',
          totalTime: 30,
          prepTime: 10,
          cookTime: 20,
          restTime: null,
          baseServings: 1,
          calories: null,
          ingredients: [
            {
              name: 'arroz',
              quantity: 80,
              unit: 'g',
              preparation: null,
              isOptional: false,
              substitutes: [],
              notes: null
            }
          ],
          utensils: ['olla'],
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
                instruction: 'Cocer el arroz.',
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
                instruction: 'Cocer el arroz y controlar el agua.',
                duration: 20,
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
                instruction: 'Cocer el arroz hasta su punto.',
                duration: 20,
                temperature: null,
                timerRequired: true,
                timerDuration: 20,
                tips: null,
                warning: null,
                illustration: null
              }
            ]
          },
          nutrition: null,
          storage: null,
          tags: ['sintética']
        }
      }
    ],
    events: Array.from({ length: 7 }, (_, day) => ({
      date: addDays(weekStart, day),
      mealType: 'lunch',
      time: '13:00',
      recipeAlias: 'N1',
      participantAliases: ['P1', 'P2'],
      servings: 2,
      objectiveSummary: 'Plato compartido de prueba.',
      status: 'scheduled',
      reason: null
    }))
  });
}

function unresolvedMealProposal(): string {
  const parsed = JSON.parse(mealProposal()) as {
    events: Array<Record<string, unknown>>;
  };
  parsed.events[0] = {
    ...parsed.events[0],
    recipeAlias: null,
    servings: 0,
    status: 'unresolved',
    reason: 'No se pudo resolver la receta.'
  };
  return JSON.stringify(parsed);
}

const recipeSnapshot = {
  name: 'Paella de prueba',
  description: 'Comida sintética para repetir.',
  baseServings: 1 as const,
  times: { prepTimeMinutes: 10, cookTimeMinutes: 20 },
  ingredients: [{ name: 'arroz', quantity: 80, unit: 'g' }],
  instructions: ['Cocer el arroz.']
};

function addHousehold(): void {
  db.prepare(
    `INSERT INTO households (id, name, invite_code, meal_planning_preferences)
     VALUES (?, ?, ?, ?)`
  ).run(
    HOUSEHOLD_ID,
    'Casa sintética',
    'AUTOMATION-TEST',
    JSON.stringify({
      objective: { goals: ['balanced'], notes: '' },
      mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
      mealTimes: { breakfast: '09:00', lunch: '13:00', snack: '17:00', dinner: '20:30' }
    })
  );
  addMember('alice', {
    settings: true,
    calendar: { view: true, edit: true }
  });
  addMember('bob', { calendar: { view: true, edit: false } });
}

function addMember(
  userId: string,
  permissions: { settings?: boolean; calendar?: { view?: boolean; edit?: boolean } }
): void {
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, household_id, preferences)
     VALUES (?, ?, ?, 'synthetic-hash', ?, ?)`
  ).run(
    userId,
    `${userId}@hogaria.test`,
    `Nombre privado ${userId}`,
    HOUSEHOLD_ID,
    JSON.stringify({ taste: { goals: ['balanced'], allergies: [], likes: [], dislikes: [] } })
  );
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, permissions)
     VALUES (?, ?, ?, 'member', ?)`
  ).run(`membership-${userId}`, HOUSEHOLD_ID, userId, JSON.stringify(permissions));
}

function addAiConfig(): void {
  db.prepare(
    `INSERT INTO ai_configs
      (id, user_id, household_id, name, provider, base_url, api_key, model, is_active)
     VALUES ('synthetic-ai', 'alice', ?, 'Synthetic', 'custom',
      'https://provider.invalid/v1', 'never-used-secret', 'synthetic-model', 1)`
  ).run(HOUSEHOLD_ID);
}

function addCurrentPlan(): void {
  const plan = {
    schemaVersion: 1,
    dwellingType: 'apartment',
    dwellingTypeLabel: null,
    summary: '',
    warnings: [],
    floors: [
      {
        id: 'floor-0',
        name: 'Planta baja',
        level: 0,
        walls: [],
        openings: [],
        spaces: [
          {
            id: 'kitchen',
            kind: 'kitchen',
            label: 'Cocina',
            polygon: [
              { x: 100, y: 100 },
              { x: 900, y: 100 },
              { x: 900, y: 900 },
              { x: 100, y: 900 }
            ],
            parentSpaceId: null
          }
        ]
      }
    ]
  };
  db.prepare(
    `INSERT INTO household_plans (household_id, version, plan_json, updated_by)
     VALUES (?, 1, ?, 'alice')`
  ).run(HOUSEHOLD_ID, JSON.stringify(plan));
}

function configureAutomation(mode: Mode = 'generate', scopes: Scope[] = ['tasks', 'meals']): void {
  const result = automationStore.saveHouseholdPlanningAutomation(
    db,
    HOUSEHOLD_ID,
    'alice',
    {
      expectedVersion: 0,
      enabled: true,
      mode,
      scopes,
      weekday: SCHEDULE.weekday,
      localTime: SCHEDULE.localTime,
      timeZone: SCHEDULE.timeZone
    },
    RUN_NOW
  );
  expect(result.status).toBe('saved');
}

function baseInput(now = RUN_NOW) {
  return {
    db,
    householdId: HOUSEHOLD_ID,
    workerId: 'automation-test-worker',
    occurrence: OCCURRENCE,
    now
  };
}

function providerForGeneratedPlans() {
  return vi.fn(async (_messages: AiMessage[], responseFormat: AiResponseFormat) => {
    if (responseFormat.json_schema.name === 'household_task_proposal') {
      return JSON.stringify({
        tasks: [
          { title: 'Limpiar la encimera', scheduledDate: TARGET_WEEK, spaceId: 'kitchen' },
          {
            title: 'Sacar reciclaje',
            scheduledDate: addDays(TARGET_WEEK, 2),
            spaceId: null
          }
        ]
      });
    }
    return mealProposal();
  });
}

describe('household planning automation worker', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    automationStore = await import('./household-planning-automation.store.js');
    automationRuns = await import('./household-planning-automation-runs.store.js');
    await database.initializeDatabase();
    db = database.getDatabase();
    closeDatabase = database.closeDatabase;
  });

  afterAll(() => closeDatabase?.());

  beforeEach(() => {
    db.prepare('DELETE FROM household_planning_automation_runs').run();
    db.prepare('DELETE FROM household_task_weeks').run();
    db.prepare('DELETE FROM meal_participants').run();
    db.prepare('DELETE FROM meals').run();
    db.prepare("DELETE FROM recipes WHERE id LIKE 'ai_%'").run();
    db.prepare('DELETE FROM weekly_calendars').run();
    db.prepare('DELETE FROM calendar_event_attendees').run();
    db.prepare('DELETE FROM calendar_events').run();
    db.prepare('DELETE FROM household_planning_automations').run();
    db.prepare('DELETE FROM household_plans').run();
    db.prepare('DELETE FROM ai_configs').run();
    db.prepare('UPDATE users SET household_id = NULL').run();
    db.prepare('DELETE FROM household_members').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM households').run();
    addHousehold();
    addAiConfig();
  });

  it('generates both scopes with strict JSON, assigns tasks locally, and publishes atomically', async () => {
    addCurrentPlan();
    configureAutomation();
    const { saveHouseholdTaskWeek } = await import('./household-task.store.js');
    saveHouseholdTaskWeek(db, HOUSEHOLD_ID, 'alice', {
      baseVersion: 0,
      weekStart: '2026-10-12',
      tasks: [
        {
          id: 'private-previous-task-id',
          title: 'Limpiar el fregadero',
          details: 'Detalle privado que no debe llegar al proveedor',
          spaceId: 'kitchen',
          scheduledDate: '2026-10-14',
          assignedMemberId: 'alice',
          priority: 'high',
          completed: true
        }
      ]
    });
    const provider = providerForGeneratedPlans();

    const result = await runHouseholdPlanningAutomationOccurrence(baseInput(), {
      provider,
      random: () => 0.5
    });

    expect(result.outcome).toBe('completed');
    expect(result.run).toMatchObject({ status: 'completed', targetWeekStart: TARGET_WEEK });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(provider).toHaveBeenCalledWith(
      expect.any(Array),
      HOUSEHOLD_TASK_PROPOSAL_RESPONSE_FORMAT,
      undefined
    );
    expect(provider).toHaveBeenCalledWith(
      expect.any(Array),
      createMealProposalResponseFormat(),
      undefined
    );
    const prompt = JSON.stringify(provider.mock.calls.map(([messages]) => messages));
    const taskProposalMessages = provider.mock.calls.find(
      ([, responseFormat]) => responseFormat.json_schema.name === 'household_task_proposal'
    )?.[0];
    const taskPrompt = taskProposalMessages?.map(({ content }) => content).join('\n') ?? '';
    expect(prompt).toContain('Cocina');
    expect(prompt).not.toContain('alice');
    expect(prompt).not.toContain('bob');
    expect(prompt).not.toContain('membership-alice');
    expect(prompt).not.toContain('Nombre privado');
    expect(prompt).not.toContain('alice@hogaria.test');
    expect(prompt).not.toContain('private-previous-task-id');
    expect(prompt).not.toContain('Detalle privado');
    expect(taskPrompt).toContain('mostRecentlyConfirmedWeek');
    expect(taskPrompt).toContain('Limpiar el fregadero');
    expect(taskPrompt).toContain('"weekStart":"2026-10-12"');
    expect(taskPrompt).toContain('"zone":{"id":"kitchen","label":"Cocina"}');

    const taskWeek = db
      .prepare(
        'SELECT version, tasks_json FROM household_task_weeks WHERE household_id = ? AND week_start = ?'
      )
      .get(HOUSEHOLD_ID, TARGET_WEEK) as { version: number; tasks_json: string };
    const tasks = JSON.parse(taskWeek.tasks_json) as Array<{
      id: string;
      assignedMemberId: string | null;
      completed: boolean;
      scheduledDate: string;
    }>;
    expect(taskWeek.version).toBe(1);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => ['alice', 'bob'].includes(task.assignedMemberId ?? ''))).toBe(
      true
    );
    expect(new Set(tasks.map((task) => task.assignedMemberId)).size).toBe(2);
    expect(tasks.every((task) => !task.completed && task.scheduledDate >= TARGET_WEEK)).toBe(true);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM meals m JOIN weekly_calendars wc ON wc.id = m.calendar_id
           WHERE wc.household_id = ? AND m.date BETWEEN ? AND ? AND m.source_proposal_id IS NOT NULL`
        )
        .get(HOUSEHOLD_ID, TARGET_WEEK, addDays(TARGET_WEEK, 6))
    ).toEqual({ count: 7 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal_participants').get()).toEqual({
      count: 14
    });
  });

  it('returns disabled without a run and can generate meals without task scope', async () => {
    addCurrentPlan();
    const disabled = await runHouseholdPlanningAutomationOccurrence(baseInput(), {
      provider: providerForGeneratedPlans()
    });
    expect(disabled).toEqual({ outcome: 'disabled', run: null });

    configureAutomation('generate', ['meals']);
    const provider = providerForGeneratedPlans();
    const generated = await runHouseholdPlanningAutomationOccurrence(baseInput(), { provider });
    expect(generated.outcome).toBe('completed');
    expect(provider).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_task_weeks').get()).toEqual({
      count: 0
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 7 });
  });

  it('does not process a due occurrence using a newer configuration than the scheduler snapshot', async () => {
    addCurrentPlan();
    configureAutomation('generate', ['tasks']);
    const staleConfigVersion = automationStore.readHouseholdPlanningAutomation(
      db,
      HOUSEHOLD_ID,
      RUN_NOW
    ).version;
    const updated = automationStore.saveHouseholdPlanningAutomation(
      db,
      HOUSEHOLD_ID,
      'alice',
      { expectedVersion: staleConfigVersion, localTime: '10:30' },
      RUN_NOW
    );
    expect(updated.status).toBe('saved');
    const provider = vi.fn(async () => mealProposal());

    const result = await runHouseholdPlanningAutomationOccurrence(
      { ...baseInput(), expectedConfigVersion: staleConfigVersion },
      { provider }
    );

    expect(result).toEqual({ outcome: 'stale_config', run: null });
    expect(provider).not.toHaveBeenCalled();
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM household_planning_automation_runs').get()
    ).toEqual({ count: 0 });
  });

  it('does not blindly retry an ambiguous timeout; an explicit retry reuses the same run/fence', async () => {
    addCurrentPlan();
    configureAutomation('generate', ['tasks']);
    const timeoutProvider = vi.fn(async () => {
      throw new AiCallError('TIMEOUT', 'Synthetic timeout', 'TIMEOUT');
    });

    const failed = await runHouseholdPlanningAutomationOccurrence(baseInput(), {
      provider: timeoutProvider
    });
    expect(failed).toMatchObject({
      outcome: 'review_required',
      run: { status: 'review_required', failureCode: 'PROVIDER_TIMEOUT_AMBIGUOUS' }
    });
    expect(timeoutProvider).toHaveBeenCalledTimes(1);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM household_task_weeks WHERE week_start = ?')
        .get(TARGET_WEEK)
    ).toEqual({ count: 0 });

    const duplicatePoll = await runHouseholdPlanningAutomationOccurrence(baseInput(), {
      provider: timeoutProvider
    });
    expect(duplicatePoll.outcome).toBe('review_required');
    expect(timeoutProvider).toHaveBeenCalledTimes(1);

    const unauthorized = await retryHouseholdPlanningAutomationRun(
      {
        db,
        householdId: HOUSEHOLD_ID,
        occurrenceKey: OCCURRENCE.occurrenceKey,
        requestedBy: 'bob',
        workerId: 'unauthorized-retry-worker',
        now: RUN_NOW
      },
      { provider: providerForGeneratedPlans(), random: () => 0.5 }
    );
    expect(unauthorized.outcome).toBe('not_authorized');

    const staleForm = startHouseholdPlanningAutomationRetry({
      db,
      householdId: HOUSEHOLD_ID,
      occurrenceKey: OCCURRENCE.occurrenceKey,
      requestedBy: 'alice',
      workerId: 'stale-retry-worker',
      expectedVersion: 999,
      now: RUN_NOW
    });
    expect(staleForm).toMatchObject({
      outcome: 'stale_config',
      run: { status: 'review_required' }
    });

    const retryProvider = providerForGeneratedPlans();
    const started = startHouseholdPlanningAutomationRetry(
      {
        db,
        householdId: HOUSEHOLD_ID,
        occurrenceKey: OCCURRENCE.occurrenceKey,
        requestedBy: 'alice',
        workerId: 'explicit-retry-worker',
        expectedVersion: 1,
        now: RUN_NOW
      },
      { provider: retryProvider, random: () => 0.5 }
    );
    expect(started).toMatchObject({ outcome: 'claimed', run: { status: 'in_progress' } });
    expect(started.completion).toBeInstanceOf(Promise);
    const retried = await started.completion!;
    expect(retried.outcome).toBe('completed');
    expect(retried.run?.id).toBe(failed.run?.id);
    expect(retried.run?.fence).toBe((failed.run?.fence ?? 0) + 1);
    expect(retryProvider).toHaveBeenCalledTimes(1);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM household_task_weeks WHERE week_start = ?')
        .get(TARGET_WEEK)
    ).toEqual({ count: 1 });
    expect(
      automationRuns.readHouseholdPlanningAutomationRun(db, HOUSEHOLD_ID, OCCURRENCE.occurrenceKey)
        ?.status
    ).toBe('completed');
    const completedAgain = await retryHouseholdPlanningAutomationRun(
      {
        db,
        householdId: HOUSEHOLD_ID,
        occurrenceKey: OCCURRENCE.occurrenceKey,
        requestedBy: 'alice',
        workerId: 'duplicate-explicit-retry-worker',
        now: RUN_NOW
      },
      { provider: retryProvider, random: () => 0.5 }
    );
    expect(completedAgain.outcome).toBe('already_completed');
    expect(retryProvider).toHaveBeenCalledTimes(1);
  });

  it('repeats the latest confirmed tasks and meals with shifted dates, fresh IDs and no AI call', async () => {
    addCurrentPlan();
    configureAutomation('repeat');
    const { saveHouseholdTaskWeek } = await import('./household-task.store.js');
    saveHouseholdTaskWeek(db, HOUSEHOLD_ID, 'alice', {
      baseVersion: 0,
      weekStart: '2026-10-05',
      tasks: [
        {
          id: 'source-task',
          title: 'Limpiar la encimera',
          details: 'Usar paño húmedo',
          spaceId: 'kitchen',
          scheduledDate: '2026-10-06',
          assignedMemberId: 'bob',
          priority: 'low',
          completed: true
        }
      ]
    });
    persistSharedMeals(db, 'alice', {
      proposalId: 'source-meal-proposal',
      expectedHouseholdId: HOUSEHOLD_ID,
      events: [
        {
          eventId: 'source-lunch',
          date: '2026-10-05',
          mealType: 'lunch',
          time: '13:00',
          customMeal: null,
          recipeId: null,
          servings: 2,
          participantIds: ['alice', 'bob'],
          recipeSnapshot
        }
      ]
    });
    const sourceMealId = (
      db
        .prepare(
          'SELECT m.id FROM meals m JOIN weekly_calendars wc ON wc.id = m.calendar_id WHERE wc.household_id = ?'
        )
        .get(HOUSEHOLD_ID) as { id: string }
    ).id;
    const provider = vi.fn(async () => {
      throw new Error('Repeat mode must not call AI');
    });

    const result = await runHouseholdPlanningAutomationOccurrence(baseInput(), { provider });

    expect(result.outcome).toBe('completed');
    expect(provider).not.toHaveBeenCalled();
    const targetTasks = JSON.parse(
      (
        db
          .prepare(
            'SELECT tasks_json FROM household_task_weeks WHERE household_id = ? AND week_start = ?'
          )
          .get(HOUSEHOLD_ID, TARGET_WEEK) as { tasks_json: string }
      ).tasks_json
    ) as Array<Record<string, unknown>>;
    expect(targetTasks).toEqual([
      expect.objectContaining({
        title: 'Limpiar la encimera',
        details: 'Usar paño húmedo',
        spaceId: 'kitchen',
        scheduledDate: '2026-10-20',
        assignedMemberId: 'bob',
        completed: false
      })
    ]);
    expect(targetTasks[0]?.id).not.toBe('source-task');
    const copiedMeal = db
      .prepare(
        `SELECT m.id, m.date, m.completed, m.recipe_snapshot, m.proposal_id
           FROM meals m JOIN weekly_calendars wc ON wc.id = m.calendar_id
          WHERE wc.household_id = ? AND m.date = ?`
      )
      .get(HOUSEHOLD_ID, TARGET_WEEK) as {
      id: string;
      date: string;
      completed: number;
      recipe_snapshot: string | null;
      proposal_id: string;
    };
    expect(copiedMeal).toMatchObject({ date: TARGET_WEEK, completed: 0 });
    expect(copiedMeal.id).not.toBe(sourceMealId);
    expect(copiedMeal.proposal_id).not.toBe('source-meal-proposal');
    expect(JSON.parse(copiedMeal.recipe_snapshot ?? '{}')).toEqual(recipeSnapshot);
  });

  it('keeps the same person off a generated Monday after assigning them the prior Sunday', async () => {
    addCurrentPlan();
    configureAutomation('generate', ['tasks']);
    const { saveHouseholdTaskWeek } = await import('./household-task.store.js');
    saveHouseholdTaskWeek(db, HOUSEHOLD_ID, 'alice', {
      baseVersion: 0,
      weekStart: '2026-10-12',
      tasks: [
        {
          id: 'sunday-task',
          title: 'Sacar reciclaje',
          details: null,
          spaceId: null,
          scheduledDate: '2026-10-18',
          assignedMemberId: 'alice',
          priority: 'medium',
          completed: false
        }
      ]
    });
    const provider = vi.fn(async () =>
      JSON.stringify({
        tasks: [{ title: 'Limpiar cocina', scheduledDate: TARGET_WEEK, spaceId: 'kitchen' }]
      })
    );

    const result = await runHouseholdPlanningAutomationOccurrence(baseInput(), {
      provider,
      random: () => 0.5
    });

    expect(result.outcome).toBe('completed');
    const tasks = JSON.parse(
      (
        db
          .prepare('SELECT tasks_json FROM household_task_weeks WHERE week_start = ?')
          .get(TARGET_WEEK) as { tasks_json: string }
      ).tasks_json
    ) as Array<{ assignedMemberId: string | null }>;
    expect(tasks[0]?.assignedMemberId).toBe('bob');
  });

  it('rolls back all selected scopes when a participant becomes ineligible before meal persistence', async () => {
    addCurrentPlan();
    configureAutomation();
    const provider = vi.fn(async (_messages: AiMessage[], responseFormat: AiResponseFormat) => {
      if (responseFormat.json_schema.name === 'household_task_proposal') {
        return JSON.stringify({
          tasks: [{ title: 'Limpiar la cocina', scheduledDate: TARGET_WEEK, spaceId: 'kitchen' }]
        });
      }
      db.prepare(
        'UPDATE household_members SET permissions = ? WHERE user_id = ? AND household_id = ?'
      ).run(JSON.stringify({ calendar: { view: false } }), 'bob', HOUSEHOLD_ID);
      return mealProposal();
    });

    const result = await runHouseholdPlanningAutomationOccurrence(baseInput(), {
      provider,
      random: () => 0.5
    });

    expect(result).toMatchObject({
      outcome: 'review_required',
      run: { status: 'review_required', failureCode: 'PUBLISH_CONFLICT' }
    });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM household_task_weeks WHERE week_start = ?')
        .get(TARGET_WEEK)
    ).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('fails closed on occupied destination weeks and on cancellation before provider access', async () => {
    addCurrentPlan();
    configureAutomation('generate', ['tasks']);
    const { saveHouseholdTaskWeek } = await import('./household-task.store.js');
    saveHouseholdTaskWeek(db, HOUSEHOLD_ID, 'alice', {
      baseVersion: 0,
      weekStart: TARGET_WEEK,
      tasks: []
    });
    const provider = providerForGeneratedPlans();

    const occupied = await runHouseholdPlanningAutomationOccurrence(baseInput(), { provider });
    expect(occupied).toMatchObject({
      outcome: 'review_required',
      run: { failureCode: 'PUBLISH_CONFLICT' }
    });
    expect(provider).not.toHaveBeenCalled();

    db.prepare('DELETE FROM household_planning_automation_runs').run();
    db.prepare('DELETE FROM household_task_weeks WHERE week_start = ?').run(TARGET_WEEK);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await runHouseholdPlanningAutomationOccurrence(
      {
        ...baseInput(new Date('2026-10-19T08:00:00.000Z')),
        occurrence: nextHouseholdWeeklyOccurrence(SCHEDULE, new Date('2026-10-19T07:29:00.000Z'))
      },
      { provider, signal: controller.signal }
    );
    expect(cancelled.outcome).not.toBe('completed');
    expect(provider).not.toHaveBeenCalled();
  });

  it('does not publish meals over a manual calendar event', async () => {
    addCurrentPlan();
    configureAutomation();
    db.prepare(
      `INSERT INTO calendar_events
        (id, household_id, user_id, title, kind, date, start_time, end_time, all_day)
       VALUES ('manual-appointment', ?, 'alice', 'Cita sintética', 'appointment', ?, '12:30', '14:00', 0)`
    ).run(HOUSEHOLD_ID, addDays(TARGET_WEEK, 1));
    const provider = providerForGeneratedPlans();

    const result = await runHouseholdPlanningAutomationOccurrence(baseInput(), {
      provider,
      random: () => 0.5
    });

    expect(result).toMatchObject({
      outcome: 'review_required',
      run: { failureCode: 'PUBLISH_CONFLICT' }
    });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM household_task_weeks WHERE week_start = ?')
        .get(TARGET_WEEK)
    ).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('publishes when a manual event is outside the proposed meal time', async () => {
    addCurrentPlan();
    configureAutomation();
    db.prepare(
      `INSERT INTO calendar_events
        (id, household_id, user_id, title, kind, date, start_time, end_time, all_day)
       VALUES ('early-appointment', ?, 'alice', 'Cita sintética', 'appointment', ?, '08:00', '09:00', 0)`
    ).run(HOUSEHOLD_ID, addDays(TARGET_WEEK, 1));
    const result = await runHouseholdPlanningAutomationOccurrence(baseInput(), {
      provider: providerForGeneratedPlans(),
      random: () => 0.5
    });
    expect(result.outcome).toBe('completed');
  });

  it('leaves unresolved meals for review and never publishes another selected scope', async () => {
    addCurrentPlan();
    configureAutomation();
    const provider = vi.fn(async (_messages: AiMessage[], responseFormat: AiResponseFormat) =>
      responseFormat.json_schema.name === 'household_task_proposal'
        ? JSON.stringify({
            tasks: [{ title: 'Limpiar cocina', scheduledDate: TARGET_WEEK, spaceId: 'kitchen' }]
          })
        : unresolvedMealProposal()
    );

    const result = await runHouseholdPlanningAutomationOccurrence(baseInput(), {
      provider,
      random: () => 0.5
    });

    expect(result).toMatchObject({
      outcome: 'review_required',
      run: { failureCode: 'INVALID_PROPOSAL' }
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_task_weeks').get()).toEqual({
      count: 0
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('fails repeat mode when no confirmed task week exists', async () => {
    addCurrentPlan();
    configureAutomation('repeat', ['tasks']);
    const provider = vi.fn(async () => {
      throw new Error('Repeat mode must not call AI');
    });

    const result = await runHouseholdPlanningAutomationOccurrence(baseInput(), { provider });

    expect(result).toMatchObject({
      outcome: 'review_required',
      run: { failureCode: 'INVALID_PROPOSAL' }
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it('does not claim a future occurrence or publish after its target week has started', async () => {
    addCurrentPlan();
    configureAutomation('generate', ['tasks']);
    const provider = providerForGeneratedPlans();
    const future = await runHouseholdPlanningAutomationOccurrence(
      { ...baseInput(new Date('2026-10-12T06:00:00.000Z')) },
      { provider }
    );
    expect(future).toEqual({ outcome: 'not_due', run: null });
    expect(provider).not.toHaveBeenCalled();

    const missed = await runHouseholdPlanningAutomationOccurrence(
      { ...baseInput(new Date('2026-10-19T08:00:00.000Z')) },
      { provider }
    );
    expect(missed).toMatchObject({ outcome: 'skipped', run: { status: 'skipped' } });
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects an impossible task assignment without publishing', async () => {
    addCurrentPlan();
    configureAutomation('generate', ['tasks']);
    db.prepare(
      'UPDATE household_members SET is_active = 0 WHERE user_id = ? AND household_id = ?'
    ).run('bob', HOUSEHOLD_ID);
    const provider = vi.fn(async () =>
      JSON.stringify({
        tasks: [
          { title: 'Tarea 1', scheduledDate: TARGET_WEEK, spaceId: 'kitchen' },
          { title: 'Tarea 2', scheduledDate: addDays(TARGET_WEEK, 1), spaceId: 'kitchen' }
        ]
      })
    );

    const result = await runHouseholdPlanningAutomationOccurrence(baseInput(), { provider });

    expect(result).toMatchObject({
      outcome: 'review_required',
      run: { failureCode: 'INVALID_PROPOSAL' }
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_task_weeks').get()).toEqual({
      count: 0
    });
  });
});
