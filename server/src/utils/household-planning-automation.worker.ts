import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type { AiResponseFormat } from '../schemas/ai-response-format.js';
import { householdPlanSchema } from '../schemas/household-plan.schema.js';
import type {
  HouseholdPlanningAutomationMode,
  HouseholdPlanningAutomationScope
} from '../schemas/household-planning-automation.schema.js';
import type { HouseholdTaskOccurrence } from '../schemas/household-task.schema.js';
import type { AiConfigRow, AiMessage } from './ai-client.js';
import { AiCallError, activeAiConfigForScope, callAIWithConfig } from './ai-client.js';
import {
  AutomatedHouseholdMealProposalError,
  generateAutomatedHouseholdMealProposal,
  type AutomatedHouseholdMealProposal,
  type HouseholdMealProposalProvider
} from '../routes/household-meal-proposals.routes.js';
import {
  expandOccurrences,
  isRecurrence,
  isRecurrenceSchedule,
  type RecurrenceRule
} from './calendar-recurrence.js';
import { readHouseholdPlanningAutomation } from './household-planning-automation.store.js';
import {
  claimHouseholdPlanningAutomationOccurrence,
  completeHouseholdPlanningAutomationRun,
  failHouseholdPlanningAutomationRun,
  readHouseholdPlanningAutomationRun,
  renewHouseholdPlanningAutomationRunLease,
  retryHouseholdPlanningAutomationRun as retryLedgerRun,
  type HouseholdPlanningAutomationFailureCode,
  type HouseholdPlanningAutomationRunSnapshot
} from './household-planning-automation-runs.store.js';
import {
  nextHouseholdWeeklyOccurrence,
  type HouseholdWeeklyOccurrence,
  type HouseholdWeeklySchedule
} from './household-weekly-schedule.js';
import {
  assignHouseholdTasksFairly,
  type PreviousDayTaskAssignment
} from './household-task-assignment.js';
import {
  HouseholdTaskProposalError,
  generateHouseholdTaskProposal
} from './household-task-proposal-ai.js';
import { readHouseholdTaskWeek, saveHouseholdTaskWeek } from './household-task.store.js';
import {
  persistSharedMeals,
  SharedMealPersistenceError,
  type SharedMealEventInput,
  type SharedMealRecipeToCreate
} from './shared-meal-calendar.store.js';
import {
  createHouseholdMealRecipeId,
  createHouseholdMealRecipeSnapshot
} from './household-meal-recipe-snapshot.js';

const DEFAULT_LEASE_MS = 5 * 60_000;
const ISO_DAY_MS = 86_400_000;

export type HouseholdPlanningAutomationProvider = (
  messages: AiMessage[],
  responseFormat: AiResponseFormat,
  signal?: AbortSignal
) => Promise<string>;

export interface RunHouseholdPlanningAutomationOccurrenceInput {
  db: Database.Database;
  householdId: string;
  workerId: string;
  occurrence: HouseholdWeeklyOccurrence;
  /** Scheduler snapshot fence; a newer settings version invalidates the occurrence. */
  expectedConfigVersion?: number;
  /** Deterministic override for tests/reconcilers. Production callers should omit it. */
  now?: Date;
}

export interface RetryHouseholdPlanningAutomationRunInput {
  db: Database.Database;
  householdId: string;
  occurrenceKey: string;
  requestedBy: string;
  workerId: string;
  /** The settings version displayed to the requester; stale forms never retry a newer plan. */
  expectedVersion?: number;
  /** Deterministic override for tests/routes. Production callers should omit it. */
  now?: Date;
}

export interface HouseholdPlanningAutomationWorkerDependencies {
  /** Injected in tests; production uses the active household AI config directly, without retries. */
  provider?: HouseholdPlanningAutomationProvider;
  /** Server-only random source for reproducible fair assignment tests. */
  random?: () => number;
  /** In tests, input.now is used unless an explicit advancing clock is supplied. */
  clock?: () => Date;
  signal?: AbortSignal;
  leaseMs?: number;
  language?: 'es' | 'en';
}

export interface HouseholdPlanningAutomationWorkerResult {
  outcome: string;
  run: HouseholdPlanningAutomationRunSnapshot | null;
}

interface ActiveMember {
  userId: string;
  membershipId: string;
  permissions: string | null;
}

interface TaskWeekContext {
  weekStart: string;
  tasks: HouseholdTaskOccurrence[];
}

interface PreparedPublication {
  tasks: HouseholdTaskOccurrence[] | null;
  meals: SharedMealEventInput[] | null;
  recipesToCreate: SharedMealRecipeToCreate[] | null;
  mealProposalId: string | null;
}

class WorkerError extends Error {
  constructor(readonly failureCode: HouseholdPlanningAutomationFailureCode) {
    super(failureCode);
    this.name = 'WorkerError';
  }
}

/** Claims one exact due occurrence. A prior `review_required` run is returned as-is, never retried. */
export async function runHouseholdPlanningAutomationOccurrence(
  input: RunHouseholdPlanningAutomationOccurrenceInput,
  dependencies: HouseholdPlanningAutomationWorkerDependencies = {}
): Promise<HouseholdPlanningAutomationWorkerResult> {
  const now = clockFor(input.now, dependencies)();
  const state = readHouseholdPlanningAutomation(input.db, input.householdId, now);
  if (input.expectedConfigVersion !== undefined && input.expectedConfigVersion !== state.version) {
    return { outcome: 'stale_config', run: null };
  }
  if (!state.enabled) return { outcome: 'disabled', run: null };
  if (
    !state.mode ||
    state.weekday === null ||
    state.localTime === null ||
    state.timeZone === null
  ) {
    return { outcome: 'disabled', run: null };
  }

  const schedule: HouseholdWeeklySchedule = {
    weekday: state.weekday as HouseholdWeeklySchedule['weekday'],
    localTime: state.localTime,
    timeZone: state.timeZone
  };
  const targetWeekStart = nextMondayAfter(input.occurrence.scheduledLocalDate);
  const claim = claimHouseholdPlanningAutomationOccurrence(input.db, {
    householdId: input.householdId,
    expectedConfigVersion: state.version,
    mode: state.mode,
    scopes: state.scopes,
    schedule,
    occurrence: input.occurrence,
    targetWeekStart,
    workerId: input.workerId,
    leaseMs: dependencies.leaseMs ?? DEFAULT_LEASE_MS,
    now
  });
  if (claim.outcome !== 'claimed' || !claim.run) return claim;

  return processClaimedRun(
    input.db,
    claim.run,
    input.workerId,
    schedule,
    input.occurrence,
    state.mode,
    state.scopes,
    input.now,
    dependencies
  );
}

/** Explicit settings retry. The scheduler must call only `runHouseholdPlanningAutomationOccurrence`. */
export async function retryHouseholdPlanningAutomationRun(
  input: RetryHouseholdPlanningAutomationRunInput,
  dependencies: HouseholdPlanningAutomationWorkerDependencies = {}
): Promise<HouseholdPlanningAutomationWorkerResult> {
  const started = startHouseholdPlanningAutomationRetry(input, dependencies);
  return started.completion ? started.completion : started;
}

/** Claims an explicit retry synchronously so a route can return 202 with the in-progress snapshot. */
export function startHouseholdPlanningAutomationRetry(
  input: RetryHouseholdPlanningAutomationRunInput,
  dependencies: HouseholdPlanningAutomationWorkerDependencies = {}
): HouseholdPlanningAutomationWorkerResult & {
  completion?: Promise<HouseholdPlanningAutomationWorkerResult>;
} {
  const now = clockFor(input.now, dependencies)();
  const state = readHouseholdPlanningAutomation(input.db, input.householdId, now);
  const previous = readHouseholdPlanningAutomationRun(
    input.db,
    input.householdId,
    input.occurrenceKey
  );
  if (!previous) return { outcome: 'not_found', run: null };
  if (input.expectedVersion !== undefined && state.version !== input.expectedVersion) {
    return { outcome: 'stale_config', run: previous };
  }
  if (
    !state.mode ||
    state.weekday === null ||
    state.localTime === null ||
    state.timeZone === null
  ) {
    return { outcome: 'stale_config', run: previous };
  }

  const retry = retryLedgerRun(input.db, {
    householdId: input.householdId,
    occurrenceKey: input.occurrenceKey,
    expectedConfigVersion: state.version,
    requestedBy: input.requestedBy,
    workerId: input.workerId,
    leaseMs: dependencies.leaseMs ?? DEFAULT_LEASE_MS,
    now
  });
  if (retry.outcome !== 'claimed' || !retry.run) return retry;

  const schedule: HouseholdWeeklySchedule = {
    weekday: state.weekday as HouseholdWeeklySchedule['weekday'],
    localTime: state.localTime,
    timeZone: state.timeZone
  };
  const occurrence = occurrenceForRun(retry.run, schedule);
  if (!occurrence) {
    const failed = failHouseholdPlanningAutomationRun(input.db, {
      runId: retry.run.id,
      workerId: input.workerId,
      fence: retry.run.fence,
      now: clockFor(input.now, dependencies)(),
      failureCode: 'CONFIG_STALE'
    });
    return failed;
  }

  const completion = processClaimedRun(
    input.db,
    retry.run,
    input.workerId,
    schedule,
    occurrence,
    retry.run.mode,
    retry.run.scopes,
    input.now,
    dependencies
  );
  return { outcome: 'claimed', run: retry.run, completion };
}

async function processClaimedRun(
  db: Database.Database,
  run: HouseholdPlanningAutomationRunSnapshot,
  workerId: string,
  schedule: HouseholdWeeklySchedule,
  occurrence: HouseholdWeeklyOccurrence,
  mode: HouseholdPlanningAutomationMode,
  scopes: HouseholdPlanningAutomationScope[],
  fixedNow: Date | undefined,
  dependencies: HouseholdPlanningAutomationWorkerDependencies
): Promise<HouseholdPlanningAutomationWorkerResult> {
  const now = clockFor(fixedNow, dependencies);
  let providerInvoked = false;
  const leaseInput = () => ({ runId: run.id, workerId, fence: run.fence, now: now() });

  try {
    assertRunMatches(run, mode, scopes, schedule, occurrence);
    assertTargetWeeksEmpty(db, run.householdId, run.targetWeekStart, scopes);
    const authorizer = readAuthorizer(db, run.householdId);
    if (!authorizer) throw new WorkerError('AUTHORIZATION_INVALID');
    const members = readActiveMembers(db, run.householdId);
    const activeMemberIds = members.map(({ userId }) => userId);
    const planZones = scopes.includes('tasks') ? readPlanZones(db, run.householdId) : [];
    const priorTasks = scopes.includes('tasks')
      ? readLatestTaskWeek(db, run.householdId, run.targetWeekStart, planZones, activeMemberIds)
      : null;
    const invokeProvider: HouseholdPlanningAutomationProvider = async (
      messages,
      responseFormat,
      signal
    ) => {
      if (signal?.aborted) {
        throw new AiCallError('PROVIDER', 'AI request was cancelled', 'CANCELLED');
      }
      const config = dependencies.provider
        ? undefined
        : activeAiConfigForScope(db, authorizer, run.householdId);
      if (!dependencies.provider && !config) {
        throw new AiCallError(
          'NO_CONFIG',
          'AI configuration is not available',
          'CONFIGURATION_ERROR'
        );
      }
      providerInvoked = true;
      return dependencies.provider
        ? dependencies.provider(messages, responseFormat, signal)
        : callAIWithConfig(config as AiConfigRow, messages, responseFormat, signal);
    };

    const renewBeforeProvider = () => {
      if (dependencies.signal?.aborted) throw new WorkerError('WORKER_FAILURE');
      const result = renewHouseholdPlanningAutomationRunLease(db, {
        ...leaseInput(),
        leaseMs: dependencies.leaseMs ?? DEFAULT_LEASE_MS
      });
      if (result.outcome !== 'renewed') return result;
      return null;
    };

    const prepared = await preparePublication({
      db,
      run,
      mode,
      scopes,
      authorizer,
      members,
      activeMemberIds,
      planZones,
      priorTasks,
      provider: invokeProvider,
      renewBeforeProvider,
      random: dependencies.random ?? Math.random,
      language: dependencies.language ?? 'es',
      signal: dependencies.signal
    });
    if ('outcome' in prepared) return prepared;

    const completion = completeHouseholdPlanningAutomationRun(db, leaseInput(), () => {
      assertTargetWeeksEmpty(db, run.householdId, run.targetWeekStart, scopes);
      if (prepared.meals) assertNoManualCalendarConflicts(db, prepared.meals, run.householdId);
      if (prepared.tasks) {
        const saved = saveHouseholdTaskWeek(db, run.householdId, authorizer, {
          baseVersion: 0,
          weekStart: run.targetWeekStart,
          tasks: prepared.tasks
        });
        if (saved.status !== 'saved') throw new WorkerError('PUBLISH_CONFLICT');
      }
      if (prepared.meals && prepared.mealProposalId) {
        persistSharedMeals(db, authorizer, {
          proposalId: prepared.mealProposalId,
          expectedHouseholdId: run.householdId,
          recipesToCreate: prepared.recipesToCreate ?? [],
          events: prepared.meals
        });
      }
    });
    return completion;
  } catch (error) {
    const failureCode = classifyFailure(error, providerInvoked, dependencies.signal);
    const failure = failHouseholdPlanningAutomationRun(db, {
      ...leaseInput(),
      failureCode
    });
    return failure;
  }
}

async function preparePublication(input: {
  db: Database.Database;
  run: HouseholdPlanningAutomationRunSnapshot;
  mode: HouseholdPlanningAutomationMode;
  scopes: HouseholdPlanningAutomationScope[];
  authorizer: string;
  members: ActiveMember[];
  activeMemberIds: string[];
  planZones: Array<{ id: string; label: string }>;
  priorTasks: TaskWeekContext | null;
  provider: HouseholdPlanningAutomationProvider;
  renewBeforeProvider: () => HouseholdPlanningAutomationWorkerResult | null;
  random: () => number;
  language: 'es' | 'en';
  signal?: AbortSignal;
}): Promise<PreparedPublication | HouseholdPlanningAutomationWorkerResult> {
  let tasks: HouseholdTaskOccurrence[] | null = null;
  let meals: SharedMealEventInput[] | null = null;
  let recipesToCreate: SharedMealRecipeToCreate[] | null = null;
  const proposalId = stableProposalId(input.run.householdId, input.run.occurrenceKey);
  if (input.scopes.includes('tasks')) {
    if (input.mode === 'repeat') {
      tasks = copyLatestTaskWeek(
        input.db,
        input.run.householdId,
        input.run.targetWeekStart,
        input.planZones,
        input.activeMemberIds
      );
    } else {
      const renewal = input.renewBeforeProvider();
      if (renewal) return renewal;
      const proposal = await generateHouseholdTaskProposal(
        {
          language: input.language,
          weekStart: input.run.targetWeekStart,
          zones: input.planZones,
          previousWeek: input.priorTasks
            ? {
                weekStart: input.priorTasks.weekStart,
                tasks: input.priorTasks.tasks.map(({ title, scheduledDate, spaceId }) => ({
                  title,
                  scheduledDate,
                  spaceId
                }))
              }
            : null,
          ...(input.signal ? { signal: input.signal } : {})
        },
        input.provider
      );
      const taskDrafts = proposal.tasks.map((task) => ({ ...task, id: nanoid() }));
      const previousDay = previousSundayAssignment(
        input.priorTasks,
        input.run.targetWeekStart,
        input.activeMemberIds
      );
      const assignment = assignHouseholdTasksFairly(
        taskDrafts,
        input.activeMemberIds,
        input.random,
        previousDay ?? undefined
      );
      if (!assignment.ok) throw new WorkerError('INVALID_PROPOSAL');
      tasks = assignment.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        details: null,
        spaceId: task.spaceId,
        scheduledDate: task.scheduledDate,
        assignedMemberId: task.assignedMemberId,
        completed: false
      }));
      const afterProposal = input.renewBeforeProvider();
      if (afterProposal) return afterProposal;
    }
  }

  if (input.scopes.includes('meals')) {
    if (input.mode === 'repeat') {
      meals = copyLatestMealWeek(
        input.db,
        input.run.householdId,
        input.run.targetWeekStart,
        input.members,
        proposalId
      );
      recipesToCreate = [];
    } else {
      const renewal = input.renewBeforeProvider();
      if (renewal) return renewal;
      const proposal: AutomatedHouseholdMealProposal = await generateAutomatedHouseholdMealProposal(
        {
          db: input.db,
          householdId: input.run.householdId,
          actorUserId: input.authorizer,
          householdMemberIds: input.members.map(({ membershipId }) => membershipId),
          weekStart: input.run.targetWeekStart,
          language: input.language,
          ...(input.signal ? { signal: input.signal } : {})
        },
        input.provider as HouseholdMealProposalProvider
      );
      const normalized = normalizeMealProposalForPublication(proposal, proposalId);
      meals = normalized.events;
      recipesToCreate = normalized.recipesToCreate;
      const afterProposal = input.renewBeforeProvider();
      if (afterProposal) return afterProposal;
    }
  }

  if (
    (input.scopes.includes('tasks') && tasks === null) ||
    (input.scopes.includes('meals') && meals === null)
  ) {
    throw new WorkerError('INVALID_PROPOSAL');
  }
  return { tasks, meals, recipesToCreate, mealProposalId: meals ? proposalId : null };
}

function normalizeMealProposalForPublication(
  proposal: AutomatedHouseholdMealProposal,
  proposalId: string
): { events: SharedMealEventInput[]; recipesToCreate: SharedMealRecipeToCreate[] } {
  const aliasToUserId = new Map<string, string>();
  for (const participant of proposal.participants) {
    if (!participant.alias || !participant.userId || aliasToUserId.has(participant.alias)) {
      throw new WorkerError('INVALID_PROPOSAL');
    }
    aliasToUserId.set(participant.alias, participant.userId);
  }
  if (
    proposal.events.length === 0 ||
    proposal.events.some((event) => event.status !== 'scheduled')
  ) {
    throw new WorkerError('INVALID_PROPOSAL');
  }

  const recipeByAlias = new Map(proposal.recipes.map((recipe) => [recipe.alias, recipe]));
  const recipesToCreate = proposal.recipes.flatMap((recipe) => {
    if (recipe.source !== 'new') return [];
    if (!recipe.alias.startsWith('N')) throw new WorkerError('INVALID_PROPOSAL');
    return [
      {
        alias: recipe.alias,
        recipeId: createHouseholdMealRecipeId(proposalId, recipe.alias),
        recipe: recipe.recipe
      }
    ];
  });

  const events = proposal.events.map((event, index) => {
    if (!event.recipeAlias) throw new WorkerError('INVALID_PROPOSAL');
    const recipe = recipeByAlias.get(event.recipeAlias);
    if (!recipe) throw new WorkerError('INVALID_PROPOSAL');
    const participantIds = event.participantAliases.map((alias) => aliasToUserId.get(alias));
    if (
      participantIds.some((id) => !id) ||
      new Set(participantIds).size !== participantIds.length
    ) {
      throw new WorkerError('INVALID_PROPOSAL');
    }
    const recipeId =
      recipe.source === 'catalog'
        ? recipe.recipeId
        : createHouseholdMealRecipeId(proposalId, recipe.alias);
    if (!recipeId) throw new WorkerError('INVALID_PROPOSAL');
    const recipeSnapshot = createHouseholdMealRecipeSnapshot(recipe.recipe);
    return {
      eventId: stableEventId(proposalId, `${index}|${event.date}|${event.mealType}`),
      date: event.date,
      mealType: event.mealType,
      time: event.time,
      recipeId,
      customMeal: typeof recipeSnapshot.name === 'string' ? recipeSnapshot.name : 'Receta',
      servings: event.servings,
      participantIds: participantIds as string[],
      recipeSnapshot
    };
  });
  return { events, recipesToCreate };
}

function copyLatestTaskWeek(
  db: Database.Database,
  householdId: string,
  targetWeekStart: string,
  zones: Array<{ id: string; label: string }>,
  activeMemberIds: string[]
): HouseholdTaskOccurrence[] {
  const previous = readLatestTaskWeek(
    db,
    householdId,
    targetWeekStart,
    zones,
    activeMemberIds,
    true
  );
  if (!previous) throw new WorkerError('INVALID_PROPOSAL');
  const difference = dayDifference(previous.weekStart, targetWeekStart);
  if (difference <= 0 || difference % 7 !== 0) throw new WorkerError('INVALID_PROPOSAL');
  const zoneIds = new Set(zones.map(({ id }) => id));
  const memberIds = new Set(activeMemberIds);
  return previous.tasks.map((task) => {
    if (task.spaceId && !zoneIds.has(task.spaceId)) throw new WorkerError('INVALID_PROPOSAL');
    if (task.assignedMemberId && !memberIds.has(task.assignedMemberId)) {
      throw new WorkerError('INVALID_PROPOSAL');
    }
    return {
      ...task,
      id: nanoid(),
      scheduledDate: addDays(task.scheduledDate, difference),
      completed: false
    };
  });
}

function copyLatestMealWeek(
  db: Database.Database,
  householdId: string,
  targetWeekStart: string,
  members: ActiveMember[],
  proposalId: string
): SharedMealEventInput[] {
  const week = db
    .prepare(
      `SELECT wc.week_start AS weekStart
         FROM meals m JOIN weekly_calendars wc ON wc.id = m.calendar_id
        WHERE wc.household_id = ? AND wc.week_start < ? AND m.source_proposal_id IS NOT NULL
        GROUP BY wc.week_start ORDER BY wc.week_start DESC LIMIT 1`
    )
    .get(householdId, targetWeekStart) as { weekStart: string } | undefined;
  if (!week) throw new WorkerError('INVALID_PROPOSAL');
  const shift = dayDifference(week.weekStart, targetWeekStart);
  if (shift <= 0 || shift % 7 !== 0) throw new WorkerError('INVALID_PROPOSAL');

  const rows = db
    .prepare(
      `SELECT m.id, m.date, m.meal_type AS mealType, m.recipe_id AS recipeId,
              m.custom_meal AS customMeal, m.time, m.servings, m.recipe_snapshot AS recipeSnapshot
         FROM meals m JOIN weekly_calendars wc ON wc.id = m.calendar_id
        WHERE wc.household_id = ? AND wc.week_start = ? AND m.source_proposal_id IS NOT NULL
        ORDER BY m.date, m.meal_type, m.id`
    )
    .all(householdId, week.weekStart) as Array<{
    id: string;
    date: string;
    mealType: string;
    recipeId: string | null;
    customMeal: string | null;
    time: string | null;
    servings: number;
    recipeSnapshot: string | null;
  }>;
  if (!rows.length) throw new WorkerError('INVALID_PROPOSAL');
  const activeMembers = new Map(members.map(({ userId, permissions }) => [userId, permissions]));
  return rows.map((row) => {
    const participants = db
      .prepare('SELECT user_id AS userId FROM meal_participants WHERE meal_id = ? ORDER BY user_id')
      .all(row.id) as Array<{ userId: string }>;
    if (
      !participants.length ||
      participants.some(({ userId }) => !hasCalendarPermission(activeMembers.get(userId), 'view'))
    ) {
      throw new WorkerError('INVALID_PROPOSAL');
    }
    let recipeSnapshot: unknown = null;
    if (row.recipeSnapshot !== null) {
      try {
        recipeSnapshot = JSON.parse(row.recipeSnapshot);
      } catch {
        throw new WorkerError('INVALID_PROPOSAL');
      }
    }
    return {
      eventId: stableEventId(proposalId, row.id),
      date: addDays(row.date, shift),
      mealType: row.mealType as SharedMealEventInput['mealType'],
      recipeId: row.recipeId,
      customMeal: row.customMeal,
      time: row.time,
      servings: row.servings,
      participantIds: participants.map(({ userId }) => userId),
      recipeSnapshot
    };
  });
}

function readLatestTaskWeek(
  db: Database.Database,
  householdId: string,
  targetWeekStart: string,
  zones: Array<{ id: string; label: string }>,
  activeMemberIds: string[],
  requireActiveAssignments = false
): TaskWeekContext | null {
  const row = db
    .prepare(
      `SELECT week_start AS weekStart FROM household_task_weeks
        WHERE household_id = ? AND week_start < ? ORDER BY week_start DESC LIMIT 1`
    )
    .get(householdId, targetWeekStart) as { weekStart: string } | undefined;
  if (!row) return null;
  const snapshot = readHouseholdTaskWeek(db, householdId, row.weekStart);
  const zoneIds = new Set(zones.map(({ id }) => id));
  const activeIds = new Set(activeMemberIds);
  for (const task of snapshot.tasks) {
    if (task.spaceId && !zoneIds.has(task.spaceId)) throw new WorkerError('INVALID_PROPOSAL');
  }
  // Old assignments are intentionally omitted from the AI context; only repeat mode inherits them.
  if (
    snapshot.tasks.some((task) => task.assignedMemberId && !activeIds.has(task.assignedMemberId))
  ) {
    if (requireActiveAssignments) throw new WorkerError('INVALID_PROPOSAL');
    // Keep the valid task context, but never allow a stale assignment to cross into a new plan.
    return {
      weekStart: row.weekStart,
      tasks: snapshot.tasks.map((task) =>
        task.assignedMemberId && !activeIds.has(task.assignedMemberId)
          ? { ...task, assignedMemberId: null }
          : task
      )
    };
  }
  return { weekStart: row.weekStart, tasks: snapshot.tasks };
}

function readPlanZones(
  db: Database.Database,
  householdId: string
): Array<{ id: string; label: string }> {
  const row = db
    .prepare('SELECT plan_json FROM household_plans WHERE household_id = ?')
    .get(householdId) as { plan_json: string } | undefined;
  if (!row) return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(row.plan_json);
  } catch {
    throw new WorkerError('INVALID_PROPOSAL');
  }
  const parsed = householdPlanSchema.safeParse(decoded);
  if (!parsed.success) throw new WorkerError('INVALID_PROPOSAL');
  const zones = parsed.data.floors.flatMap((floor) =>
    floor.spaces.map(({ id, label }) => ({ id, label }))
  );
  if (new Set(zones.map(({ id }) => id)).size !== zones.length)
    throw new WorkerError('INVALID_PROPOSAL');
  return zones;
}

function readActiveMembers(db: Database.Database, householdId: string): ActiveMember[] {
  return db
    .prepare(
      `SELECT user_id AS userId, id AS membershipId, permissions FROM household_members
        WHERE household_id = ? AND is_active = 1 ORDER BY user_id`
    )
    .all(householdId) as ActiveMember[];
}

function readAuthorizer(db: Database.Database, householdId: string): string | null {
  const row = db
    .prepare(
      'SELECT authorized_by AS authorizedBy FROM household_planning_automations WHERE household_id = ?'
    )
    .get(householdId) as { authorizedBy: string | null } | undefined;
  return row?.authorizedBy ?? null;
}

function assertTargetWeeksEmpty(
  db: Database.Database,
  householdId: string,
  targetWeekStart: string,
  scopes: HouseholdPlanningAutomationScope[]
): void {
  const targetWeekEnd = addDays(targetWeekStart, 6);
  if (scopes.includes('tasks')) {
    const targetTasks = db
      .prepare(
        'SELECT 1 AS present FROM household_task_weeks WHERE household_id = ? AND week_start = ?'
      )
      .get(householdId, targetWeekStart);
    if (targetTasks) throw new WorkerError('PUBLISH_CONFLICT');
  }
  if (scopes.includes('meals')) {
    const targetMeals = db
      .prepare(
        `SELECT 1 AS present FROM meals m JOIN weekly_calendars wc ON wc.id = m.calendar_id
          WHERE wc.household_id = ? AND m.date BETWEEN ? AND ? LIMIT 1`
      )
      .get(householdId, targetWeekStart, targetWeekEnd);
    if (targetMeals) throw new WorkerError('PUBLISH_CONFLICT');
  }
}

function assertNoManualCalendarConflicts(
  db: Database.Database,
  meals: readonly SharedMealEventInput[],
  householdId: string
): void {
  if (!meals.length) throw new WorkerError('INVALID_PROPOSAL');
  const participantIds = [...new Set(meals.flatMap(({ participantIds }) => participantIds))];
  if (!participantIds.length) throw new WorkerError('INVALID_PROPOSAL');
  const placeholders = participantIds.map(() => '?').join(', ');
  const events = db
    .prepare(
      `SELECT DISTINCT ce.id, ce.household_id AS householdId, ce.user_id AS userId,
              ce.date, ce.start_time AS startTime, ce.end_time AS endTime, ce.all_day AS allDay,
              ce.recurrence, ce.recurrence_rule AS recurrenceRule, ce.exceptions
         FROM calendar_events ce
         LEFT JOIN calendar_event_attendees cea ON cea.event_id = ce.id
        WHERE ce.household_id = ? OR ce.user_id IN (${placeholders}) OR cea.user_id IN (${placeholders})`
    )
    .all(householdId, ...participantIds, ...participantIds) as Array<{
    id: string;
    householdId: string | null;
    userId: string;
    date: string;
    startTime: string | null;
    endTime: string | null;
    allDay: number;
    recurrence: string;
    recurrenceRule: string | null;
    exceptions: string | null;
  }>;
  const from = meals.reduce((min, meal) => (meal.date < min ? meal.date : min), meals[0]!.date);
  const to = meals.reduce((max, meal) => (meal.date > max ? meal.date : max), meals[0]!.date);
  const attendees = new Map<string, Set<string>>();
  const eventIds = events.map(({ id }) => id);
  const eventPlaceholders = eventIds.map(() => '?').join(', ');
  for (const row of db
    .prepare(
      `SELECT event_id AS eventId, user_id AS userId FROM calendar_event_attendees
      WHERE event_id IN (${eventPlaceholders})`
    )
    .all(...eventIds) as Array<{ eventId: string; userId: string }>) {
    const set = attendees.get(row.eventId) ?? new Set<string>();
    set.add(row.userId);
    attendees.set(row.eventId, set);
  }

  for (const event of events) {
    const recurrence = readRecurrenceRule(event);
    const expanded = expandOccurrences(recurrence, { from, to }, 8);
    if (expanded.truncated) throw new WorkerError('PUBLISH_CONFLICT');
    const visibleMembers = new Set([event.userId, ...(attendees.get(event.id) ?? [])]);
    for (const date of expanded.dates) {
      for (const meal of meals) {
        if (meal.date !== date) continue;
        if (
          event.householdId !== householdId &&
          !meal.participantIds.some((id) => visibleMembers.has(id))
        ) {
          continue;
        }
        if (eventConflictsWithMeal(event, meal)) throw new WorkerError('PUBLISH_CONFLICT');
      }
    }
  }
}

function readRecurrenceRule(event: {
  date: string;
  recurrence: string;
  recurrenceRule: string | null;
  exceptions: string | null;
}): RecurrenceRule {
  if (!isIsoDate(event.date) || !isRecurrence(event.recurrence))
    throw new WorkerError('PUBLISH_CONFLICT');
  let schedule: unknown;
  if (event.recurrenceRule !== null) {
    try {
      schedule = JSON.parse(event.recurrenceRule);
    } catch {
      throw new WorkerError('PUBLISH_CONFLICT');
    }
    if (!isRecurrenceSchedule(schedule)) throw new WorkerError('PUBLISH_CONFLICT');
  }
  let exceptions: unknown = [];
  if (event.exceptions !== null) {
    try {
      exceptions = JSON.parse(event.exceptions);
    } catch {
      throw new WorkerError('PUBLISH_CONFLICT');
    }
    if (!Array.isArray(exceptions) || exceptions.some((date) => !isIsoDate(date))) {
      throw new WorkerError('PUBLISH_CONFLICT');
    }
  }
  return {
    date: event.date,
    recurrence: event.recurrence,
    ...(schedule ? { schedule: schedule as RecurrenceRule['schedule'] } : {}),
    exceptions: exceptions as string[]
  };
}

function eventConflictsWithMeal(
  event: { startTime: string | null; endTime: string | null; allDay: number },
  meal: SharedMealEventInput
): boolean {
  if (event.allDay === 1 || !meal.time || !event.startTime || !event.endTime) return true;
  if (!isClockTime(event.startTime) || !isClockTime(event.endTime)) return true;
  const mealMinute = timeToMinute(meal.time);
  const startMinute = timeToMinute(event.startTime);
  const endMinute = timeToMinute(event.endTime);
  if (startMinute === endMinute) return true;
  return endMinute > startMinute
    ? mealMinute >= startMinute && mealMinute < endMinute
    : mealMinute >= startMinute || mealMinute < endMinute;
}

function previousSundayAssignment(
  previous: TaskWeekContext | null,
  targetWeekStart: string,
  activeMemberIds: string[]
): PreviousDayTaskAssignment | null {
  if (!previous || previous.weekStart !== addDays(targetWeekStart, -7)) return null;
  const scheduledDate = addDays(targetWeekStart, -1);
  const activeIds = new Set(activeMemberIds);
  const assignedMemberIds = previous.tasks
    .filter(
      (task) =>
        task.scheduledDate === scheduledDate &&
        task.assignedMemberId &&
        activeIds.has(task.assignedMemberId)
    )
    .map((task) => task.assignedMemberId as string);
  return { scheduledDate, assignedMemberIds };
}

function occurrenceForRun(
  run: HouseholdPlanningAutomationRunSnapshot,
  schedule: HouseholdWeeklySchedule
): HouseholdWeeklyOccurrence | null {
  try {
    const occurrence = nextHouseholdWeeklyOccurrence(
      schedule,
      new Date(Date.parse(run.scheduledAt) - 1)
    );
    return occurrence.occurrenceKey === run.occurrenceKey &&
      occurrence.scheduledLocalDate === run.scheduledLocalDate &&
      nextMondayAfter(occurrence.scheduledLocalDate) === run.targetWeekStart
      ? occurrence
      : null;
  } catch {
    return null;
  }
}

function assertRunMatches(
  run: HouseholdPlanningAutomationRunSnapshot,
  mode: HouseholdPlanningAutomationMode,
  scopes: HouseholdPlanningAutomationScope[],
  schedule: HouseholdWeeklySchedule,
  occurrence: HouseholdWeeklyOccurrence
): void {
  if (
    run.mode !== mode ||
    run.scopes.length !== scopes.length ||
    !run.scopes.every((scope, index) => scope === scopes[index]) ||
    run.occurrenceKey !== occurrence.occurrenceKey ||
    run.timeZone !== schedule.timeZone ||
    run.targetWeekStart !== nextMondayAfter(occurrence.scheduledLocalDate)
  ) {
    throw new WorkerError('CONFIG_STALE');
  }
}

function classifyFailure(
  error: unknown,
  providerInvoked: boolean,
  signal?: AbortSignal
): HouseholdPlanningAutomationFailureCode {
  if (error instanceof WorkerError) return error.failureCode;
  if (error instanceof HouseholdTaskProposalError) return 'INVALID_PROPOSAL';
  if (error instanceof AutomatedHouseholdMealProposalError) return 'INVALID_PROPOSAL';
  if (error instanceof SharedMealPersistenceError) {
    return error.code === 'INVALID_INPUT' ? 'INVALID_PROPOSAL' : 'PUBLISH_CONFLICT';
  }
  if (error instanceof AiCallError) {
    if (
      error.code === 'TIMEOUT' ||
      error.detail === 'TIMEOUT' ||
      error.detail === 'CANCELLED' ||
      signal?.aborted
    ) {
      return providerInvoked ? 'PROVIDER_TIMEOUT_AMBIGUOUS' : 'WORKER_FAILURE';
    }
    if (error.code === 'BAD_JSON') return 'INVALID_PROPOSAL';
    if (error.code === 'NO_CONFIG') return 'WORKER_FAILURE';
    return 'PROVIDER_REJECTED';
  }
  if (signal?.aborted) return providerInvoked ? 'PROVIDER_TIMEOUT_AMBIGUOUS' : 'WORKER_FAILURE';
  if (providerInvoked) return 'PROVIDER_REJECTED';
  return 'WORKER_FAILURE';
}

function clockFor(
  fixedNow: Date | undefined,
  dependencies: HouseholdPlanningAutomationWorkerDependencies
): () => Date {
  if (dependencies.clock) return dependencies.clock;
  if (fixedNow) return () => new Date(fixedNow.getTime());
  return () => new Date();
}

function stableProposalId(householdId: string, occurrenceKey: string): string {
  return `auto-${createHash('sha256').update(`${householdId}\u0000${occurrenceKey}`).digest('hex').slice(0, 48)}`;
}

function stableEventId(proposalId: string, source: string): string {
  return `ev-${createHash('sha256').update(`${proposalId}\u0000${source}`).digest('hex').slice(0, 40)}`;
}

function nextMondayAfter(date: string): string {
  if (!isIsoDate(date)) throw new WorkerError('INVALID_PROPOSAL');
  const day = Date.parse(`${date}T00:00:00.000Z`);
  const weekday = new Date(day).getUTCDay() || 7;
  return new Date(day + (8 - weekday) * ISO_DAY_MS).toISOString().slice(0, 10);
}

function dayDifference(from: string, to: string): number {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new WorkerError('INVALID_PROPOSAL');
  return (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / ISO_DAY_MS;
}

function addDays(date: string, days: number): string {
  if (!isIsoDate(date) || !Number.isSafeInteger(days)) throw new WorkerError('INVALID_PROPOSAL');
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * ISO_DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function isClockTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timeToMinute(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour! * 60 + minute!;
}

function hasCalendarPermission(
  raw: string | null | undefined,
  permission: 'view' | 'edit'
): boolean {
  if (!raw) return false;
  try {
    const decoded: unknown = JSON.parse(raw);
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return false;
    const calendar = (decoded as Record<string, unknown>).calendar;
    return Boolean(
      calendar &&
      typeof calendar === 'object' &&
      !Array.isArray(calendar) &&
      (calendar as Record<string, unknown>)[permission] === true
    );
  } catch {
    return false;
  }
}
