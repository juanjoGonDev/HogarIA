import { nanoid } from 'nanoid';
import { activeHouseholdId } from './household-context.js';

/**
 * El calendario semanal de una persona, creando el que falte.
 *
 * Estaba duplicado en `POST /api/calendar`, en `POST /api/calendar/meals` y en el
 * plan de la IA, con tres variantes del mismo cálculo y dos bugs: el `''` de
 * `household_id` (que la FK rechaza: sin hogar no se podía guardar nada) y el
 * `new Date('YYYY-MM-DD').getDay()` para averiguar el lunes, que en una zona con
 * desfase negativo cae en el día de antes y abre la semana equivocada. Aquí se
 * trabaja con la cadena `YYYY-MM-DD` en tiempo universal, sin reloj local.
 */

type SqlDb = import('better-sqlite3').Database;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface WeekCalendarRow {
  id: string;
  household_id: string | null;
  user_id: string;
  week_start: string;
  week_end: string;
  goals: string;
}

/** `YYYY-MM-DD` -> Date universal. `null` si el texto no es una fecha real. */
export function utcDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? date
    : null;
}

export function toUTCISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Lunes de la semana que contiene la fecha. */
/** Lunes de la semana que contiene la fecha. */
export function weekStartOf(value: unknown): Date | null {
  const date = utcDate(value);
  if (!date) return null;
  return shiftDays(date, -((date.getUTCDay() + 6) % 7));
}

/**
 * Devuelve el calendario de la semana que contiene `date` (cualquier
 * `YYYY-MM-DD`), creándolo si no existe. `goals` solo se usan al crear: no se
 * pisan objetivos ya guardados.
 */
export function ensureWeekCalendar(
  db: SqlDb,
  userId: string,
  date: unknown,
  // `| null` porque un goals de formulario puede venir vacio, y «vacio» aqui es «sin objetivos», no
  // «no tocar»: la fila se crea con `{}` y ya esta.
  goals?: Record<string, unknown> | null
): WeekCalendarRow | null {
  const weekStart = weekStartOf(date);
  if (!weekStart) return null;

  const weekStartISO = toUTCISO(weekStart);
  const householdId = activeHouseholdId(db, userId);
  const found = db
    .prepare(
      'SELECT * FROM weekly_calendars WHERE user_id = ? AND household_id IS ? AND week_start = ?'
    )
    .get(userId, householdId, weekStartISO) as WeekCalendarRow | undefined;
  if (found) return found;

  const weekEndISO = toUTCISO(shiftDays(weekStart, 6));
  const id = nanoid();

  db.prepare(
    `INSERT INTO weekly_calendars (id, household_id, user_id, week_start, week_end, goals)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    // Cada usuario conserva su propio calendario dentro del hogar activo; `NULL` solo
    // representa su ámbito personal cuando no tiene ninguna membresía seleccionada.
    householdId,
    userId,
    weekStartISO,
    weekEndISO,
    JSON.stringify(goals ?? {})
  );

  return db.prepare('SELECT * FROM weekly_calendars WHERE id = ?').get(id) as WeekCalendarRow;
}
