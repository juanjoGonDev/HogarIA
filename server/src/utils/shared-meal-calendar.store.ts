import { nanoid } from 'nanoid';
import { z } from 'zod';
import { MEAL_PROPOSAL_LIMITS } from '../schemas/household-meal-proposal.schema.js';
import { activeHouseholdId } from './household-context.js';
import { ensureWeekCalendar, utcDate } from './week-calendar.js';

type SqliteDb = import('better-sqlite3').Database;

const MEAL_TYPES = new Set(['breakfast', 'lunch', 'snack', 'dinner']);
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const snapshotMinuteSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sharedRecipeSnapshotSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1000),
  baseServings: z.literal(1),
  times: z.object({
    prepTimeMinutes: snapshotMinuteSchema,
    cookTimeMinutes: snapshotMinuteSchema,
    totalTimeMinutes: snapshotMinuteSchema.nullable().optional(),
    restTimeMinutes: snapshotMinuteSchema.nullable().optional()
  }),
  ingredients: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        quantity: z.number().positive(),
        unit: z.string().trim().min(1).max(40),
        preparation: z.string().max(500).nullable().optional(),
        isOptional: z.boolean().optional(),
        substitutes: z.array(z.string().trim().min(1).max(200)).optional(),
        notes: z.string().max(500).nullable().optional()
      })
    )
    .min(1)
    .max(100),
  instructions: z.array(z.string().trim().min(1).max(2000)).min(1).max(100)
});

export type SharedMealErrorCode =
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'INVALID_PARTICIPANTS'
  | 'PROPOSAL_CONFLICT'
  | 'SLOT_CONFLICT'
  | 'HOUSEHOLD_CONTEXT_CHANGED';

export class SharedMealPersistenceError extends Error {
  constructor(
    readonly code: SharedMealErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SharedMealPersistenceError';
  }
}

export type SharedMealType = 'breakfast' | 'lunch' | 'snack' | 'dinner';

/**
 * Deliberately small persisted recipe projection: private generation prompts, member goals,
 * notes, guidance and other proposal metadata are neither accepted nor written.
 */
export interface SharedRecipeSnapshot {
  name: string;
  description: string;
  baseServings: 1;
  times: {
    prepTimeMinutes: number;
    cookTimeMinutes: number;
    totalTimeMinutes?: number | null;
    restTimeMinutes?: number | null;
  };
  ingredients: Array<{
    name: string;
    quantity: number;
    unit: string;
    preparation?: string | null;
    isOptional?: boolean;
    substitutes?: string[];
    notes?: string | null;
  }>;
  instructions: string[];
}

export interface SharedMealEventInput {
  /** Stable event id from the proposal; never derive it from the array position. */
  eventId: string;
  date: string;
  mealType: SharedMealType;
  recipeId?: string | null;
  customMeal?: string | null;
  time?: string | null;
  servings: number;
  participantIds: string[];
  /** Parsed recipe snapshot; unknown fields are intentionally dropped at the persistence edge. */
  recipeSnapshot?: unknown;
}

export interface SharedMealsInput {
  /** Stable parent proposal id; all events in this confirmation are committed atomically. */
  proposalId: string;
  events: SharedMealEventInput[];
  /** Reject a context switch after request parsing, before writing into another active home. */
  expectedHouseholdId?: string;
}

/** Backwards-compatible one-event input. Its single event key is `${proposalId}:single`. */
export interface SharedMealInput extends Omit<SharedMealEventInput, 'eventId'> {
  proposalId: string;
}

interface NormalizedSharedMealEvent {
  eventId: string;
  proposalKey: string;
  date: string;
  mealType: SharedMealType;
  recipeId: string | null;
  customMeal: string | null;
  time: string | null;
  servings: number;
  participantIds: string[];
  recipeSnapshot: SharedRecipeSnapshot | null;
  recipeSnapshotJson: string | null;
}

interface NormalizedSharedMealsInput {
  proposalId: string;
  events: NormalizedSharedMealEvent[];
  expectedHouseholdId?: string;
}

export interface PersistedSharedMeal {
  id: string;
  calendar_id: string;
  date: string;
  meal_type: string;
  recipe_id: string | null;
  custom_meal: string | null;
  time: string | null;
  servings: number;
  notes: null;
  completed: number;
  completed_at: string | null;
  source_proposal_id: string;
  proposal_id: string;
  recipe_snapshot: string | null;
  created_at: string;
}

export interface PersistSharedMealResult {
  meal: PersistedSharedMeal;
  idempotent: boolean;
}

export interface PersistSharedMealsResult {
  meals: PersistedSharedMeal[];
  idempotent: boolean;
}

function invalidInput(message: string): never {
  throw new SharedMealPersistenceError('INVALID_INPUT', message);
}

function normalizeRecipeSnapshot(raw: unknown): SharedRecipeSnapshot | null {
  if (raw == null) return null;
  const snapshot = sharedRecipeSnapshotSchema.safeParse(raw);
  if (!snapshot.success) return invalidInput('recipeSnapshot inválido');
  return snapshot.data;
}

function readRecipeSnapshot(raw: string | null): SharedRecipeSnapshot | null {
  if (!raw) return null;
  try {
    return normalizeRecipeSnapshot(JSON.parse(raw));
  } catch {
    // Calendar reads fail closed for corrupted snapshots instead of leaking arbitrary JSON.
    return null;
  }
}

function normalizeEvent(
  proposalId: string,
  input: SharedMealEventInput
): NormalizedSharedMealEvent {
  if (!input || typeof input !== 'object') return invalidInput('Evento compartido inválido');
  const eventId = typeof input.eventId === 'string' ? input.eventId.trim() : '';
  if (!eventId || eventId.length > 120 || eventId.includes(':')) {
    return invalidInput('eventId inválido');
  }
  const proposalKey = `${proposalId}:${eventId}`;

  if (typeof input.date !== 'string' || !utcDate(input.date)) {
    return invalidInput('date debe ser una fecha real YYYY-MM-DD');
  }
  if (typeof input.mealType !== 'string' || !MEAL_TYPES.has(input.mealType)) {
    return invalidInput('mealType inválido');
  }
  if (input.recipeId != null && typeof input.recipeId !== 'string') {
    return invalidInput('recipeId inválido');
  }
  if (input.customMeal != null && typeof input.customMeal !== 'string') {
    return invalidInput('customMeal inválido');
  }
  if (input.time != null && typeof input.time !== 'string') return invalidInput('time inválido');
  const recipeId = input.recipeId == null ? null : input.recipeId.trim();
  const snapshot = normalizeRecipeSnapshot(input.recipeSnapshot);
  const rawCustomMeal = input.customMeal == null ? null : input.customMeal.trim();
  const customMeal = rawCustomMeal ?? (recipeId ? null : (snapshot?.name ?? null));
  if (recipeId !== null && (!recipeId || recipeId.length > 40)) {
    return invalidInput('recipeId inválido');
  }
  if (customMeal !== null && (!customMeal || customMeal.length > 200)) {
    return invalidInput('customMeal inválido');
  }
  if (!recipeId && !customMeal) return invalidInput('La comida necesita receta o nombre');

  const time = input.time == null ? null : input.time.trim();
  if (time !== null && !TIME_RE.test(time)) return invalidInput('time debe tener formato HH:mm');
  if (!Number.isSafeInteger(input.servings) || input.servings <= 0) {
    return invalidInput('servings debe ser un entero positivo');
  }
  if (
    !Array.isArray(input.participantIds) ||
    input.participantIds.length === 0 ||
    input.participantIds.length > 100 ||
    input.participantIds.some((id) => typeof id !== 'string' || !id.trim())
  ) {
    return invalidInput('participantIds debe contener participantes válidos');
  }
  const participantIds = input.participantIds.map((id) => id.trim());
  if (new Set(participantIds).size !== participantIds.length) {
    return invalidInput('participantIds no puede repetir personas');
  }

  return {
    eventId,
    proposalKey,
    date: input.date,
    mealType: input.mealType,
    recipeId,
    customMeal,
    time,
    servings: input.servings,
    participantIds: [...participantIds].sort(),
    recipeSnapshot: snapshot,
    recipeSnapshotJson: snapshot ? JSON.stringify(snapshot) : null
  };
}

function normalizeBatch(raw: SharedMealsInput): NormalizedSharedMealsInput {
  if (!raw || typeof raw !== 'object') return invalidInput('Propuesta inválida');
  const proposalId = typeof raw.proposalId === 'string' ? raw.proposalId.trim() : '';
  if (!proposalId || proposalId.length > 200 || proposalId.includes(':')) {
    return invalidInput('proposalId inválido');
  }
  if (
    !Array.isArray(raw.events) ||
    raw.events.length === 0 ||
    raw.events.length > MEAL_PROPOSAL_LIMITS.maxEvents
  ) {
    return invalidInput(`events debe contener entre 1 y ${MEAL_PROPOSAL_LIMITS.maxEvents} eventos`);
  }
  if (
    raw.expectedHouseholdId !== undefined &&
    (typeof raw.expectedHouseholdId !== 'string' || !raw.expectedHouseholdId.trim())
  ) {
    return invalidInput('expectedHouseholdId inválido');
  }
  const events = raw.events.map((event) => normalizeEvent(proposalId, event));
  if (new Set(events.map(({ eventId }) => eventId)).size !== events.length) {
    return invalidInput('eventId no puede repetirse dentro de la propuesta');
  }
  return {
    proposalId,
    events,
    ...(raw.expectedHouseholdId ? { expectedHouseholdId: raw.expectedHouseholdId.trim() } : {})
  };
}

function canUseCalendarPermission(
  db: SqliteDb,
  householdId: string,
  userId: string,
  permission: 'view' | 'edit'
): boolean {
  const row = db
    .prepare(
      `SELECT permissions FROM household_members
       WHERE household_id = ? AND user_id = ? AND is_active = 1`
    )
    .get(householdId, userId) as { permissions: string | null } | undefined;
  return hasCalendarPermission(row?.permissions, permission);
}

function hasCalendarPermission(
  rawPermissions: string | null | undefined,
  permission: 'view' | 'edit'
): boolean {
  if (!rawPermissions) return false;
  try {
    const parsed: unknown = JSON.parse(rawPermissions);
    if (!parsed || typeof parsed !== 'object') return false;
    const calendar = (parsed as Record<string, unknown>).calendar;
    return Boolean(
      calendar &&
      typeof calendar === 'object' &&
      (calendar as Record<string, unknown>)[permission] === true
    );
  } catch {
    return false;
  }
}

function participantIdsForMeal(db: SqliteDb, mealId: string): string[] {
  return (
    db
      .prepare('SELECT user_id FROM meal_participants WHERE meal_id = ? ORDER BY user_id')
      .all(mealId) as { user_id: string }[]
  ).map(({ user_id }) => user_id);
}

function sameMeal(
  row: Record<string, unknown>,
  rowHouseholdId: string | null,
  rowOwnerId: string,
  householdId: string,
  actorId: string,
  proposalId: string,
  input: NormalizedSharedMealEvent,
  storedParticipants: string[]
): boolean {
  return (
    rowHouseholdId === householdId &&
    rowOwnerId === actorId &&
    row.proposal_id === proposalId &&
    row.source_proposal_id === input.proposalKey &&
    row.date === input.date &&
    row.meal_type === input.mealType &&
    row.recipe_id === input.recipeId &&
    row.custom_meal === input.customMeal &&
    row.time === input.time &&
    row.servings === input.servings &&
    row.recipe_snapshot === input.recipeSnapshotJson &&
    storedParticipants.length === input.participantIds.length &&
    storedParticipants.every((id, index) => id === input.participantIds[index])
  );
}

function assertNoProposalSlotOverlap(events: NormalizedSharedMealEvent[]): void {
  const assignedByTurn = new Set<string>();
  for (const event of events) {
    for (const participantId of event.participantIds) {
      const key = `${event.date}:${event.mealType}:${participantId}`;
      if (assignedByTurn.has(key)) {
        throw new SharedMealPersistenceError(
          'SLOT_CONFLICT',
          'Dos eventos de la propuesta asignan comidas distintas a la misma persona, fecha y turno'
        );
      }
      assignedByTurn.add(key);
    }
  }
}

function assertNoExistingSharedSlotConflict(
  db: SqliteDb,
  householdId: string,
  event: NormalizedSharedMealEvent
): void {
  const existing = db
    .prepare(
      `SELECT m.id, m.proposal_id, mp.user_id
       FROM meals m
       JOIN weekly_calendars wc ON wc.id = m.calendar_id
       JOIN meal_participants mp ON mp.meal_id = m.id
       WHERE wc.household_id = ? AND m.date = ? AND m.meal_type = ?
         AND m.source_proposal_id IS NOT NULL`
    )
    .all(householdId, event.date, event.mealType) as Array<{
    id: string;
    proposal_id: string | null;
    user_id: string;
  }>;
  if (existing.some((row) => event.participantIds.includes(row.user_id))) {
    throw new SharedMealPersistenceError(
      'SLOT_CONFLICT',
      'Ya existe otra comida compartida para un participante en esa fecha y turno'
    );
  }
}

/**
 * Saves every event in a confirmed weekly proposal in the existing calendar tables, in one
 * immediate transaction. Each event uses `${proposalId}:${eventId}` as its stable idempotency key.
 * Explicit participants share only that event; notes and private calendar goals are never accepted.
 */
export function persistSharedMeals(
  db: SqliteDb,
  actorId: string,
  rawInput: SharedMealsInput
): PersistSharedMealsResult {
  const input = normalizeBatch(rawInput);
  assertNoProposalSlotOverlap(input.events);
  if (typeof actorId !== 'string' || !actorId.trim()) {
    throw new SharedMealPersistenceError('FORBIDDEN', 'Se requiere un miembro activo');
  }

  const persist = db.transaction((): PersistSharedMealsResult => {
    const householdId = activeHouseholdId(db, actorId);
    if (input.expectedHouseholdId && householdId !== input.expectedHouseholdId) {
      throw new SharedMealPersistenceError(
        'HOUSEHOLD_CONTEXT_CHANGED',
        'El hogar activo cambió durante la confirmación'
      );
    }
    if (!householdId || !canUseCalendarPermission(db, householdId, actorId, 'edit')) {
      throw new SharedMealPersistenceError('FORBIDDEN', 'Se requiere permiso calendar.edit');
    }
    for (const event of input.events) {
      for (const participantId of event.participantIds) {
        if (!canUseCalendarPermission(db, householdId, participantId, 'view')) {
          throw new SharedMealPersistenceError(
            'INVALID_PARTICIPANTS',
            'Cada participante debe ser miembro activo con permiso calendar.view'
          );
        }
      }
    }

    const existingRows = db
      .prepare(
        `SELECT m.*, wc.household_id AS source_household_id, wc.user_id AS source_user_id
         FROM meals m JOIN weekly_calendars wc ON wc.id = m.calendar_id
         WHERE m.proposal_id = ?`
      )
      .all(input.proposalId) as Array<
      Record<string, unknown> & {
        id: string;
        source_household_id: string | null;
        source_user_id: string;
        source_proposal_id: string | null;
      }
    >;
    if (existingRows.length) {
      if (existingRows.length !== input.events.length) {
        throw new SharedMealPersistenceError(
          'PROPOSAL_CONFLICT',
          'proposalId ya está confirmado con otro conjunto de eventos'
        );
      }
      const byKey = new Map(existingRows.map((row) => [row.source_proposal_id, row]));
      const meals = input.events.map((event) => {
        const existing = byKey.get(event.proposalKey);
        if (
          !existing ||
          !sameMeal(
            existing,
            existing.source_household_id,
            existing.source_user_id,
            householdId,
            actorId,
            input.proposalId,
            event,
            participantIdsForMeal(db, existing.id)
          )
        ) {
          throw new SharedMealPersistenceError(
            'PROPOSAL_CONFLICT',
            'proposalId ya está confirmado con otros datos'
          );
        }
        return db
          .prepare('SELECT * FROM meals WHERE id = ?')
          .get(existing.id) as PersistedSharedMeal;
      });
      return { meals, idempotent: true };
    }

    const findExistingKey = db.prepare('SELECT id FROM meals WHERE source_proposal_id = ?');
    for (const event of input.events) {
      if (findExistingKey.get(event.proposalKey)) {
        throw new SharedMealPersistenceError(
          'PROPOSAL_CONFLICT',
          'proposalKey ya está asociado a otra propuesta'
        );
      }
      assertNoExistingSharedSlotConflict(db, householdId, event);
    }

    const calendars = new Map<string, ReturnType<typeof ensureWeekCalendar>>();
    const writeMeal = db.prepare(
      `INSERT INTO meals
       (id, calendar_id, date, meal_type, recipe_id, custom_meal, time, servings, notes,
        source_proposal_id, proposal_id, recipe_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
    );
    const writeParticipant = db.prepare(
      'INSERT INTO meal_participants (meal_id, user_id) VALUES (?, ?)'
    );
    const meals: PersistedSharedMeal[] = [];

    for (const event of input.events) {
      let calendar = calendars.get(event.date);
      if (!calendar) {
        calendar = ensureWeekCalendar(db, actorId, event.date);
        calendars.set(event.date, calendar);
      }
      if (!calendar || calendar.household_id !== householdId || calendar.user_id !== actorId) {
        throw new SharedMealPersistenceError(
          'FORBIDDEN',
          'No se pudo resolver el calendario activo'
        );
      }

      const mealId = nanoid();
      writeMeal.run(
        mealId,
        calendar.id,
        event.date,
        event.mealType,
        event.recipeId,
        event.customMeal,
        event.time,
        event.servings,
        event.proposalKey,
        input.proposalId,
        event.recipeSnapshotJson
      );
      for (const participantId of event.participantIds) writeParticipant.run(mealId, participantId);
      meals.push(db.prepare('SELECT * FROM meals WHERE id = ?').get(mealId) as PersistedSharedMeal);
    }

    return { meals, idempotent: false };
  });

  return persist.immediate();
}

/** Backwards-compatible one-event adapter. New proposal confirmation should use persistSharedMeals. */
export function persistSharedMeal(
  db: SqliteDb,
  actorId: string,
  rawInput: SharedMealInput
): PersistSharedMealResult {
  const { proposalId, ...event } = rawInput;
  const result = persistSharedMeals(db, actorId, {
    proposalId,
    events: [{ eventId: 'single', ...event }]
  });
  return { meal: result.meals[0], idempotent: result.idempotent };
}

/** Shared participant list for calendar projections; names are resolved only after authorization. */
export function listMealParticipants(
  db: SqliteDb,
  mealIds: string[],
  householdId: string
): Map<string, Array<{ id: string; name: string }>> {
  const byMeal = new Map<string, Array<{ id: string; name: string }>>();
  if (!mealIds.length) return byMeal;
  const placeholders = mealIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT mp.meal_id AS mealId, u.id, u.name, hm.permissions
       FROM meal_participants mp
       JOIN users u ON u.id = mp.user_id
       JOIN household_members hm ON hm.user_id = u.id AND hm.household_id = ? AND hm.is_active = 1
       WHERE mp.meal_id IN (${placeholders})
       ORDER BY u.name COLLATE NOCASE, u.id`
    )
    .all(householdId, ...mealIds) as Array<{
    mealId: string;
    id: string;
    name: string;
    permissions: string | null;
  }>;

  for (const row of rows) {
    if (!hasCalendarPermission(row.permissions, 'view')) continue;
    const participants = byMeal.get(row.mealId) ?? [];
    participants.push({ id: row.id, name: row.name });
    byMeal.set(row.mealId, participants);
  }
  return byMeal;
}

/** Recheck view permission at read time so revoking it hides an already assigned meal immediately. */
export function canViewSharedMeals(
  db: SqliteDb,
  householdId: string | null,
  userId: string
): householdId is string {
  return Boolean(householdId && canUseCalendarPermission(db, householdId, userId, 'view'));
}

/** Returns household-plan meals to any active calendar reader, with private fields stripped. */
export function listSharedMealsForHouseholdViewer(
  db: SqliteDb,
  userId: string,
  householdId: string | null,
  from: string,
  to: string
): Array<Record<string, unknown> & { id: string }> {
  if (!canViewSharedMeals(db, householdId, userId)) return [];

  const rows = db
    .prepare(
      `SELECT m.id,
              CASE WHEN wc.user_id = ? THEN m.calendar_id ELSE NULL END AS calendar_id,
              m.date, m.meal_type, m.recipe_id, m.custom_meal, m.time, m.servings,
              NULL AS notes, m.completed, m.completed_at, m.created_at,
              m.recipe_snapshot
       FROM meals m
       JOIN weekly_calendars wc ON wc.id = m.calendar_id
       WHERE m.date BETWEEN ? AND ?
         AND m.source_proposal_id IS NOT NULL
         AND wc.household_id = ?
       ORDER BY m.date,
         CASE m.meal_type
           WHEN 'breakfast' THEN 1
           WHEN 'lunch' THEN 2
           WHEN 'snack' THEN 3
           WHEN 'dinner' THEN 4
         END,
         m.time`
    )
    .all(userId, from, to, householdId) as Array<
    Record<string, unknown> & {
      id: string;
      recipe_snapshot: string | null;
      custom_meal: string | null;
    }
  >;
  const participantMap = listMealParticipants(
    db,
    rows.map(({ id }) => id),
    householdId
  );

  return rows.map((meal) => {
    const participants = participantMap.get(meal.id) ?? [];
    const recipeSnapshot = readRecipeSnapshot(meal.recipe_snapshot);
    return {
      ...meal,
      recipe_name: recipeSnapshot?.name ?? meal.custom_meal,
      recipe_snapshot: recipeSnapshot,
      isShared: true,
      participantIds: participants.map(({ id }) => id),
      participants
    };
  });
}
