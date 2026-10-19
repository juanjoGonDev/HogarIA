import { MealType } from '../shared/models/calendar.model';

/**
 * La rejilla de horas: geometria pura, sin Angular y sin DOM.
 *
 * Por que existe aparte del componente: lo que decide este fichero es DONDE se pinta cada cosa y
 * CUANTO ocupa, y eso es exactamente lo que no se ve en un build. Un alto mal calculado hace que dos
 * citas se tapen, y una ventana que no abarca el día completo oculta horas a las que se puede crear
 * un evento. Son numeros: se prueban mejor aqui que en una captura, y el componente se queda en
 * pintar lo que aqui se decide.
 *
 * Unidades: minutos del día (0..1440) para todo lo que es tiempo, y pixeles solo al salir. La
 * conversion px/minutos vive en `HOUR_HEIGHT_PX`; si manana la altura por hora es configurable desde
 * la UI (lo pide el tamano del dedo en un movil), solo cambia aqui.
 */

export const MINUTES_PER_HOUR = 60;
export const DAY_MINUTES = 1440;
export const HOUR_HEIGHT_PX = 48;

/** Un bloque de 15 minutos tiene que seguir siendo legible y tocable. */
export const MIN_BLOCK_HEIGHT_PX = 24;

/** Lo que dura algo que no dice hasta cuando: media hora, no «hasta el final del día». */
export const DEFAULT_DURATION_MINUTES = 30;

/**
 * Donde cae una comida SIN hora escrita. No es un reloj: es una posición, y no se pinta como hora en
 * ningun sitio —lo que el usuario escribio sigue siendo «sin hora». Sin esto, el plan que genera la IA
 * (que no trae horas) se apil entero en la medianoche, y la rejilla de horas no ensenaria nada.
 *
 * El orden es el del día en España: la merienda va antes que la cena. Ese era uno de los fallos que
 * trajo esta ronda, y aqui se nota: si cena < merienda, el plan se leia al reves.
 *
 * ESTE ES EL FALLBACK, no el ajuste del usuario: las horas reales de cada casa viven en
 * `core/meal-times.ts` (Preferencias -> «Horarios») y llegan al componente como `mealAnchors`. Se
 * mantienen aqui porque la rejilla tiene que poder pintarse antes de que el perfil conteste —con cero,
 * todas las comidas sin hora quedarian amontonadas arriba del todo— y porque son numeros que se
 * prueban mejor en este fichero que en un `ngOnInit`.
 */
export const MEAL_ANCHOR_MINUTES: Record<MealType, number> = {
  breakfast: 8 * 60 + 30,
  lunch: 14 * 60,
  snack: 17 * 60 + 30,
  dinner: 21 * 60
};

export interface GridItem {
  id: string;
  /** `YYYY-MM-DD` del día en el que vive. */
  date: string;
  /** Minutos desde la medianoche para pintar. Para una comida sin hora, su ancla por tipo. */
  startMinutes: number;
  endMinutes: number;
  /** true si la hora la escribio alguien; false si es la posición habitual del tipo. */
  timed: boolean;
  /** Todo el día: fuera de la rejilla, en la banda de arriba. */
  allDay: boolean;
}

export interface GridWindow {
  startMinutes: number;
  endMinutes: number;
}

export interface PlacedBlock<T extends GridItem = GridItem> {
  item: T;
  /** Px desde el borde superior de la ventana. */
  topPx: number;
  heightPx: number;
  /** Columna y total de columnas dentro del grupo que se solapa (Google: lado a lado). */
  column: number;
  columns: number;
}

/** `HH:MM` -> minutos. `null` si no es una hora, incluido el `''` de un input vacio. */
export function minutesFromTime(time: string | null | undefined): number | null {
  if (!time) return null;
  // Estricto a proposito: la API solo acepta `HH:MM`, y un lector permisivo pintaria una hora que
  // después no se puede guardar. Mejor no pintarla.
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) return null;
  return Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
}

/** Minutos -> `HH:MM`, para prellenar un campo de hora al pulsar la rejilla. */
export function timeFromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(DAY_MINUTES - 1, Math.round(minutes)));
  const h = Math.floor(clamped / MINUTES_PER_HOUR) % 24;
  const m = clamped % MINUTES_PER_HOUR;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.max(0, Math.min(DAY_MINUTES, Math.round(minutes)));
}

/** La escala civil completa que comparten las vistas de día y semana. */
export function windowFor(): GridWindow {
  return { startMinutes: 0, endMinutes: DAY_MINUTES };
}

/** Las horas que se pintan (etiquetas de la izquierda), siempre en punto. */
export function hoursOf(window: GridWindow): number[] {
  const hours: number[] = [];
  for (let m = window.startMinutes; m < window.endMinutes; m += MINUTES_PER_HOUR) {
    hours.push(m / MINUTES_PER_HOUR);
  }
  return hours;
}

/** En que franja cae un arrastre/click del usuario, redondeado al paso que se puede teclear. */
export function minutesAtOffset(offsetPx: number, window: GridWindow, stepMinutes = 30): number {
  const raw = window.startMinutes + (offsetPx / HOUR_HEIGHT_PX) * MINUTES_PER_HOUR;
  const snapped = Math.round(raw / stepMinutes) * stepMinutes;
  return clampMinutes(Math.max(window.startMinutes, Math.min(window.endMinutes - stepMinutes, snapped)));
}

/** El tipo de comida que corresponde a una hora pulsada, para no preguntar «que es esto». */
export function mealTypeForMinutes(
  minutes: number,
  anchors: Record<MealType, number> = MEAL_ANCHOR_MINUTES
): MealType {
  const entries = Object.entries(anchors) as [MealType, number][];
  if (!entries.length) return 'breakfast';
  // Se elige el ancla más próxima, no «la última superada»: con la última, un clic a las 23:50
  // seguía siendo cena, y el hueco libre después de cenar es justo el que alguien quiere rellenar.
  return entries.reduce((best, [type, anchor]) =>
    Math.abs(anchor - minutes) < Math.abs(anchors[best] - minutes) ? type : best, entries[0][0]);
}

function overlaps(a: GridItem, b: GridItem): boolean {
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

/**
 * Coloca los bloques de un día: arriba/abajo en px y, cuando se solapan, lado a lado.
 *
 * El algoritmo de columnas es el de siempre (agrupar por solapamiento transitivo y asignar la primera
 * columna libre), con dos detalles que son los que se notan: un bloque no puede medir menos de
 * `MIN_BLOCK_HEIGHT_PX` (si no, una cita de 10 minutos es un borde) y la anchura se reparte por el
 * número de columnas del GRUPO, no del bloque —repartirla por las columnas usadas «hasta ahora» hace
 * que el último de la fila ocupe media columna de mas y tape al resto.
 */
export function placeDay<T extends GridItem>(items: T[], window: GridWindow): PlacedBlock<T>[] {
  const timed = items
    .filter((item) => !item.allDay)
    .slice()
    .sort((a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes || a.id.localeCompare(b.id));

  const placed: PlacedBlock<T>[] = [];
  let group: { item: T; column: number }[] = [];
  let groupEnd = -1;

  const flush = (): void => {
    const columns = group.reduce((max, entry) => Math.max(max, entry.column + 1), 0);
    for (const entry of group) {
      const item = entry.item;
      const start = Math.max(window.startMinutes, item.startMinutes);
      const end = Math.min(window.endMinutes, Math.max(item.endMinutes, item.startMinutes + DEFAULT_DURATION_MINUTES));
      const heightPx = Math.max(MIN_BLOCK_HEIGHT_PX, ((end - start) / MINUTES_PER_HOUR) * HOUR_HEIGHT_PX);
      placed.push({
        item,
        topPx: ((start - window.startMinutes) / MINUTES_PER_HOUR) * HOUR_HEIGHT_PX,
        heightPx,
        column: entry.column,
        columns
      });
    }
    group = [];
    groupEnd = -1;
  };

  for (const item of timed) {
    if (group.length && item.startMinutes >= groupEnd) flush();
    const used = new Set(group.filter((entry) => overlaps(entry.item, item)).map((entry) => entry.column));
    let column = 0;
    while (used.has(column)) column++;
    group.push({ item, column });
    groupEnd = Math.max(groupEnd, Math.max(item.endMinutes, item.startMinutes + DEFAULT_DURATION_MINUTES));
  }
  if (group.length) flush();

  return placed.sort((a, b) => a.topPx - b.topPx || a.column - b.column);
}

/** Los de «todo el día», en la banda superior, en el orden en que se escribieron. */
export function allDayOf<T extends GridItem>(items: T[]): T[] {
  return items.filter((item) => item.allDay);
}

/** Minutos de la hora actual, para la linea de «ahora» de Google. */
export function nowMinutes(date: Date = new Date()): number {
  return date.getHours() * MINUTES_PER_HOUR + date.getMinutes();
}

/** Inicio del scroll: medianoche fuera de hoy, y media hora antes de ahora si hoy está visible. */
export function scrollTopFor(window: GridWindow, today: boolean, now = nowMinutes()): number {
  if (!today) return 0;
  const target = Math.max(
    window.startMinutes,
    Math.min(window.endMinutes, clampMinutes(now - MINUTES_PER_HOUR / 2))
  );
  return ((target - window.startMinutes) / MINUTES_PER_HOUR) * HOUR_HEIGHT_PX;
}
