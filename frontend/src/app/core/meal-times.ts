import {
  MEAL_ORDER,
  MEAL_PLAN_DEFAULTS,
  MEAL_TIME_DEFAULTS,
  MealPlan,
  MealTimes,
  MealType
} from '../shared/models/calendar.model';
import { MEAL_ANCHOR_MINUTES, minutesFromTime } from './calendar-grid';

export { MEAL_PLAN_DEFAULTS, MEAL_TIME_DEFAULTS, MealPlan, MealTimes };

/**
 * Las horas a las que come esta casa, convertidas en lo que consume la app.
 *
 * Un ajuste, no una constante: el usuario las dice en el tour o en Preferencias y las cambia cuando
 * quiere. Que su lectura este aqui y no dentro de cada componente es lo que hace que las tres cosas que
 * dependen de ellas —donde se coloca una comida sin hora en la rejilla, con que hora nace una comida
 * nueva y a que hora le pide comer la IA— hablen del mismo reloj.
 *
 * Los literales (las cuatro horas y su nombre) viven en `shared/models/calendar.model.ts` y se
 * reexportan aqui: `app-meal-hours`, que es un componente del design system, no puede importar de
 * `core/`, y un segundo diccionario de horas es un segundo diccionario que se desincroniza.
 *
 * Lo que hay en el server es el espejo, y el espejo esta testado
 * (`server/src/utils/meal-times-mirror.spec.ts`) en vez de ser una promesa: si manana cena pasa a las
 * 21:00 en un lado y sigue a las 20:30 en el otro, la app pintaria una hora y la IA planificaria otra,
 * y eso no lo ve nadie hasta que alguien cena a las 20:30 mirando una rejilla que decia otra cosa.
 */

/**
 * Lo que hay en la respuesta de la API (o en un JSON viejo) convertido en horas completas.
 *
 * Defensivo a proposito: la API ya responde `HH:MM` o el defecto, pero este estado también lo pinta
 * un formulario y lo lee un JSON escrito a mano. Una hora ilegible no puede dar `NaN` en la rejilla;
 * se cae al defecto, que es lo que el usuario veria si no hubiera tocado nunca el ajuste.
 */
export function resolveMealTimes(stored: unknown): MealTimes {
  const raw = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const times: MealTimes = { ...MEAL_TIME_DEFAULTS };
  for (const type of MEAL_ORDER) {
    const value = typeof raw[type] === 'string' ? raw[type] : null;
    if (minutesFromTime(value) !== null) times[type] = String(value).trim();
  }
  return times;
}

/**
 * Donde se sienta cada comida en la rejilla, en minutos del dia.
 *
 * Lo que la rejilla necesita son minutos; lo que la gente escribe son horas. Aqui esta la traduccion,
 * y aqui esta tambien el unico sitio donde el ancla de `calendar-grid` sigue teniendo sentido: si la
 * preferencia no ha llegado todavia (primera pasada, o sin sesion), la rejilla pinta con sus anclas en
 * vez de apilarlo todo en la medianoche.
 */
export function mealAnchors(times?: Partial<MealTimes> | null): Record<MealType, number> {
  const anchors = {} as Record<MealType, number>;
  for (const type of MEAL_ORDER) {
    const minutes = minutesFromTime(times?.[type]);
    anchors[type] = minutes ?? MEAL_ANCHOR_MINUTES[type];
  }
  return anchors;
}

/** La hora con la que nace una comida nueva de este tipo (el campo se puede vaciar despues). */
export function mealTimeOf(times: Partial<MealTimes> | null | undefined, type: MealType): string {
  return times?.[type] ?? MEAL_TIME_DEFAULTS[type];
}

/**
 * Que comidas pedirle a la IA.
 *
 * Marcar ninguna no significa «no quiero plan», significa «el dia entero»: el mismo acuerdo que aplica
 * el server (`resolveMealTypes`), para que el chat de la IA y el plan que se guarda no discrepen de lo
 * que se pidio. El orden devuelto es el del dia, no el de los clicks, porque ese orden es el que se
 * escribe en el prompt.
 */
export function selectedMealTypes(selected: readonly string[] | null | undefined): MealType[] {
  if (!selected || selected.length === 0) return [...MEAL_ORDER];
  const picked = new Set(selected);
  const valid = MEAL_ORDER.filter((type) => picked.has(type));
  return valid.length > 0 ? valid : [...MEAL_ORDER];
}

/**
 * Lo que un formulario de horas debe mandar para ser un parche y no un rewriting.
 *
 * `undefined` cuando no ha cambiado nada, y eso es lo que importa: si «Guardar preferencias» mandara
 * siempre las cuatro casillas, una casa que no ha tocado nada acabaria con los defectos de la app
 * *guardados*, y manana cambiar el defecto de producto dejaria de afectarles. Una casilla vacia manda
 * `null` («quita el horario»), que es como se vuelve al de la app sin boton de restablecer.
 */
export function mealTimesPatch(
  current: Partial<MealTimes> | null | undefined,
  saved: MealTimes
): Partial<Record<MealType, string | null>> | undefined {
  const patch: Partial<Record<MealType, string | null>> = {};
  let touched = false;
  for (const type of MEAL_ORDER) {
    const value = String(current?.[type] ?? '').trim();
    if (value === saved[type]) continue;
    touched = true;
    patch[type] = value || null;
  }
  return touched ? patch : undefined;
}

/** `HH:MM` -> minutos del dia, para comparar o para el `title` de un bloque. `null` si no es una hora. */
export function mealTimeToMinutes(time: string | null | undefined): number | null {
  return minutesFromTime(time);
}

/**
 * Los cuatro permisos de 12t-T, leidos de un JSON que puede ser viejo, estar a medias o escrito a mano.
 *
 * Mismo criterio que `resolveMealTimes`: lo que no es un booleano vale «sin decir», y «sin decir» es
 * `true`. Cae hacia el lado en el que la app ya funcionaba, que es el unico lado que no rompe a nadie.
 */
export function resolveMealPlan(stored: unknown): MealPlan {
  const raw = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const plan: MealPlan = { ...MEAL_PLAN_DEFAULTS };
  for (const type of MEAL_ORDER) {
    if (typeof raw[type] === 'boolean') plan[type] = raw[type] as boolean;
  }
  return plan;
}

/** Que comidas puede escribir el planificador, en el orden del dia. Vaciarlo entero no es «todas». */
export function plannedMealTypes(plan: MealPlan | null | undefined): MealType[] {
  return MEAL_ORDER.filter((type) => plan?.[type] !== false);
}

/**
 * El parche de permisos, con el mismo acuerdo de tres estados que `mealTimesPatch` (12t-T).
 *
 * `undefined` cuando no se toco ninguna casilla: un «Guardar preferencias» que mandara siempre las
 * cuatro acabaria escribiendo los permisos de fabrica en el perfil de una casa que no dijo nunca nada,
 * y manana cambiar el fabrica de producto dejaria de afectarles. Un checkbox no se vacia —se marca o se
 * desmarca—, asi que de aqui no sale `null`: ese estado existe en el contrato del server (borrar la
 * clave y volver al fabrica) y lo usan las pantallas que escriben el JSON a mano, no este formulario.
 */
export function mealPlanPatch(
  draft: Partial<MealPlan> | null | undefined,
  saved: MealPlan
): Partial<Record<MealType, boolean | null>> | undefined {
  const patch: Partial<Record<MealType, boolean | null>> = {};
  let touched = false;
  for (const type of MEAL_ORDER) {
    const value = draft?.[type];
    if (value === undefined) continue; // todavia no ha llegado el estado guardado: no se toca
    if (value === saved[type]) continue;
    touched = true;
    patch[type] = value;
  }
  return touched ? patch : undefined;
}
