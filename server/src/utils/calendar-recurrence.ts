// =============================================================================
// Recurrencia de las sueltas del calendario (HOGARIA-SPEC 12t-R).
//
// Una serie es UNA fila: `date` es el dia en que empieza y `recurrence` dice cada cuanto se repite.
// Las ocurrencias no se guardan, se materializan al leer —el mismo motivo por el que las comidas no se
// copian a `calendar_events` (8f): dos verdades se desincronizan. Y tiene un efecto bueno de regalo:
// cambiar el titulo de la serie cambia los lunes de verdad, y borrar la serie no deja treinta filas
// huerfanas.
//
// Todo este fichero es aritmetica de fechas sobre ISO `YYYY-MM-DD` en UTC. Nada de `new Date()` local:
// un navegador en otra zona corria los lunes (y en el server, el deploy a las 23:59 también).
// =============================================================================

export const RECURRENCES = ['none', 'daily', 'weekly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];
/** ISO-8601 weekday: Monday=1 through Sunday=7. */
export type ISOWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type RecurrenceEnd =
  | { type: 'never' }
  | { type: 'date'; date: string }
  | { type: 'count'; count: number };

/** A custom recurrence. `weekdays` is meaningful only for weekly schedules; omitted means the start weekday. */
export interface RecurrenceSchedule {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays?: readonly ISOWeekday[];
  end: RecurrenceEnd;
}

export function isRecurrence(value: unknown): value is Recurrence {
  return (RECURRENCES as readonly unknown[]).includes(value);
}

/** Runtime guard for rules loaded from JSON or an untrusted request body. */
export function isRecurrenceSchedule(value: unknown): value is RecurrenceSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!(RECURRENCE_FREQUENCIES as readonly unknown[]).includes(candidate.frequency)) return false;
  if (!Number.isInteger(candidate.interval) || (candidate.interval as number) < 1 || (candidate.interval as number) > 99) {
    return false;
  }

  if (candidate.frequency === 'weekly') {
    if (candidate.weekdays !== undefined) {
      if (!Array.isArray(candidate.weekdays) || candidate.weekdays.length === 0) return false;
      const days = candidate.weekdays;
      if (days.some((day) => !Number.isInteger(day) || (day as number) < 1 || (day as number) > 7)) return false;
      if (new Set(days).size !== days.length) return false;
    }
  } else if (candidate.weekdays !== undefined) {
    return false;
  }

  if (!candidate.end || typeof candidate.end !== 'object' || Array.isArray(candidate.end)) return false;
  const end = candidate.end as Record<string, unknown>;
  if (end.type === 'never') return true;
  if (end.type === 'date') return dayFromISO(end.date) !== null;
  return end.type === 'count' && Number.isInteger(end.count) && (end.count as number) >= 1 && (end.count as number) <= 999;
}

/** Lo que hace falta saber de una fila para saber cuando ocurre. */
export interface RecurrenceRule {
  /** Dia de la serie, `YYYY-MM-DD`. Para `none`, el unico dia. */
  date: string;
  recurrence: Recurrence;
  /** Structured custom rule; when present it takes precedence over the legacy enum above. */
  schedule?: RecurrenceSchedule;
  /** Dias `YYYY-MM-DD` en los que esta serie, concretamente, no ocurre («solo este dia no»). */
  exceptions?: readonly string[] | string | null;
}

export interface Expansion {
  /** Fechas `YYYY-MM-DD` dentro de la ventana, en orden, sin las excepciones. */
  dates: string[];
  /** `true` si habia mas ocurrencias que `max`: la ventana corta, no la serie. */
  truncated: boolean;
}

const DAY_MS = 86_400_000;
/** Cuantas ocurrencias se materializan por serie y lectura, como mucho. */
export const MAX_OCCURRENCES = 400;

/** `YYYY-MM-DD` -> medianoche UTC en ms, o `null`. Una fecha que no existe (2026-02-30) es `null`. */
export function dayFromISO(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month, day);
  const ms = date.getTime();
  return Number.isNaN(ms) || toISO(ms) !== iso.trim() ? null : ms;
}

function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Las excepciones admiten venir como JSON sin parsear: la columna es TEXT, y no se rompe una lectura por eso. */
export function parseExceptionDates(raw: readonly string[] | string | null | undefined): string[] {
  const value = typeof raw === 'string' ? safelyParse(raw) : raw;
  const list = Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === 'string' && dayFromISO(item) !== null && !out.includes(item.trim())) out.push(item.trim());
  }
  return out;
}

export function exceptionSet(rule: RecurrenceRule): Set<string> {
  return new Set(parseExceptionDates(rule.exceptions));
}

function safelyParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

/**
 * Que dias ocurre la serie dentro de `[from, to]`, ambos inclusive.
 *
 * `none` es un dia; `daily` es cada dia desde el de la serie; `weekly` es el mismo dia de la semana
 * (UTC) de ese dia. La ventana puede empezar despues del inicio de la serie —es lo normal: una casa
 * que planifico «sacar la basura» en marzo sigue viendola en octubre—, asi que el primer dia util se
 * calcula en vez de iterar desde el principio: recorrer a saltos una serie de tres anos para pintar
 * un mes es una manera cara de no llegar nunca.
 */
export function expandOccurrences(
  rule: RecurrenceRule,
  window: { from?: string | null; to?: string | null } = {},
  max: number = MAX_OCCURRENCES
): Expansion {
  const empty: Expansion = { dates: [], truncated: false };
  const start = dayFromISO(rule.date);
  if (start === null) return empty;

  const boundedMax = Number.isFinite(max) ? Math.max(0, Math.min(MAX_OCCURRENCES, Math.floor(max))) : MAX_OCCURRENCES;
  if (rule.schedule !== undefined) {
    return isRecurrenceSchedule(rule.schedule)
      ? expandSchedule(rule, rule.schedule, start, window, boundedMax)
      : empty;
  }
  if (!isRecurrence(rule.recurrence)) return empty;

  const from = dayFromISO(window.from ?? null) ?? -Infinity;
  const to = dayFromISO(window.to ?? null) ?? Infinity;
  if (from === -Infinity && to === Infinity && rule.recurrence === 'none') {
    return { dates: [toISO(start)], truncated: false };
  }
  if (from > to) return empty;

  const exceptions = exceptionSet(rule);
  const push = (ms: number, dates: string[]): void => {
    const iso = toISO(ms);
    if (!exceptions.has(iso)) dates.push(iso);
  };

  if (rule.recurrence === 'none') {
    if (start < from || start > to) return empty;
    const iso = toISO(start);
    return { dates: exceptions.has(iso) ? [] : [iso], truncated: false };
  }

  const step = rule.recurrence === 'daily' ? DAY_MS : 7 * DAY_MS;
  // Primer dia de la serie que cae en la ventana (o despues).
  let cursor = start;
  if (start < from) {
    const saltos = Math.ceil((from - start) / step);
    cursor = start + saltos * step;
  }

  const dates: string[] = [];
  let generated = 0;
  while (cursor <= to) {
    if (generated >= boundedMax) return { dates, truncated: true };
    push(cursor, dates);
    generated++;
    cursor += step;
  }
  return { dates, truncated: false };
}

function expandSchedule(
  rule: RecurrenceRule,
  schedule: RecurrenceSchedule,
  start: number,
  window: { from?: string | null; to?: string | null },
  max: number
): Expansion {
  const from = dayFromISO(window.from ?? null) ?? -Infinity;
  const to = dayFromISO(window.to ?? null) ?? Infinity;
  if (from > to) return { dates: [], truncated: false };

  const endDate = schedule.end.type === 'date' ? dayFromISO(schedule.end.date) : null;
  if (schedule.end.type === 'date' && (endDate === null || endDate < start)) return { dates: [], truncated: false };

  const dates: string[] = [];
  const exceptions = exceptionSet(rule);
  const countLimit = schedule.end.type === 'count' ? schedule.end.count : null;
  let totalOccurrences = 0;
  let occurrencesInWindow = 0;
  let period = countLimit === null ? firstPeriodAtOrAfter(schedule, start, from) : 0;

  while (true) {
    const candidates = schedulePeriodDates(schedule, start, period);
    if (candidates === null) break; // Outside the four-digit ISO year range.

    for (const candidate of candidates) {
      if (candidate < start) continue;
      if (endDate !== null && candidate > endDate) return { dates, truncated: false };
      if (countLimit !== null && totalOccurrences >= countLimit) return { dates, truncated: false };
      totalOccurrences++;

      if (candidate < from) continue;
      if (candidate > to) return { dates, truncated: false };
      if (occurrencesInWindow >= max) return { dates, truncated: true };
      occurrencesInWindow++;

      const iso = toISO(candidate);
      if (!exceptions.has(iso)) dates.push(iso);
    }

    // A weekly period can contain several selected weekdays; once its candidates are consumed,
    // advance to the next recurrence interval. Count-limited rules stop after the requested
    // number of actual dates, not after excluded dates have been removed from the result.
    if (countLimit !== null && totalOccurrences >= countLimit) return { dates, truncated: false };
    period++;
  }

  return { dates, truncated: false };
}

/** First recurrence interval that can intersect `from`, avoiding scans from ancient series dates. */
function firstPeriodAtOrAfter(schedule: RecurrenceSchedule, start: number, from: number): number {
  if (from === -Infinity || from <= start) return 0;
  const startDate = new Date(start);
  const fromDate = new Date(from);

  if (schedule.frequency === 'daily') {
    return Math.max(0, Math.ceil((from - start) / (schedule.interval * DAY_MS)));
  }
  if (schedule.frequency === 'weekly') {
    const startWeek = mondayStart(start);
    const fromWeek = mondayStart(from);
    const weeks = Math.floor((fromWeek - startWeek) / (7 * DAY_MS));
    return Math.max(0, Math.ceil(weeks / schedule.interval));
  }
  if (schedule.frequency === 'monthly') {
    const months = (fromDate.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
      (fromDate.getUTCMonth() - startDate.getUTCMonth());
    return Math.max(0, Math.ceil(months / schedule.interval));
  }
  return Math.max(0, Math.ceil((fromDate.getUTCFullYear() - startDate.getUTCFullYear()) / schedule.interval));
}

/** One frequency interval can yield multiple dates for a weekly custom rule. `null` means out of ISO range. */
function schedulePeriodDates(schedule: RecurrenceSchedule, start: number, period: number): number[] | null {
  if (!Number.isSafeInteger(period) || period < 0) return null;

  if (schedule.frequency === 'daily') {
    const candidate = start + period * schedule.interval * DAY_MS;
    return isFourDigitYear(candidate) ? [candidate] : null;
  }

  if (schedule.frequency === 'weekly') {
    const startWeek = mondayStart(start);
    const weekdays = schedule.weekdays ?? [isoWeekday(start)];
    const offsets = [...weekdays].sort((a, b) => a - b);
    const candidates = offsets
      .map((weekday) => startWeek + (period * schedule.interval * 7 + weekday - 1) * DAY_MS)
      .filter((candidate) => candidate >= start);
    if (candidates.some((candidate) => !isFourDigitYear(candidate))) return null;
    return candidates;
  }

  const startDate = new Date(start);
  const dayOfMonth = startDate.getUTCDate();
  if (schedule.frequency === 'monthly') {
    const monthOrdinal = startDate.getUTCFullYear() * 12 + startDate.getUTCMonth() + period * schedule.interval;
    const year = Math.floor(monthOrdinal / 12);
    const month = monthOrdinal - year * 12;
    if (year < 0 || year > 9999) return null;
    const lastDay = new Date(utcDate(year, month + 1, 0)).getUTCDate();
    // Keep the anchor's day-of-month; skip months that do not contain it rather than clamping.
    if (dayOfMonth > lastDay) return [];
    return [utcDate(year, month, dayOfMonth)];
  }

  const year = startDate.getUTCFullYear() + period * schedule.interval;
  if (year < 0 || year > 9999) return null;
  const lastDay = new Date(utcDate(year, startDate.getUTCMonth() + 1, 0)).getUTCDate();
  // Keep leap-day and other month/day anchors exact; missing calendar dates are skipped.
  if (dayOfMonth > lastDay) return [];
  return [utcDate(year, startDate.getUTCMonth(), dayOfMonth)];
}

function isoWeekday(ms: number): ISOWeekday {
  const day = new Date(ms).getUTCDay();
  return (day === 0 ? 7 : day) as ISOWeekday;
}

function mondayStart(ms: number): number {
  return ms - (isoWeekday(ms) - 1) * DAY_MS;
}

function isFourDigitYear(ms: number): boolean {
  const year = new Date(ms).getUTCFullYear();
  return Number.isFinite(ms) && year >= 0 && year <= 9999;
}

/** UTC civil date constructor that does not reinterpret years 00–99 as 1900–1999. */
function utcDate(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month, day);
  return date.getTime();
}

/** Vale para el dia suelto (vista de dia, «quitar solo este dia»): la serie ocurre ese dia? */
export function occursOn(rule: RecurrenceRule, date: string): boolean {
  return expandOccurrences(rule, { from: date, to: date }).dates.length > 0;
}
