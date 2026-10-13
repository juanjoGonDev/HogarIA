/** ISO-8601 weekday: Monday=1 through Sunday=7. */
export type ISOWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface HouseholdWeeklySchedule {
  weekday: ISOWeekday;
  /** Explicit local wall-clock time in strict `HH:mm` form. */
  localTime: string;
  /** Explicit IANA time-zone identifier; the process/browser default is never consulted. */
  timeZone: string;
}

export interface HouseholdWeeklyOccurrence {
  /** Nominal local calendar date selected by the weekday rule. */
  scheduledLocalDate: string;
  /** Effective local date after resolving a DST gap. */
  localDate: string;
  /** Effective local time; advances to the first valid minute after a DST gap. */
  localTime: string;
  timeZone: string;
  /** Canonical UTC timestamp of the selected execution instant. */
  utcInstant: string;
  /** Stable across retries while the same schedule occurrence is still pending. */
  occurrenceKey: string;
}

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const OFFSET_PROBES_HOURS = [-36, -30, -24, -18, -12, -6, 0, 6, 12, 18, 24, 30, 36] as const;

/**
 * Calculates the next weekly execution strictly after `now` using only the supplied instant,
 * weekday, local time, and IANA time zone. DST folds choose the first matching instant; gaps
 * advance to the first valid wall-clock minute after the configured time.
 */
export function nextHouseholdWeeklyOccurrence(
  schedule: HouseholdWeeklySchedule,
  now: Date
): HouseholdWeeklyOccurrence {
  validateInputs(schedule, now);

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: schedule.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const [requestedHour, requestedMinute] = schedule.localTime.split(':').map(Number);
  const localNow = localParts(now.getTime(), formatter);
  const localToday = isoDate(localNow);
  const daysUntilWeekday = (schedule.weekday - isoWeekday(localToday) + 7) % 7;
  const nowMs = now.getTime();

  // Only today-or-next-seven-days is needed: if today's occurrence has passed, the next one is a week later.
  for (const daysAhead of [daysUntilWeekday, daysUntilWeekday + 7]) {
    const scheduledLocalDate = addCalendarDays(localToday, daysAhead);
    const requestedLocal: LocalDateTime = {
      ...parseISODate(scheduledLocalDate),
      hour: requestedHour!,
      minute: requestedMinute!
    };
    const resolved = resolveLocalTime(requestedLocal, formatter);
    if (resolved.instantMs <= nowMs) continue;

    const localDate = isoDate(resolved.local);
    const localTime = formatTime(resolved.local);
    return {
      scheduledLocalDate,
      localDate,
      localTime,
      timeZone: schedule.timeZone,
      utcInstant: new Date(resolved.instantMs).toISOString(),
      occurrenceKey: `household-weekly:${schedule.timeZone}:${scheduledLocalDate}:${schedule.weekday}:${schedule.localTime}`
    };
  }

  // Date's valid range guarantees a result except at its final representable calendar boundary.
  throw new RangeError('No future household weekly occurrence is representable');
}

function validateInputs(schedule: HouseholdWeeklySchedule, now: Date): void {
  if (!schedule || typeof schedule !== 'object')
    throw new TypeError('A weekly schedule is required');
  if (!Number.isInteger(schedule.weekday) || schedule.weekday < 1 || schedule.weekday > 7) {
    throw new RangeError('weekday must be an ISO weekday from 1 to 7');
  }
  if (
    typeof schedule.localTime !== 'string' ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime)
  ) {
    throw new RangeError('localTime must be a valid HH:mm time');
  }
  if (
    typeof schedule.timeZone !== 'string' ||
    schedule.timeZone.length === 0 ||
    schedule.timeZone !== schedule.timeZone.trim() ||
    /^[+-]\d{2}(?::?\d{2})?$/.test(schedule.timeZone)
  ) {
    throw new RangeError('timeZone must be an explicit IANA time-zone identifier');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new RangeError('now must be a valid Date');

  // Construction validates the identifier without falling back to the process default.
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: schedule.timeZone });
  } catch {
    throw new RangeError('timeZone must be a supported IANA time-zone identifier');
  }
}

function resolveLocalTime(
  requested: LocalDateTime,
  formatter: Intl.DateTimeFormat
): { instantMs: number; local: LocalDateTime } {
  const requestedWallMs = wallClockAsUtc(requested);
  const offsets = new Set<number>();
  for (const hours of OFFSET_PROBES_HOURS) {
    offsets.add(offsetAt(requestedWallMs + hours * 60 * MINUTE_MS, formatter));
  }

  // A normal wall time has one candidate; a fall-back fold has two. Sorting UTC instants selects
  // the first fold occurrence once and deliberately never returns the later duplicate.
  const exactCandidates = matchingInstants(requested, offsets, formatter);
  if (exactCandidates.length > 0) {
    const instantMs = Math.min(...exactCandidates);
    return { instantMs, local: requested };
  }

  // A spring-forward gap has no exact candidate. Search local wall minutes rather than adding
  // elapsed UTC minutes, so the configured weekday/time semantics remain explicit.
  for (let minutesAfter = 1; minutesAfter <= 24 * 60; minutesAfter++) {
    const shifted = wallClockFromUtc(requestedWallMs + minutesAfter * MINUTE_MS);
    const candidates = matchingInstants(shifted, offsets, formatter);
    if (candidates.length > 0) {
      return { instantMs: Math.min(...candidates), local: shifted };
    }
  }

  throw new RangeError('No valid local time found after the scheduled wall time');
}

function matchingInstants(
  wanted: LocalDateTime,
  offsets: ReadonlySet<number>,
  formatter: Intl.DateTimeFormat
): number[] {
  const wantedWallMs = wallClockAsUtc(wanted);
  const matches: number[] = [];
  for (const offsetMs of offsets) {
    const instantMs = wantedWallMs - offsetMs;
    if (sameLocalDateTime(localParts(instantMs, formatter), wanted)) matches.push(instantMs);
  }
  return matches;
}

function offsetAt(instantMs: number, formatter: Intl.DateTimeFormat): number {
  const local = localParts(instantMs, formatter);
  return wallClockAsUtc(local) - instantMs;
}

function localParts(instantMs: number, formatter: Intl.DateTimeFormat): LocalDateTime {
  const values = new Map(
    formatter.formatToParts(new Date(instantMs)).map(({ type, value }) => [type, value])
  );
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute'))
  };
}

function sameLocalDateTime(left: LocalDateTime, right: LocalDateTime): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function isoWeekday(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(utcDate(year!, month! - 1, day!)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return isoDate(wallClockFromUtc(utcDate(year!, month! - 1, day!) + days * DAY_MS));
}

function parseISODate(date: string): Pick<LocalDateTime, 'year' | 'month' | 'day'> {
  const [year, month, day] = date.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

function isoDate(date: Pick<LocalDateTime, 'year' | 'month' | 'day'>): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function formatTime(time: Pick<LocalDateTime, 'hour' | 'minute'>): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

function wallClockAsUtc(date: LocalDateTime): number {
  return (
    utcDate(date.year, date.month - 1, date.day) +
    date.hour * 60 * MINUTE_MS +
    date.minute * MINUTE_MS
  );
}

function wallClockFromUtc(instantMs: number): LocalDateTime {
  const date = new Date(instantMs);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes()
  };
}

/** UTC civil date constructor that does not reinterpret years 00–99 as 1900–1999. */
function utcDate(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month, day);
  return date.getTime();
}
