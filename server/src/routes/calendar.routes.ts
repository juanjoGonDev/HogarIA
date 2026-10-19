import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { isDeepStrictEqual } from 'node:util';
import { getDatabase } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { zoneStampValue } from '../middleware/timestamp.middleware.js';
import {
  ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED,
  ASSISTANT_HOUSEHOLD_HEADER,
  assistantHouseholdContextMiddleware,
  currentAssistantHouseholdSnapshot
} from '../utils/ai-assistant-household-context.js';
import {
  ASSISTANT_ACTION_ID_HEADER,
  isAssistantActionId,
  withAssistantActionIdempotency
} from '../utils/assistant-action-idempotency.js';
import {
  calendarFilterSchema,
  createCalendarSchema,
  addMealSchema,
  updateMealSchema,
  replaceSelectedMealsSchema,
  updateGoalsSchema,
  calendarEventFilterSchema,
  createCalendarEventSchema,
  updateCalendarEventSchema
} from '../schemas/calendar.schema.js';
import { assistantUpdateCalendarEventSchema } from '../schemas/ai-assistant-calendar-update.schema.js';
import { ensureWeekCalendar } from '../utils/week-calendar.js';
import {
  dayFromISO,
  expandOccurrences,
  isRecurrenceSchedule,
  isRecurrence,
  occursOn,
  parseExceptionDates,
  type Recurrence,
  type RecurrenceSchedule
} from '../utils/calendar-recurrence.js';
import { readForm } from '../utils/form-body.js';
import { describeIssues } from '../schemas/form.js';
import { activeHouseholdId, activeHouseholdMemberCount } from '../utils/household-context.js';
import {
  canViewSharedMeals,
  listSharedMealsForHouseholdViewer
} from '../utils/shared-meal-calendar.store.js';
import { listHouseholdTasksForCalendarViewer } from '../utils/household-task-calendar.store.js';
import type { AppEnv } from '../types/hono-env.js';

const calendarRoutes = new Hono<AppEnv>();
calendarRoutes.use('*', authMiddleware);
calendarRoutes.use('*', assistantHouseholdContextMiddleware());

function sortMeals<T extends Record<string, unknown>>(meals: T[]): T[] {
  const order: Record<string, number> = { breakfast: 1, lunch: 2, snack: 3, dinner: 4 };
  return meals.sort((left, right) => {
    const dateOrder = String(left.date).localeCompare(String(right.date));
    if (dateOrder) return dateOrder;
    const typeOrder =
      (order[String(left.meal_type)] ?? 99) - (order[String(right.meal_type)] ?? 99);
    if (typeOrder) return typeOrder;
    return String(left.time ?? '').localeCompare(String(right.time ?? ''));
  });
}

// GET /api/calendar
calendarRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);

  // Get current week's calendar
  const personalCalendar = db
    .prepare(
      `
    SELECT * FROM weekly_calendars 
    WHERE user_id = ? AND household_id IS ?
    ORDER BY week_start DESC 
    LIMIT 1
  `
    )
    .get(userId, householdId) as any;

  // A confirmed home plan may exist before this member has created a personal weekly calendar.
  // In that case, project the most recent plan week without copying another member's goals or
  // materializing a calendar row just because it was read.
  let sharedPlanWeek: { week_start: string; week_end: string } | undefined;
  if (!personalCalendar && canViewSharedMeals(db, householdId, userId)) {
    sharedPlanWeek = db
      .prepare(
        `SELECT wc.week_start, wc.week_end
         FROM meals m
         JOIN weekly_calendars wc ON wc.id = m.calendar_id
         WHERE wc.household_id = ? AND m.source_proposal_id IS NOT NULL
         ORDER BY m.date DESC, m.created_at DESC
         LIMIT 1`
      )
      .get(householdId) as { week_start: string; week_end: string } | undefined;
  }

  const calendar =
    personalCalendar ??
    (sharedPlanWeek
      ? {
          id: null,
          household_id: householdId,
          user_id: userId,
          week_start: sharedPlanWeek.week_start,
          week_end: sharedPlanWeek.week_end,
          goals: '{}'
        }
      : null);

  if (!calendar) {
    return c.json({ success: true, data: null });
  }

  const personalMeals = personalCalendar
    ? (db
        .prepare(
          `
    SELECT m.*, r.name as recipe_name
    FROM meals m
    LEFT JOIN recipes r ON r.id = m.recipe_id
    WHERE m.calendar_id = ? AND m.source_proposal_id IS NULL
    ORDER BY m.date,
      -- El orden del dia: merienda antes que cena. Ver MEAL_ORDER en el modelo del frontend.
      CASE m.meal_type
        WHEN 'breakfast' THEN 1
        WHEN 'lunch' THEN 2
        WHEN 'snack' THEN 3
        WHEN 'dinner' THEN 4
      END
  `
        )
        .all(personalCalendar.id) as Array<Record<string, unknown>>)
    : [];
  const meals = sortMeals([
    ...personalMeals.map(({ source_proposal_id: _sourceProposalId, ...meal }) => meal),
    ...listSharedMealsForHouseholdViewer(
      db,
      userId,
      householdId,
      calendar.week_start,
      calendar.week_end
    )
  ]);

  return c.json({
    success: true,
    data: {
      ...calendar,
      goals: JSON.parse(calendar.goals || '{}'),
      meals
    }
  });
});

// GET /api/calendar/range?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//
// Lo que necesita la rejilla (mes / semana / dia): TODAS las comidas del rango
// visible. `GET /api/calendar` solo devuelve el ultimo calendario —una semana—,
// asi que en vista de mes todo lo demas salia vacio pase lo que pase.
calendarRoutes.get('/range', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);
  const today = new Date().toISOString().slice(0, 10);
  const parsed = calendarFilterSchema.safeParse({
    startDate: c.req.query('startDate') ?? undefined,
    endDate: c.req.query('endDate') ?? undefined
  });
  if (!parsed.success) {
    return c.json(
      { success: false, message: 'startDate y endDate deben tener formato YYYY-MM-DD' },
      400
    );
  }

  // Sin rango, la semana actual: la ruta sigue siendo util a mano.
  const startDate = parsed.data.startDate ?? today;
  const endDate = parsed.data.endDate ?? today;
  if (startDate > endDate) {
    return c.json({ success: false, message: 'startDate debe ser anterior a endDate' }, 400);
  }

  const personalMeals = db
    .prepare(
      `
    SELECT m.*, r.name AS recipe_name, r.calories AS recipe_calories
    FROM meals m
    LEFT JOIN recipes r ON r.id = m.recipe_id
    WHERE m.date BETWEEN ? AND ?
      AND m.source_proposal_id IS NULL
      AND m.calendar_id IN (
        SELECT id FROM weekly_calendars WHERE user_id = ? AND household_id IS ?
      )
    ORDER BY m.date,
      CASE m.meal_type
        WHEN 'breakfast' THEN 1
        WHEN 'lunch' THEN 2
        WHEN 'snack' THEN 3
        WHEN 'dinner' THEN 4
      END,
      m.time
  `
    )
    .all(startDate, endDate, userId, householdId) as Array<Record<string, unknown>>;

  // Una comida confirmada sigue siendo una sola fila de `meals`. Todos los lectores del calendario
  // del hogar ven el plan; participants conserva a quién va asignada. No se comparte el resto del
  // calendario personal ni se usa el switch general `shareCalendar`.
  const meals = sortMeals([
    ...personalMeals.map(({ source_proposal_id: _sourceProposalId, ...meal }) => meal),
    ...listSharedMealsForHouseholdViewer(db, userId, householdId, startDate, endDate)
  ]);

  // Objetivos de la semana que se esta mirando (si no existe, los ultimos).
  const goalsRow =
    (db
      .prepare(
        `
      SELECT goals FROM weekly_calendars
      WHERE user_id = ? AND household_id IS ? AND week_start <= ? AND week_end >= ?
      ORDER BY week_start DESC LIMIT 1
    `
      )
      .get(userId, householdId, startDate, endDate) as any) ||
    (db
      .prepare(
        'SELECT goals FROM weekly_calendars WHERE user_id = ? AND household_id IS ? ORDER BY week_start DESC LIMIT 1'
      )
      .get(userId, householdId) as any);

  let goals: Record<string, unknown> = {};
  try {
    goals = JSON.parse(goalsRow?.goals || '{}');
  } catch {
    goals = {};
  }

  const tasks = listHouseholdTasksForCalendarViewer(db, userId, householdId, startDate, endDate);

  return c.json({ success: true, data: { startDate, endDate, goals, meals, tasks } });
});

// POST /api/calendar
calendarRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  // `readForm` y no `createCalendarSchema.parse(body)`: el `parse` lanza, y un 500 con stack por un
  // hueco que el formulario anunciaba como opcional es exactamente la confusion que reporto el
  // usuario al decir que «el calendario da error si no mandas todos los campos».
  const parsed = await readForm(c, createCalendarSchema, 'Calendario');
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

  const db = getDatabase();

  // Una fila por semana y usuario: si la semana ya tiene calendario, se reutiliza
  // (antes cada POST creaba un duplicado y `GET /api/calendar` enseñaba otro).
  const calendar = ensureWeekCalendar(db, userId, input.weekStart, input.goals);
  if (!calendar) {
    return c.json({ success: false, message: 'weekStart debe ser una fecha real YYYY-MM-DD' }, 400);
  }

  if (input.goals) {
    db.prepare(
      'UPDATE weekly_calendars SET goals = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(JSON.stringify(input.goals), calendar.id);
  }

  return c.json({ success: true, data: calendar }, 201);
});

// POST /api/calendar/meals
calendarRoutes.post('/meals', async (c) => {
  const userId = c.get('userId');
  const parsed = await readForm(c, addMealSchema, 'Comida');
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

  const db = getDatabase();
  const id = nanoid();

  // La comida vive en el calendario de SU semana, creándolo si es la primera que
  // se guarda. El lunes se calcula sobre la cadena YYYY-MM-DD: con `new Date(iso)`
  // la medianoche UTC cae en el día anterior según la zona horaria y abría la
  // semana equivocada.
  const calendar = ensureWeekCalendar(db, userId, input.date);
  if (!calendar) {
    return c.json({ success: false, message: 'date debe ser una fecha real YYYY-MM-DD' }, 400);
  }

  // Los huecos se escriben como NULL: better-sqlite3 lanza con undefined. Si la UI no mandó raciones,
  // usar el tamaño actual de la casa activa; un número explícito sigue siendo editable.
  db.prepare(
    `
    INSERT INTO meals (id, calendar_id, date, meal_type, recipe_id, custom_meal, time, servings, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    calendar.id,
    input.date,
    input.mealType,
    input.recipeId ?? null,
    input.customMeal ?? null,
    input.time ?? null,
    input.servings ?? (activeHouseholdMemberCount(db, userId) || 2),
    input.notes ?? null
  );

  const meal = db.prepare('SELECT * FROM meals WHERE id = ?').get(id);

  return c.json({ success: true, data: meal }, 201);
});

// PATCH /api/calendar/meals/bulk/replace-selected — atomic planner replan commit.
calendarRoutes.patch('/meals/bulk/replace-selected', async (c) => {
  const userId = c.get('userId');
  const parsed = await readForm(c, replaceSelectedMealsSchema, 'Sustitución de comidas');
  if (!parsed.ok) return parsed.response;

  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);
  const replacements = parsed.data.replacements;
  const ids = replacements.map(({ id }) => id);
  const placeholders = ids.map(() => '?').join(', ');
  const owned = db
    .prepare(
      `
    SELECT m.id, m.completed
    FROM meals m
    JOIN weekly_calendars wc ON wc.id = m.calendar_id
    WHERE m.id IN (${placeholders}) AND wc.user_id = ? AND wc.household_id IS ?
  `
    )
    .all(...ids, userId, householdId) as Array<{ id: string; completed: number | null }>;

  // Valida TODO el conjunto antes de escribir para que un ID obsoleto/ajeno nunca deje
  // una selección parcialmente aplicada.
  if (owned.length !== replacements.length) {
    return c.json(
      { success: false, code: 'MEAL_NOT_FOUND', message: 'Alguno de los platos ya no existe.' },
      404
    );
  }
  if (owned.some((meal) => meal.completed === 1)) {
    return c.json(
      {
        success: false,
        code: 'MEAL_ALREADY_COMPLETED',
        message: 'No se pueden sustituir comidas ya completadas.'
      },
      409
    );
  }

  const select = db.prepare('SELECT * FROM meals WHERE id = ?');
  const update = db.prepare(`
    UPDATE meals
    SET recipe_id = NULL, custom_meal = ?, completed = 0, completed_at = NULL
    WHERE id = ?
  `);
  const applyAll = db.transaction(() => {
    for (const replacement of replacements) update.run(replacement.customMeal, replacement.id);
    return replacements.map(({ id }) => select.get(id));
  });
  const meals = applyAll();
  return c.json({ success: true, data: meals });
});

// PATCH /api/calendar/meals/:id
calendarRoutes.patch('/meals/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const parsed = await readForm(c, updateMealSchema, 'Comida');
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);

  const updates: string[] = [];
  const values: any[] = [];

  if (input.recipeId !== undefined) {
    updates.push('recipe_id = ?');
    values.push(input.recipeId);
  }
  if (input.customMeal !== undefined) {
    updates.push('custom_meal = ?');
    values.push(input.customMeal);
  }
  // Faltaba esta linea: el dialog de editar mandaba `time` y la ruta no lo escribia NUNCA, asi que
  // cambiar la hora de una comida era un «Comida actualizada» que no cambiaba nada. `null` si vale,
  // y vale para quitarla —que hasta aqui era lo unico que no se podia hacer.
  if (input.time !== undefined) {
    updates.push('time = ?');
    values.push(input.time);
  }
  if (input.servings !== undefined) {
    updates.push('servings = ?');
    values.push(input.servings ?? 1);
  }
  if (input.notes !== undefined) {
    updates.push('notes = ?');
    values.push(input.notes);
  }
  if (input.completed !== undefined) {
    updates.push('completed = ?');
    values.push(input.completed ? 1 : 0);
    if (input.completed) {
      updates.push('completed_at = CURRENT_TIMESTAMP');
    }
  }

  if (updates.length > 0) {
    values.push(id);
    values.push(userId, householdId);
    const result = db
      .prepare(
        `
      UPDATE meals SET ${updates.join(', ')}
      WHERE id = ? AND calendar_id IN (
        SELECT id FROM weekly_calendars WHERE user_id = ? AND household_id IS ?
      )
    `
      )
      .run(...values);
    if (result.changes === 0) {
      return c.json(
        { success: false, code: 'MEAL_NOT_FOUND', message: 'No se encuentra esa comida.' },
        404
      );
    }
  }

  const meal = db
    .prepare(
      `
    SELECT m.* FROM meals m
    JOIN weekly_calendars wc ON wc.id = m.calendar_id
    WHERE m.id = ? AND wc.user_id = ? AND wc.household_id IS ?
  `
    )
    .get(id, userId, householdId);
  if (!meal) {
    return c.json(
      { success: false, code: 'MEAL_NOT_FOUND', message: 'No se encuentra esa comida.' },
      404
    );
  }
  return c.json({ success: true, data: meal });
});

// DELETE /api/calendar/meals/:id
calendarRoutes.delete('/meals/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);

  const result = db
    .prepare(
      `
    DELETE FROM meals WHERE id = ? AND calendar_id IN (
      SELECT id FROM weekly_calendars WHERE user_id = ? AND household_id IS ?
    )
  `
    )
    .run(id, userId, householdId);
  if (result.changes === 0) {
    return c.json({ success: false, message: 'Meal not found' }, 404);
  }

  return c.json({ success: true, message: 'Meal deleted' });
});

// PATCH /api/calendar/goals
calendarRoutes.patch('/goals', async (c) => {
  const userId = c.get('userId');
  const parsed = await readForm(c, updateGoalsSchema, 'Objetivos');
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);

  // `weekStart` es opcional: el calendario que se está mirando, no «el último».
  // Antes, si la semana no tenía fila, respondía 404 y la interfaz lo enseñaba
  // como un guardado correcto igualmente.
  const { weekStart } = parsed.body as { weekStart?: string };
  const calendar = ensureWeekCalendar(
    db,
    userId,
    weekStart ?? new Date().toISOString().slice(0, 10)
  );
  if (!calendar) {
    return c.json({ success: false, message: 'weekStart debe ser una fecha real YYYY-MM-DD' }, 400);
  }

  db.prepare(
    `
    UPDATE weekly_calendars SET goals = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND household_id IS ?
  `
  ).run(JSON.stringify(input), calendar.id, userId, householdId);

  return c.json({
    success: true,
    message: 'Goals updated',
    data: { weekStart: calendar.week_start }
  });
});

// ---------------------------------------------------------------------------
// Sueltas de la casa (HOGARIA-SPEC 8f)
// ---------------------------------------------------------------------------
//
// Dos decisiones que valen la pena decir en voz alta:
//
// 1. Las COMIDAS no se copian aqui. Se leen desde `meals` en la proyeccion, y punto:
//    en cuanto una cena duplicada en dos tablas puede existir, una de las dos va a
//    estar equivocada. Por eso el POST con kind 'meal' se rechaza en vez de "funcionar".
// 2. Se ve en toda la casa, se toca solo por quien lo escribio. El carpintero del
//    martes interesa a los dos; borrar la cita medica de otra persona, no.

type CalendarEventRow = {
  id: string;
  household_id: string | null;
  user_id: string;
  title: string;
  kind: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  all_day: number;
  color: string | null;
  notes: string | null;
  location: string | null;
  source: string;
  /** Cadencia de la serie (HOGARIA-SPEC 12t-R). En una base antigua puede faltar: se lee como `none`. */
  recurrence?: string;
  /** Regla avanzada en JSON, ausente en las filas anteriores a §12at. */
  recurrence_rule?: string | null;
  /** Dias que esta serie, concretamente, no ocurre. JSON en una columna TEXT. */
  exceptions?: string | null;
};

const EVENT_COLUMNS =
  'id, household_id, user_id, title, kind, date, start_time, end_time, all_day, color, notes, location, recurrence, recurrence_rule, exceptions, source';

/** Quien escribio la suelta: el nombre y su foto, resueltos de una vez para toda la lista. */
type Author = { name: string; avatar: string | null };

/** Un invitado. Lleva id porque el dialog tiene que poder volver a marcarlo sin otra peticion. */
type Attendee = Author & { id: string };

/**
 * Un booleano de formulario en la columna 0/1 de SQLite. `flag` existe porque el schema acepta
 * `true`/`false`/`null`/ausente (y la URL, `1`/`0`), y cada ruta que lo convierta a mano acaba
 * escribiendo `input.allDay === true || input.allDay === 1` —que es la linea que dejo de compilar
 * en cuanto el campo admitio `null`, y que alguien volveria a escribir igual manana.
 */
function flag(value: unknown, whenMissing: 0 | 1): 0 | 1 {
  if (value === undefined || value === null) return whenMissing;
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function toEvent(row: CalendarEventRow, author: Author | null): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    allDay: row.all_day === 1,
    color: row.color,
    notes: row.notes,
    location: row.location,
    source: row.source,
    userId: row.user_id,
    authorName: author?.name ?? null,
    authorAvatar: author?.avatar ?? null,
    // La cadencia viaja con la fila, y `seriesDate` es el dia que la fila define de verdad: quien abre
    // el dialog sobre un martes concreto necesita poder cambiar el titulo sin moverle el ancla a la
    // serie (12t-R).
    recurrence: isRecurrence(row.recurrence) ? row.recurrence : 'none',
    recurrenceRule: readRecurrenceRule(row.recurrence_rule),
    seriesDate: row.date
  };
}

/** Deserializa reglas guardadas sin hacer que una fila antigua o dañada tumbe el listado entero. */
function readRecurrenceRule(raw: string | null | undefined): RecurrenceSchedule | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecurrenceSchedule(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Quien puede ver: lo de la casa (si la hay) y lo propio, aunque no haya casa. El
 * `household_id` NO viene del token: se lee de `users`, igual que en la compra, porque
 * cambiar de casa a mitad de temporada no puede dejar eventos huerfanos.
 */
/** Subconsulta comun a las dos formas del ambito: «me invitaron a esto». */
const INVITED_CLAUSE = 'id IN (SELECT event_id FROM calendar_event_attendees WHERE user_id = ?)';

function eventScope(userId: string, householdSnapshot?: string | null) {
  const db = getDatabase();
  const user = db.prepare('SELECT household_id AS hid FROM users WHERE id = ?').get(userId) as
    { hid: string | null } | undefined;
  const householdId = householdSnapshot === undefined ? (user?.hid ?? null) : householdSnapshot;
  // Un evento al que te han invitado se ve, casa o no casa: una invitacion que no se ve es una
  // invitacion que no ha funcionado, y esa es justo la pregunta que hace el usuario al invitar.
  return householdId
    ? {
        clause: `(household_id = ? OR user_id = ? OR ${INVITED_CLAUSE})`,
        params: [householdId, userId, userId],
        userId,
        householdId
      }
    : {
        clause: `(user_id = ? OR ${INVITED_CLAUSE})`,
        params: [userId, userId],
        userId,
        householdId: null
      };
}

/**
 * Los invitados de las sueltas, de una vez para toda la lista (no una consulta por evento, que en
 * la vista de mes son 42 dias). El autor NO esta aqui: lo ve por ser el autor, y guardarlo en la
 * misma tabla permitiria que «salir del evento» le quitara su propio evento.
 */
function attendeesByEvent(
  db: ReturnType<typeof getDatabase>,
  eventIds: string[]
): Map<string, Attendee[]> {
  const byEvent = new Map<string, Attendee[]>();
  if (!eventIds.length) return byEvent;
  const marks = eventIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT a.event_id AS eventId, u.id, u.name, u.avatar
       FROM calendar_event_attendees a
       JOIN users u ON u.id = a.user_id
       WHERE a.event_id IN (${marks})
       ORDER BY u.name ASC`
    )
    .all(...eventIds) as unknown as ({ eventId: string } & Attendee)[];
  for (const row of rows) {
    const list = byEvent.get(row.eventId);
    const person = { id: row.id, name: row.name, avatar: row.avatar };
    if (list) list.push(person);
    else byEvent.set(row.eventId, [person]);
  }
  return byEvent;
}

/**
 * Reemplaza la lista de invitados. Dos cosas que se negrian aqui y que valen la pena dichas:
 *  - un id que no es de esta casa se DEVUELVE, no se ignora —una invitacion a medias sin aviso es
 *    peor que un error, porque quien invita cree que la otra persona ya lo ve;
 *  - el autor se filtra: no se auto-invita, se le invita a uno mismo por un checkbox mal puesto.
 */
function replaceAttendees(
  db: ReturnType<typeof getDatabase>,
  eventId: string,
  wanted: string[],
  actorId: string,
  householdId: string | null
): { inserted: number; rejected: string[] } {
  const allowed = new Set<string>([actorId]);
  if (householdId) {
    const members = db
      .prepare('SELECT user_id AS id FROM household_members WHERE household_id = ?')
      .all(householdId) as unknown as { id: string }[];
    for (const member of members) allowed.add(member.id);
  }
  const unique = [...new Set(wanted)].filter((id) => id && id !== actorId);
  const rejected = unique.filter((id) => !allowed.has(id));
  const accepted = unique.filter((id) => allowed.has(id));

  db.prepare('DELETE FROM calendar_event_attendees WHERE event_id = ?').run(eventId);
  if (accepted.length) {
    const insert = db.prepare(
      'INSERT INTO calendar_event_attendees (event_id, user_id, added_by) VALUES (?, ?, ?)'
    );
    for (const id of accepted) insert.run(eventId, id, actorId);
  }
  return { inserted: accepted.length, rejected };
}

// GET /api/calendar/events?from=&to=&kinds=
calendarRoutes.get('/events', async (c) => {
  const db = getDatabase();
  const parsed = calendarEventFilterSchema.safeParse({
    from: c.req.query('from'),
    to: c.req.query('to'),
    kinds: c.req.query('kinds'),
    limit: c.req.query('limit') ?? undefined
  });
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        message: 'from y to son obligatorios (AAAA-MM-DD)',
        issues: parsed.error.issues
      },
      400
    );
  }
  const { from, to, kinds, limit } = parsed.data;
  const scope = eventScope(c.get('userId') as string);

  // Un filtro de tipos que no deja NINGUN tipo valido no es "ensename todo": es una
  // peticion rara, y contestar la lista entera seria el peor comportamiento posible.
  const kindsClause = kinds.length ? 'kind IN (' + kinds.map(() => '?').join(', ') + ') AND' : '';

  // La ventana se abre por la IZQUIERDA para las series: una casa que empezo «sacar la basura» en
  // marzo la quiere seguir viendo en octubre. Por la derecha no se abre: lo que empieza despues de
  // `to` no ha empezado aun. `exceptions` no se filtra aqui —son dias sueltos, y la expansion los
  // salta— para que el SQL no tenga que saber de JSON.
  const filters: string[] = [...kinds, to, from, ...scope.params, String(limit)];
  const rows = db
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM calendar_events
       WHERE ${kindsClause} date <= ? AND (recurrence != 'none' OR recurrence_rule IS NOT NULL OR date >= ?) AND ${scope.clause}
       ORDER BY date ASC, all_day DESC, start_time ASC, id ASC
       LIMIT ?`
    )
    .all(...filters) as unknown as CalendarEventRow[];

  const authors = new Map<string, Author>();
  const names = db.prepare('SELECT id, name, avatar FROM users').all() as unknown as {
    id: string;
    name: string;
    avatar: string | null;
  }[];
  for (const n of names) authors.set(n.id, { name: n.name, avatar: n.avatar });

  // Una sola lectura para toda la pagina, no una por evento: en la vista de mes son 42 dias.
  const invited = attendeesByEvent(
    db,
    rows.map((row) => row.id)
  );

  // Cada fila se materializa en los dias que ocupa de la ventana (HOGARIA-SPEC 12t-R). Se expande
  // DESPUES del LIMIT a proposito: «200 filas» sigue significando 200 sueltas escritas por alguien, no
  // dos semanas de un cepillo de dientes que se repite. Y se expande con la ventana ya aplicada, que
  // es lo que hace que una serie empezada en enero se vea entera en octubre.
  const data: Record<string, unknown>[] = [];
  let truncated = false;
  for (const row of rows) {
    const expansion = expandOccurrences(
      {
        date: row.date,
        recurrence: (isRecurrence(row.recurrence) ? row.recurrence : 'none') as Recurrence,
        schedule: readRecurrenceRule(row.recurrence_rule) ?? undefined,
        exceptions: row.exceptions ?? null
      },
      { from, to }
    );
    truncated = truncated || expansion.truncated;
    const base = toEvent(row, authors.get(row.user_id) ?? null);
    // Los invitados van en la proyeccion y no en un detalle aparte: en la rejilla se pintan las
    // caras, y una cara sin nombre debajo (o un nombre sin cara) es media identidad.
    const attendees = invited.get(row.id) ?? [];
    for (const date of expansion.dates) {
      data.push({
        ...base,
        // `date` es el dia que se pinta (cada ocurrencia es un objeto, y el `trackBy` del frontend
        // sigue funcionando porque comparten el `id` de la serie: lo que se edite, se edita en serie).
        date,
        attendees,
        // La pareja `attendees` / `attendeeIds` es lo que el dialogo de edicion necesita para pintar las
        // casillas marcadas. Sin `attendeeIds` en el listado, abrir «editar» sobre un evento con dos
        // invitados los mostraba con dos caras y cero casillas, y guardar las borraba.
        attendeeIds: attendees.map((person) => person.id),
        // El frontend no adivina si puede editar: lo dice el servidor, que es quien sabe
        // quien es quien. Y es `editable`, no `es mio`, porque el dia que haya roles de
        // admin de casa solo hay que cambiar esta linea.
        editable: row.user_id === scope.userId
      });
    }
  }

  return c.json({
    success: true,
    data,
    // Se avisa de que la ventana corto una serie: mejor un «no te fies» en el payload que un calendario
    // que parece incompleto sin decir por que.
    ...(truncated ? { truncated: true } : {})
  });
});

// POST /api/calendar/events
calendarRoutes.post('/events', async (c) => {
  const db = getDatabase();
  const body = await c.req.json().catch(() => ({}));
  const assistantSnapshot = currentAssistantHouseholdSnapshot(c);
  if (!assistantSnapshot.valid) {
    return c.json({ success: false, code: ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED }, 409);
  }
  const parsed = createCalendarEventSchema.safeParse(body);
  if (!parsed.success) {
    // `describeIssues` en vez del primer issue de zod: el mensaje suelto decia «Invalid input» con
    // el campo en ingles, y quien rellenaba el dialog no sabia a donde volver.
    return c.json({ success: false, code: 'INVALID_FORM', ...describeIssues(parsed.error) }, 400);
  }
  const input = parsed.data;
  if (input.kind === 'meal') {
    return c.json(
      {
        success: false,
        message: 'MEAL_COMES_FROM_THE_PLAN',
        data: {
          hint: 'La comida se planifica en el calendario de comidas; aqui van las otras cosas de la casa.'
        }
      },
      400
    );
  }

  const userId = c.get('userId') as string;
  const scope = eventScope(userId, assistantSnapshot.householdId);
  const householdId = scope.householdId;
  const actionId = c.req.header(ASSISTANT_ACTION_ID_HEADER);
  if (actionId && input.sharedWithHousehold && !householdId) {
    return c.json({ success: false, code: 'ASSISTANT_HOUSEHOLD_REQUIRED' }, 409);
  }
  // Sin `allDay` explicito, «sin hora» significa «todo el dia»: es la nota de la que no se sabe la
  // hora, no un evento de cero minutos a medianoche.
  const allDay = flag(input.allDay, input.startTime ? 0 : 1);

  const result = withAssistantActionIdempotency(
    db,
    userId,
    actionId,
    { operation: 'calendar.create_event', householdId, input },
    () => {
      if (!currentAssistantHouseholdSnapshot(c).valid) {
        return {
          body: { success: false, code: ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED },
          status: 409,
          record: false
        };
      }
      const id = nanoid();
      db.prepare(
        `INSERT INTO calendar_events
     (id, household_id, user_id, title, kind, date, start_time, end_time, all_day, color, notes, location, recurrence, recurrence_rule, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user')`
      ).run(
        id,
        // Sin casa la suelta es solo tuya; con casa, solo se comparte si quien la escribe
        // lo pide. Una cita medica no es automaticamente de la familia.
        input.sharedWithHousehold ? householdId : null,
        userId,
        input.title,
        input.kind,
        input.date,
        input.startTime ?? null,
        input.endTime ?? null,
        allDay,
        input.color ?? null,
        input.notes ?? null,
        input.location ?? null,
        // `exceptions` empieza vacia a proposito: no es un campo del formulario.
        input.recurrence ?? 'none',
        input.recurrenceRule ? JSON.stringify(input.recurrenceRule) : null
      );

      // Los invitados se escriben DESPUES del insert y antes de responder: si la lista era imposible
      // (ids de fuera de la casa) el evento existe igualmente —la suelta ya estaba guardada—, pero el
      // 400 dice quien no se pudo invitar en vez de dejarlo a medias sin decir nada.
      let rejected: string[] = [];
      if (input.attendeeIds) {
        const outcome = replaceAttendees(db, id, input.attendeeIds, userId, householdId);
        rejected = outcome.rejected;
      }
      if (rejected.length) {
        return {
          body: {
            success: false,
            message: 'Algun invitado no es de tu casa',
            code: 'ATTENDEE_NOT_IN_HOUSEHOLD',
            data: { rejected, id }
          },
          status: 400
        };
      }

      const row = db
        .prepare(`SELECT ${EVENT_COLUMNS} FROM calendar_events WHERE id = ?`)
        .get(id) as unknown as CalendarEventRow;
      const attendees = attendeesByEvent(db, [id]).get(id) ?? [];
      return {
        body: {
          success: true,
          data: {
            ...toEvent(row, null),
            editable: true,
            // El dialog se rellena con esto sin otra peticion: los ids para el selector y las caras para
            // la lista, en el mismo sitio, porque «invitado» y «invitado con nombre» no pueden divergir.
            attendees,
            attendeeIds: attendees.map((person) => person.id)
          }
        },
        status: 201
      };
    }
  );
  if ('error' in result) {
    return result.error === 'invalid_action_id'
      ? c.json({ success: false, code: 'ASSISTANT_ACTION_ID_INVALID' }, 400)
      : c.json({ success: false, code: 'ASSISTANT_ACTION_ID_CONFLICT' }, 409);
  }
  return c.json(result.body, result.status);
});

// PATCH /api/calendar/events/:id
calendarRoutes.patch('/events/:id', async (c) => {
  const db = getDatabase();
  const id = c.req.param('id');
  const userId = c.get('userId') as string;
  const existing = db.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id) as
    | (CalendarEventRow & {
        user_id: string;
        all_day: number;
        start_time: string | null;
        end_time: string | null;
      })
    | undefined;
  if (!existing) return c.json({ success: false, message: 'Evento no encontrado' }, 404);
  // Escrita en el sitio: ver el evento de otra persona no es poder reescribirlo.
  if (existing.user_id !== userId) {
    return c.json(
      {
        success: false,
        message: 'FORBIDDEN',
        data: { hint: 'Solo quien lo escribio puede cambiarlo.' }
      },
      403
    );
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = updateCalendarEventSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, code: 'INVALID_FORM', ...describeIssues(parsed.error) }, 400);
  }
  const input = parsed.data as Record<string, unknown> & { attendeeIds?: string[] | null };

  const nextSchedule =
    input.recurrenceRule !== undefined
      ? (input.recurrenceRule as RecurrenceSchedule | null)
      : input.recurrence !== undefined
        ? null
        : readRecurrenceRule(existing.recurrence_rule);
  const nextSeriesDate = typeof input.date === 'string' ? input.date : existing.date;
  if (nextSchedule?.end.type === 'date' && nextSchedule.end.date < nextSeriesDate) {
    return c.json(
      {
        success: false,
        code: 'INVALID_FORM',
        message: 'La fecha final no puede ser anterior al inicio de la serie',
        issues: [
          {
            field: 'recurrenceRule.end.date',
            message: 'La fecha final no puede ser anterior al inicio de la serie'
          }
        ]
      },
      400
    );
  }

  const set: string[] = [];
  const params: (string | number | null)[] = [];
  const put = (column: string, value: unknown) => {
    if (value === undefined) return;
    set.push(`${column} = ?`);
    params.push(value === null ? null : (value as string | number));
  };
  put('title', input.title);
  put('kind', input.kind);
  put('date', input.date);
  put('start_time', input.startTime);
  put('end_time', input.endTime);
  put('color', input.color);
  put('notes', input.notes);
  put('location', input.location);
  put('recurrence', input.recurrence);
  if (input.recurrenceRule !== undefined) {
    set.push('recurrence_rule = ?');
    params.push(input.recurrenceRule === null ? null : JSON.stringify(input.recurrenceRule));
  } else if (input.recurrence !== undefined) {
    // Al volver a la cadencia legacy se quita la regla avanzada que, de otro modo, tendría prioridad.
    set.push('recurrence_rule = NULL');
  }
  // Dos limpiezas que solo aqui se pueden hacer, y que sin ellas dejan basura con aspecto de dato:
  // 1) quitar la cadencia vacia los dias excluidos —una excepcion sin serie no significa nada, y
  //    volveria a molestar el dia que la cosa vuelva a repetirse—;
  // 2) mover el inicio de la serie a un dia que estaba quitado borra esa excepcion, porque lo que se
  //    pidio explicitamente es que la serie empiece (y por tanto ocurra) ese dia.
  if (input.recurrence === 'none' && !input.recurrenceRule) put('exceptions', '[]');
  const diaNuevo = typeof input.date === 'string' ? input.date : null;
  if (diaNuevo) {
    const antes = parseExceptionDates(existing.exceptions);
    const despues = antes.filter((dia) => dia !== diaNuevo);
    if (despues.length !== antes.length) put('exceptions', JSON.stringify(despues));
  }
  if (input.allDay !== undefined) {
    set.push('all_day = ?');
    params.push(flag(input.allDay, 0));
  }
  // Cambiar de hora a todo el dia tiene que BORRAR las horas: si no, la siguiente
  // edicion ve un evento 'todo el dia' con 19:30 dentro y nadie sabe cual manda.
  if (flag(input.allDay, existing.all_day as 0 | 1) === 1) {
    set.push('start_time = NULL', 'end_time = NULL');
  }
  // Las horas se comprueban SOBRE LA FILA RESULTANTE, no sobre lo que llego: un PATCH
  // que solo manda endTime puede dejar el final antes del principio, y ese evento no
  // lo rechaza ningun schema que valide partes.
  const nextStart = input.startTime ?? existing.start_time ?? null;
  const nextEnd = input.endTime ?? existing.end_time ?? null;
  const nextAllDay = flag(input.allDay, existing.all_day as 0 | 1);
  if (!nextAllDay && nextStart && nextEnd && nextEnd < nextStart) {
    return c.json({ success: false, message: 'endTime no puede ser anterior a startTime' }, 400);
  }
  // Guardar el titulo sin tocar a nadie NO es «nada que actualizar» si la lista de invitados
  // cambia: `attendeeIds` es una escritura, y vacia lo es tanto como llena.
  const wantsAttendees = input.attendeeIds !== undefined;
  if (!set.length && !wantsAttendees) {
    return c.json({ success: false, message: 'Nada que actualizar' }, 400);
  }

  if (set.length) {
    params.push(id);
    db.prepare(
      `UPDATE calendar_events SET ${set.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(...params);
  }

  let rejected: string[] = [];
  if (wantsAttendees) {
    const outcome = replaceAttendees(
      db,
      id,
      input.attendeeIds ?? [],
      userId,
      eventScope(userId).householdId
    );
    rejected = outcome.rejected;
  }
  if (rejected.length) {
    return c.json(
      {
        success: false,
        message: 'Algun invitado no es de tu casa',
        code: 'ATTENDEE_NOT_IN_HOUSEHOLD',
        data: { rejected, id }
      },
      400
    );
  }

  const row = db
    .prepare(`SELECT ${EVENT_COLUMNS} FROM calendar_events WHERE id = ?`)
    .get(id) as unknown as CalendarEventRow;
  const attendees = attendeesByEvent(db, [id]).get(id) ?? [];
  return c.json({
    success: true,
    data: {
      ...toEvent(row, null),
      editable: true,
      attendees,
      attendeeIds: attendees.map((person) => person.id)
    }
  });
});

calendarRoutes.patch('/events/:id/assistant-update', async (c) => {
  const actionId = c.req.header(ASSISTANT_ACTION_ID_HEADER);
  if (!actionId) return c.json({ success: false, code: 'ASSISTANT_ACTION_ID_REQUIRED' }, 400);
  if (!isAssistantActionId(actionId)) {
    return c.json({ success: false, code: 'ASSISTANT_ACTION_ID_INVALID' }, 400);
  }
  if (c.req.header(ASSISTANT_HOUSEHOLD_HEADER) === undefined) {
    return c.json({ success: false, code: 'ASSISTANT_HOUSEHOLD_CONTEXT_REQUIRED' }, 400);
  }

  const rawBody = await c.req.json().catch(() => null);
  const parsed = assistantUpdateCalendarEventSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ success: false, code: 'INVALID_ASSISTANT_EVENT_UPDATE' }, 400);
  }

  const targetId = c.req.param('id');
  if (parsed.data.assistantAction.targetId !== targetId) {
    return c.json({ success: false, code: 'ASSISTANT_ACTION_TARGET_MISMATCH' }, 400);
  }

  const db = getDatabase();
  const userId = c.get('userId') as string;
  const initialContext = currentAssistantHouseholdSnapshot(c);
  if (!initialContext.valid) {
    return c.json({ success: false, code: ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED }, 409);
  }
  const { changes, assistantAction } = parsed.data;
  const before = assistantAction.before;
  if (
    assistantAction.householdId !== initialContext.householdId ||
    before.householdId !== initialContext.householdId
  ) {
    return c.json({ success: false, code: ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED }, 409);
  }

  const result = withAssistantActionIdempotency(
    db,
    userId,
    actionId,
    {
      operation: 'calendar.update_event',
      householdId: initialContext.householdId,
      targetId,
      before,
      changes
    },
    () => {
      const currentContext = currentAssistantHouseholdSnapshot(c);
      if (!currentContext.valid || currentContext.householdId !== assistantAction.householdId) {
        return {
          body: { success: false, code: ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED },
          status: 409,
          record: false
        };
      }

      const row = db
        .prepare(
          `SELECT id, household_id AS householdId, title, kind, date,
                  start_time AS startTime, end_time AS endTime, all_day AS allDay,
                  color, notes, location, recurrence,
                  recurrence_rule AS recurrenceRule, exceptions, source,
                  updated_at AS updatedAt
             FROM calendar_events
            WHERE id = ? AND user_id = ? AND source = 'user' AND kind != 'meal'`
        )
        .get(targetId, userId) as
        ({ id: string } & Omit<typeof before, 'allDay'> & { allDay: number }) | undefined;
      if (!row) {
        return {
          body: { success: false, message: 'Evento no encontrado' },
          status: 404,
          record: false
        };
      }

      const current = {
        householdId: row.householdId,
        title: row.title,
        kind: row.kind,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
        allDay: Boolean(row.allDay),
        color: row.color,
        notes: row.notes,
        location: row.location,
        recurrence: row.recurrence,
        recurrenceRule: row.recurrenceRule,
        exceptions: row.exceptions,
        source: row.source,
        updatedAt: zoneStampValue(row.updatedAt, 'updatedAt')
      };
      const expected = {
        ...before,
        updatedAt: zoneStampValue(before.updatedAt, 'updatedAt')
      };
      if (current.recurrence !== 'none') {
        return {
          body: { success: false, code: 'ASSISTANT_EVENT_RECURRENCE_UNSUPPORTED' },
          status: 409,
          record: false
        };
      }
      if (!isDeepStrictEqual(current, expected)) {
        return {
          body: { success: false, code: 'ASSISTANT_EVENT_STALE' },
          status: 409,
          record: false
        };
      }

      const hasNewTime =
        (changes.startTime !== undefined && changes.startTime !== null) ||
        (changes.endTime !== undefined && changes.endTime !== null);
      const nextAllDay = changes.allDay ?? (hasNewTime ? false : current.allDay);
      const nextStartTime = nextAllDay
        ? null
        : changes.startTime !== undefined
          ? changes.startTime
          : current.startTime;
      const nextEndTime = nextAllDay
        ? null
        : changes.endTime !== undefined
          ? changes.endTime
          : current.endTime;
      if (!nextAllDay && !nextStartTime && !nextEndTime) {
        return {
          body: { success: false, code: 'CALENDAR_EVENT_TIME_REQUIRED' },
          status: 400,
          record: false
        };
      }
      if (nextStartTime && nextEndTime && nextEndTime < nextStartTime) {
        return {
          body: { success: false, code: 'INVALID_EVENT_TIME_RANGE' },
          status: 400,
          record: false
        };
      }

      const next = {
        ...current,
        ...changes,
        allDay: nextAllDay,
        startTime: nextStartTime,
        endTime: nextEndTime
      };
      const fieldMap = {
        title: 'title',
        kind: 'kind',
        date: 'date',
        startTime: 'start_time',
        endTime: 'end_time',
        allDay: 'all_day',
        notes: 'notes',
        location: 'location'
      } as const;
      const assignments: string[] = [];
      const values: Array<string | number | null> = [];
      for (const field of Object.keys(fieldMap) as Array<keyof typeof fieldMap>) {
        if (next[field] === current[field]) continue;
        assignments.push(`${fieldMap[field]} = ?`);
        values.push(
          field === 'allDay' ? (next.allDay ? 1 : 0) : (next[field] as string | number | null)
        );
      }
      if (!assignments.length) {
        return {
          body: { success: false, code: 'ASSISTANT_ACTION_NO_CHANGE' },
          status: 400,
          record: false
        };
      }
      assignments.push('updated_at = CURRENT_TIMESTAMP');
      const write = db
        .prepare(
          `UPDATE calendar_events SET ${assignments.join(', ')}
            WHERE id = ? AND user_id = ? AND source = ? AND household_id IS ?
              AND title IS ? AND kind IS ? AND date IS ? AND start_time IS ?
              AND end_time IS ? AND all_day IS ? AND color IS ? AND notes IS ?
              AND location IS ? AND recurrence IS ? AND recurrence_rule IS ?
              AND exceptions IS ? AND updated_at IS ?`
        )
        .run(
          ...values,
          targetId,
          userId,
          current.source,
          current.householdId,
          current.title,
          current.kind,
          current.date,
          current.startTime,
          current.endTime,
          current.allDay ? 1 : 0,
          current.color,
          current.notes,
          current.location,
          current.recurrence,
          current.recurrenceRule,
          current.exceptions,
          row.updatedAt
        );
      if (write.changes !== 1) {
        return {
          body: { success: false, code: 'ASSISTANT_EVENT_STALE' },
          status: 409,
          record: false
        };
      }

      const updatedRow = db
        .prepare(`SELECT ${EVENT_COLUMNS} FROM calendar_events WHERE id = ? AND user_id = ?`)
        .get(targetId, userId) as unknown as CalendarEventRow;
      const attendees = attendeesByEvent(db, [targetId]).get(targetId) ?? [];
      return {
        body: {
          success: true,
          data: {
            ...toEvent(updatedRow, null),
            editable: true,
            attendees,
            attendeeIds: attendees.map((attendee) => attendee.id)
          }
        },
        status: 200
      };
    }
  );

  if ('error' in result) {
    return result.error === 'invalid_action_id'
      ? c.json({ success: false, code: 'ASSISTANT_ACTION_ID_INVALID' }, 400)
      : c.json({ success: false, code: 'ASSISTANT_ACTION_ID_CONFLICT' }, 409);
  }
  return c.json(result.body, result.status);
});

// DELETE /api/calendar/events/:id/attendees/me —salir de un evento ajeno.
//
// El que se va no borra nada: se quita de la lista. Sin esto, «me has invitado a algo a lo que no
// puedo ir» no tenia respuesta, y la unica salida era discutir con quien invita.
calendarRoutes.delete('/events/:id/attendees/me', async (c) => {
  const db = getDatabase();
  const id = c.req.param('id');
  const userId = c.get('userId') as string;
  const event = db.prepare('SELECT user_id FROM calendar_events WHERE id = ?').get(id) as
    { user_id: string } | undefined;
  if (!event) return c.json({ success: false, message: 'Evento no encontrado' }, 404);
  // El autor no «sale»: su evento no depende de una invitacion, y borrarle a el de su propia fila
  // dejaria un evento sin dueno. Eso se borra, no se abandona.
  if (event.user_id === userId) {
    return c.json(
      {
        success: false,
        message: 'FORBIDDEN',
        data: { hint: 'Tuyo es: lo borras, no te sales de el.' }
      },
      403
    );
  }
  const result = db
    .prepare('DELETE FROM calendar_event_attendees WHERE event_id = ? AND user_id = ?')
    .run(id, userId);
  if (result.changes === 0) {
    return c.json({ success: false, message: 'No estabas invitado a este evento' }, 404);
  }
  return c.json({ success: true, message: 'Has salido del evento' });
});

// DELETE /api/calendar/events/:id/occurrences/:date —«solo este dia no» (HOGARIA-SPEC 12t-R).
//
// No borra la fila: anota la fecha en `exceptions` y la expansion la salta. Sin esto, faltar a un
// gimnasio de los martes era elegir entre «lo quito de todos los martes» o «lo muevo y lo dejo
// duplicado», y las dos opciones se llaman «dejo de usar el calendario».
calendarRoutes.delete('/events/:id/occurrences/:date', async (c) => {
  const db = getDatabase();
  const id = c.req.param('id');
  const date = c.req.param('date');
  const userId = c.get('userId') as string;
  if (dayFromISO(date) === null) {
    return c.json(
      { success: false, message: 'La fecha tiene que ser un día real AAAA-MM-DD' },
      400
    );
  }
  const row = db
    .prepare(
      'SELECT user_id, date, recurrence, recurrence_rule, exceptions FROM calendar_events WHERE id = ?'
    )
    .get(id) as
    | {
        user_id: string;
        date: string;
        recurrence: string;
        recurrence_rule?: string | null;
        exceptions: string | null;
      }
    | undefined;
  if (!row) return c.json({ success: false, message: 'Evento no encontrado' }, 404);
  if (row.user_id !== userId) {
    return c.json(
      {
        success: false,
        message: 'FORBIDDEN',
        data: { hint: 'Solo quien lo escribio puede quitarle un dia.' }
      },
      403
    );
  }
  const schedule = readRecurrenceRule(row.recurrence_rule);
  const legacyRepeats = isRecurrence(row.recurrence) && row.recurrence !== 'none';
  if (!schedule && !legacyRepeats) {
    return c.json(
      {
        success: false,
        message: 'EVENTO_SIN_REPETICION',
        data: { hint: 'Este dia no se repite: se borra, no se quita.' }
      },
      400
    );
  }
  const antes = parseExceptionDates(row.exceptions);
  if (antes.includes(date)) {
    // Idempotente a proposito: el segundo «quitar este dia» (doble clic, reintentar tras un pico) no
    // es un error, y contestar 404 por algo que ya esta como se pidio es enseñar un fallo que no hay.
    return c.json({
      success: true,
      message: 'Ese dia ya estaba fuera de la serie',
      data: { id, exceptions: antes }
    });
  }
  if (
    schedule &&
    !occursOn(
      {
        date: row.date,
        recurrence: isRecurrence(row.recurrence) ? row.recurrence : 'none',
        schedule
      },
      date
    )
  ) {
    return c.json(
      {
        success: false,
        message: 'EVENTO_NO_OCURRE_ESE_DIA',
        data: { hint: 'Solo se puede quitar una fecha que forme parte de la regla de repetición.' }
      },
      400
    );
  }
  const despues = [...antes, date].sort();
  db.prepare(
    'UPDATE calendar_events SET exceptions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(JSON.stringify(despues), id);
  return c.json({
    success: true,
    message: 'Dia quitado de la serie',
    data: { id, exceptions: despues }
  });
});

// DELETE /api/calendar/events/:id —la serie entera (para un dia esta la ruta de arriba).
calendarRoutes.delete('/events/:id', async (c) => {
  const db = getDatabase();
  const id = c.req.param('id');
  const userId = c.get('userId') as string;
  const existing = db.prepare('SELECT user_id FROM calendar_events WHERE id = ?').get(id) as
    { user_id: string } | undefined;
  if (!existing) return c.json({ success: false, message: 'Evento no encontrado' }, 404);
  if (existing.user_id !== userId) {
    return c.json(
      {
        success: false,
        message: 'FORBIDDEN',
        data: { hint: 'Solo quien lo escribio puede borrarlo.' }
      },
      403
    );
  }
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
  return c.json({ success: true, message: 'Evento eliminado' });
});

export { calendarRoutes };
