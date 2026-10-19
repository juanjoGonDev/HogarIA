import { nanoid } from 'nanoid';
import { ensureWeekCalendar, toUTCISO, utcDate, weekStartOf } from './week-calendar.js';
import { MEAL_TYPE_KEYS, type MealTypeKey } from './taste-profile.js';

/**
 * Guardar el plan que devuelve la IA en el calendario de la semana pedida.
 *
 * `POST /api/ai/plan-week` generaba el plan y lo devolvía tal cual: la interfaz
 * decía «¡Plan generado!» y la rejilla seguía vacía, porque nadie escribía nada.
 * Aquí se insertan las comidas, con dos reglas:
 *
 *  - **Rellena huecos, no pisa lo tuyo.** Si en ese día ya hay algo para esa
 *    comida, se respeta y se omite el sugerido.
 *  - **Nada fuera de la semana pedida.** La respuesta de la IA es texto libre:
 *    solo se guardan fechas válidas dentro del rango solicitado.
 */

type SqlDb = import('better-sqlite3').Database;

/** El orden del dia: la merienda va antes que la cena (HOGARIA-SPEC 12o), y la lista es la misma
 * que usan las horas de la casa en Preferencias: un `meal_type` nuevo tiene que salir aqui tambien. */
const MEAL_TYPES = MEAL_TYPE_KEYS;

/**
 * Que nadie haya elegido comidas no significa «no quiero nada», significa «el dia completo»: el
 * planificador basico no tiene selector. Por eso el conjunto vacio son las cuatro, nunca cero.
 */
export function resolveMealTypes(selected: readonly unknown[] | null | undefined): MealTypeKey[] {
  if (!Array.isArray(selected) || selected.length === 0) return [...MEAL_TYPES];
  const picked = new Set<string>();
  for (const raw of selected)
    picked.add(
      String(raw ?? '')
        .trim()
        .toLowerCase()
    );
  // Se devuelve en el orden del dia, no en el que llegaron: lo consume quien escribe el plan. Y si no
  // queda ninguna valida (cliente viejo, id renombrado) se pide el dia entero: un array vacio aqui se
  // leia «no planifiques nada», que es el peor modo de fallar en silencio.
  const valid = MEAL_TYPES.filter((type) => picked.has(type));
  return valid.length > 0 ? valid : [...MEAL_TYPES];
}

/** Hora del reloj para la columna `meals.time`; lo demas se queda sin hora. */
function clockTime(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : null;
}

export interface PersistWeeklyPlanInput {
  userId: string;
  /** YYYY-MM-DD, inclusive. */
  startDate: string;
  endDate: string;
  goals?: {
    types?: string[];
    /** Alias para las llamadas antiguas del planificador. */
    type?: string;
    caloriesTarget?: number | null;
    customInstructions?: string | null;
    restrictions?: string[] | null;
  };
  /** Lo que devolvió el modelo: se valida aquí, nunca se da por bueno. */
  plan: unknown;
  /** Qué comidas se han pedido (ver `resolveMealTypes`: vacío = las cuatro). */
  mealTypes?: readonly unknown[] | null;
  /** Las horas de la casa: una comida planificada sin hora escrita no tiene reloj. */
  mealTimes?: Record<string, unknown> | null;
  /** Raciones activas del hogar; la ruta resuelve el fallback personal antes de persistir. */
  servings?: number;
}

export interface PersistWeeklyPlanResult {
  /** Comidas insertadas. */
  created: number;
  /** Huecos que ya estaban ocupados y se han dejado intactos. */
  skipped: number;
  weekStart: string;
  calendarId: string;
}

function clamp(text: string, max: number): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function mealName(value: unknown): string | null {
  // La IA a veces devuelve un string suelto en lugar del objeto {name, ingredients}.
  if (typeof value === 'string') return value.trim() ? clamp(value, 200) : null;
  const record = asRecord(value);
  if (!record || typeof record.name !== 'string') return null;
  const name = record.name.trim();
  return name ? clamp(name, 200) : null;
}

function mealNotes(value: unknown): string | null {
  const record = asRecord(value);
  const ingredients = record && Array.isArray(record.ingredients) ? record.ingredients : [];
  const names = ingredients
    .map((item) => (typeof item === 'string' ? item : ((asRecord(item)?.name as string) ?? '')))
    .map((item) => item.trim())
    .filter(Boolean);
  return names.length ? clamp(`Ingredientes: ${names.join(', ')}`, 500) : null;
}

export function persistWeeklyPlan(
  db: SqlDb,
  input: PersistWeeklyPlanInput
): PersistWeeklyPlanResult {
  const start = utcDate(input.startDate);
  const end = utcDate(input.endDate);
  const weekStart = weekStartOf(input.startDate);
  if (!weekStart) return { created: 0, skipped: 0, weekStart: '', calendarId: '' };

  const result: PersistWeeklyPlanResult = {
    created: 0,
    skipped: 0,
    weekStart: toUTCISO(weekStart),
    calendarId: ''
  };

  const days = asRecord(input.plan)?.days;
  if (!start || !end || !Array.isArray(days) || days.length === 0) return result;

  const rawTypes = Array.isArray(input.goals?.types)
    ? input.goals.types
    : input.goals?.type
      ? [input.goals.type]
      : [];
  const goalTypes = [...new Set(rawTypes.map((type) => String(type ?? '').trim()).filter(Boolean))];
  const customInstructions = String(input.goals?.customInstructions ?? '')
    .trim()
    .slice(0, 2000);
  const primaryType = goalTypes[0] ?? (customInstructions ? 'custom' : 'balanced');

  // Semana de la IA => calendario semanal, creando el que falte (misma regla que
  // POST /api/calendar/meals, ahora en un solo sitio).
  const calendar = ensureWeekCalendar(db, input.userId, result.weekStart, {
    type: primaryType,
    types: goalTypes,
    ...(customInstructions ? { customInstructions } : {}),
    dailyCalories: input.goals?.caloriesTarget,
    restrictions: input.goals?.restrictions ?? []
  });
  if (!calendar) return result;

  result.calendarId = calendar.id;

  const types = resolveMealTypes(input.mealTypes);
  const existing = db.prepare(
    'SELECT id FROM meals WHERE calendar_id = ? AND date = ? AND meal_type = ?'
  );
  const insert = db.prepare(
    `INSERT INTO meals (id, calendar_id, date, meal_type, recipe_id, custom_meal, time, servings, notes)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`
  );

  for (const rawDay of days) {
    const day = asRecord(rawDay);
    const iso = typeof day?.date === 'string' ? day.date : '';
    const date = utcDate(iso);
    // Fuera del rango pedido (o fecha inválida): se descarta el día entero.
    if (!date || date < start || date > end) continue;

    const meals = asRecord(day?.meals);
    if (!meals) continue;

    for (const type of types) {
      const name = mealName(meals[type]);
      if (!name) continue;

      if (existing.get(calendar.id, iso, type)) {
        result.skipped++;
        continue;
      }
      // La hora es la de la casa, no una conjetura: si el usuario no la ha puesto, la comida queda
      // sin reloj y la rejilla la coloca en su ancla.
      insert.run(
        nanoid(),
        calendar.id,
        iso,
        type,
        name,
        clockTime(input.mealTimes?.[type]),
        input.servings ?? 1,
        mealNotes(meals[type])
      );
      result.created++;
    }
  }

  db.prepare('UPDATE weekly_calendars SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    calendar.id
  );

  return result;
}
