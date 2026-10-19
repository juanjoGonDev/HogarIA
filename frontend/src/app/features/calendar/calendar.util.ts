/**
 * Matemáticas de fechas del calendario.
 *
 * TODO se maneja en hora local y el formato cableado a la API es siempre
 * `YYYY-MM-DD` construido con `getFullYear/getMonth/getDate`. Antes se usaba
 * `date.toISOString().split('T')[0]`, que convierte a UTC: en una zona con
 * desfase positivo (Europa/Madrid, +2 en verano) la medianoche local cae en el
 * día anterior y la comida se guardaba un día antes de donde se había pulsado.
 * En CI (UTC) el bug es invisible, por eso llegó tan lejos.
 */
import { dateLocale } from '../../core/time';

/** `YYYY-MM-DD` en hora local. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `YYYY-MM-DD` -> Date local a medianoche. `null` si el texto no es válido. */
export function parseISODate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  // Un 2026-02-31 se sale de mes: no es una fecha, se descarta.
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
    ? date
    : null;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return startOfDay(next);
}

/** Suma meses sin desbordes (31 ene + 1 mes = 28/29 feb, no 2/3 mar). */
export function addMonths(date: Date, amount: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  const lastDay = daysInMonth(target);
  return startOfDay(
    new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay))
  );
}

export function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/** Lunes como primer día de la semana (convención de la app y de Europa). */
export function startOfWeek(date: Date): Date {
  const dow = (date.getDay() + 6) % 7; // 0 = lunes … 6 = domingo
  return addDays(date, -dow);
}

export function startOfMonth(date: Date): Date {
  return startOfDay(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Los 7 días de la semana que contiene `anchor`, empezando en lunes. */
export function weekDays(anchor: Date): Date[] {
  const first = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/**
 * Rejilla del mes: semanas completas (7 días por fila) que cubren el mes de
 * `anchor`. Filas justas —de 4 a 6— para que no sobre hueco vacío.
 */
export function monthGrid(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const gridStart = startOfWeek(first);
  const daysBeforeMonth = (first.getDay() + 6) % 7;
  const weeks = Math.ceil((daysBeforeMonth + daysInMonth(first)) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
}

/** Desfase en días entre dos fechas (misma hora local => entero). */
export function diffInDays(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000);
}

/* ────────────────────── Etiquetado en el idioma de la app ────────────────────── */
/*
 * Intl en vez de listas propias: da «septiembre de 2026», «14–20 de sept» y
 * «martes, 16 de septiembre» con las reglas del idioma, sin maintainir arrays. El idioma lo dice
 * core/time.ts (12t-i18n), y entra en la clave de la cache: formateadores memorizados por opciones
 * eran un motivo de mas para que cambiar de idioma no se notara hasta recargar.
 */
const fmt = (opts: Intl.DateTimeFormatOptions) =>
  memoize(
    `${dateLocale()}|${JSON.stringify(opts)}`,
    () => new Intl.DateTimeFormat(dateLocale(), opts)
  );

const memo = new Map<string, Intl.DateTimeFormat>();
function memoize(key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let instance = memo.get(key);
  if (!instance) memo.set(key, (instance = make()));
  return instance;
}

export const labels = {
  /** Título de la vista de mes: «septiembre de 2026». */
  month: (d: Date) => fmt({ month: 'long', year: 'numeric' }).format(d),
  /** «14 – 20 de septiembre»; «30 ago – 5 sep» cuando la semana cruza de mes. */
  weekRange(start: Date, end: Date): string {
    if (isSameMonth(start, end)) {
      return `${fmt({ day: 'numeric' }).format(start)} – ${fmt({ day: 'numeric', month: 'long' }).format(end)}`;
    }
    const short = fmt({ day: 'numeric', month: 'short' });
    return `${short.format(start)} – ${short.format(end)}`;
  },
  /** Título de la vista de día: «martes, 16 de septiembre». */
  longDay: (d: Date) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(d),
  /** «mar» en mayúsculas y corto, para la cabecera de columna. */
  dayOfWeekShort: (d: Date) => fmt({ weekday: 'short' }).format(d).replace('.', '').toUpperCase(),
  dayOfMonth: (d: Date) => fmt({ day: 'numeric' }).format(d),
  /** «16 de septiembre de 2026», para aria-labels. */
  fullDate: (d: Date) =>
    fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
};

/**
 * 1450 -> «1.450»/«1,450»: separador del locale activo. El pipe `number` de Angular
 * iría por el LOCALE_ID del módulo, que puede no coincidir con el idioma de la app.
 */
const numberFormatters = new Map<string, Intl.NumberFormat>();
export function formatNumber(value: number): string {
  const locale = dateLocale();
  let formatter = numberFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { useGrouping: true });
    numberFormatters.set(locale, formatter);
  }
  return formatter.format(Math.round(value || 0));
}
