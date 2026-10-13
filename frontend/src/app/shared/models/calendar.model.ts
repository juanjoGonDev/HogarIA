import type { TranslationKey } from '../../core/i18n';

export interface WeeklyCalendar {
  id: string;
  householdId: string;
  weekStart: Date;
  weekEnd: Date;
  days: DayPlan[];
  goals: NutritionalGoals;
  generatedBy: GenerationType;
  createdAt: Date;
  updatedAt: Date;
}

export interface DayPlan {
  date: Date;
  dayOfWeek: DayOfWeek;
  meals: Meal[];
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  notes?: string;
}

export interface Meal {
  id: string;
  type: MealType;
  recipeId?: string;
  recipeName?: string;
  customMeal?: string;
  time?: string;
  servings: number;
  notes?: string;
  completed: boolean;
  completedAt?: Date;
}

export type DayOfWeek =
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type GenerationType = 'user' | 'ai';

export interface NutritionalGoals {
  /** Canonical multi-selection; `type` remains readable only for older stored calendars. */
  types?: GoalType[];
  type?: GoalType;
  customInstructions?: string | null;
  dailyCalories?: number;
  dailyProtein?: number;
  dailyCarbs?: number;
  dailyFat?: number;
  restrictions: string[];
  customGoals?: CustomGoal[];
}

export type GoalType =
  'balanced' | 'weight-loss' | 'weight-gain' | 'muscle-gain' | 'maintenance' | 'variety' | 'custom';

export interface CustomGoal {
  name: string;
  target: number;
  unit: string;
  frequency: GoalFrequency;
}

export type GoalFrequency = 'daily' | 'weekly';

// Los nombres de los dias y de las comidas ya no viven aqui. Un catalogo con la frase dentro se pinta tal
// cual y no hay idioma que lo alcance: los dias salen de `Intl` con `dateLocale()` (`core/time.ts`) y las
// comidas, de `MEAL_LABEL_KEYS` (`core/i18n/labels.ts`). `DAY_OF_WEEK_LABELS` y `MEAL_TYPE_LABELS` estaban
// exportados y no los leia nadie, que es la forma mas barata de tener texto sin traducir (## 12u).

/**
 * La etiqueta de cada objetivo. Son **claves del diccionario**, no texto: lo mismo que se guarda es el
 * `GoalType`, y lo que se ensena depende del idioma de quien mira (HOGARIA-SPEC 12s-A).
 */
export const GOAL_TYPE_LABELS: Record<GoalType, TranslationKey> = {
  balanced: 'calendar.goal.balanced',
  'weight-loss': 'taste.goal.weight-loss',
  'weight-gain': 'taste.goal.weight-gain',
  'muscle-gain': 'taste.goal.muscle-gain',
  maintenance: 'calendar.goal.maintenance',
  variety: 'calendar.goal.variety',
  custom: 'calendar.goal.custom'
};

export const DAY_ORDER: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
];

/**
 * A qué hora come esta casa, por defecto. Aqui y no en `core/meal-times.ts` porque tambien la necesita
 * `app-meal-hours` (un componente del design system, que no importa de `core/`), y porque es el mismo
 * dato que responde el server cuando no hay nada guardado: una copia por pantalla es una copia de mas.
 * El espejo con el server lo vigila `server/src/utils/meal-times-mirror.spec.ts`.
 */
export const MEAL_TIME_DEFAULTS: Record<MealType, string> = {
  breakfast: '09:00',
  lunch: '14:00',
  snack: '17:00',
  dinner: '20:30'
};

/** Horas de la casa, siempre completas: lo que no esta escrito es el defecto, no un hueco. */
export type MealTimes = Record<MealType, string>;

/**
 * Que la IA planifique cada comida (HOGARIA-SPEC 12t-T). `true` de fabrica para las cuatro, que es
 * exactamente lo que hacia la app antes de esta preferencia: una casa que no ha dicho nada sigue
 * teniendo la semana entera.
 *
 * Mismo sitio y mismo motivo que `MEAL_TIME_DEFAULTS`: lo necesita `app-meal-hours` (que no importa de
 * `core/`) y es el dato que responde el server cuando no hay nada guardado. Su espejo del lado server
 * lo vigila `server/src/utils/meal-times-mirror.spec.ts`.
 */
export const MEAL_PLAN_DEFAULTS: Record<MealType, boolean> = {
  breakfast: true,
  lunch: true,
  snack: true,
  dinner: true
};

/** Los cuatro permisos, siempre completos: lo que no esta escrito es «si», no un hueco. */
export type MealPlan = Record<MealType, boolean>;

/**
 * El orden del día español: desayuno, almuerzo, merienda, cena. Estuvo al revés (cena antes que
 * merienda) desde la primera version, y no era un detalle de etiqueta: es la clave con la que se
 * ordenan la rejilla, el mes y las filas que escribe la IA, asi que ahi se leia una cena a media
 * tarde. La convenciones de hora viven en `calendar-grid.ts`, y siguen este mismo orden.
 */
export const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'snack', 'dinner'];

/* ═══════════════════════════════════════════════════════════════════════
   Modelo de vistas del calendario (día / 4 días / semana / mes / año / agenda)
   ═══════════════════════════════════════════════════════════════════════ */

/** Vista activa del calendario. `week` es la por defecto y la que no sale en la URL. */
export type CalendarView = 'day' | 'fourDays' | 'week' | 'month' | 'year' | 'agenda';

export const CALENDAR_VIEWS = ['day', 'fourDays', 'week', 'month', 'year', 'agenda'] as const;
/** Claves del diccionario, como `GOAL_TYPE_LABELS`. */
export const CALENDAR_VIEW_LABELS: Record<CalendarView, TranslationKey> = {
  day: 'calendar.view.day',
  fourDays: 'calendar.view.four_days',
  week: 'calendar.view.week',
  month: 'calendar.view.month',
  year: 'calendar.view.year',
  agenda: 'calendar.view.agenda'
};

/** Query params que definen lo que se está viendo. */
export const CALENDAR_VIEW_PARAM = 'view';
export const CALENDAR_DATE_PARAM = 'date';

/**
 * Comida ya normalizada desde la fila cruda de la API (`snake_case`).
 * `title` resuelve la receta o lo que el usuario escribió a mano: las vistas
 * no deberían volver a preguntar por ninguna de las dos columnas.
 */
export interface CalendarMeal {
  id: string;
  date: string;
  mealType: MealType;
  title: string;
  recipeId?: string | null;
  customMeal?: string | null;
  time?: string | null;
  servings: number;
  notes?: string | null;
  completed: boolean;
  /** Calorías de la receta (por ración), si el plato viene del recetario. */
  calories?: number | null;
  /** True only for a meal explicitly assigned through a household proposal. */
  isShared?: boolean;
  /** Active household users explicitly assigned to this shared meal. */
  participantIds?: string[];
  /** Derived client-side permission for the currently active member; never persisted. */
  canRecordConsumption?: boolean;
}

/** Un día tal y como lo consume una vista: fecha + sus comidas + resumen. */
export interface CalendarDay {
  date: Date;
  iso: string;
  /** false en las celdas de mes que pertenecen al mes anterior/siguiente. */
  inCurrentMonth: boolean;
  isToday: boolean;
  meals: CalendarMeal[];
  calories: number;
  /** true si alguna comida del día trae datos nutricionales. */
  hasNutrition: boolean;
}

/** Cómo se pinta cada tipo de comida: color por tipo, como en Google Calendar. */
export interface MealTypeMeta {
  /**
   * El acento del tipo. Es un `var()` y no un hex, y por eso puede vivir en el modelo: lo que hace
   * legible una rejilla de 40 celdas es que «desayuno» sea siempre el mismo color, y ese color tiene
   * que cambiar con el tema. Un hex aqui seria un segundo tema que la hoja de estilos no alcanza.
   */
  color: string;
}

/**
 * Meta de cada comida. Solo el color: la etiqueta se ensena con `MEAL_LABEL_KEYS`
 * (`core/i18n/labels.ts`) y el prompt de la IA arma sus propias cadenas en el server, asi que aqui no
 * hay texto de interfaz que traducir ni contrato que romper (HOGARIA-SPEC ## 12u).
 */
export const MEAL_TYPE_META: Record<MealType, MealTypeMeta> = {
  breakfast: { color: 'var(--warning)' },
  lunch: { color: 'var(--primary)' },
  snack: { color: 'var(--secondary)' },
  dinner: { color: 'var(--info)' }
};

/**
 * Día ya preparado para pintar: las comidas repartidas por franja, para que las
 * vistas no llamen a funciones en el template (una por celda y por detección de
 * cambios) y el `trackBy` sea estable.
 */
export interface CalendarDayView extends CalendarDay {
  slots: Record<MealType, CalendarMeal[]>;
  planned: number;
  done: number;
  /** Sueltas de la casa del mismo día (HOGARIA-SPEC §8f), ya filtradas por capas. */
  events: HouseholdEvent[];
}

/**
 * Las otras cosas de la casa (HOGARIA-SPEC §8f). Las comidas NO son un tipo de aqui
 * abajo: vienen del plan semanal y se proyectan, para que no haya dos verdades sobre lo
 * que se cena. Por eso `meal` no tiene META propia: es una CAPA visible, no un evento.
 */
export const HOUSEHOLD_EVENT_KINDS = [
  'shopping',
  'home',
  'appointment',
  'personal',
  'other'
] as const;
export type HouseholdEventKind = (typeof HOUSEHOLD_EVENT_KINDS)[number];

/** Quien esta invitado a una suelta: nombre y foto, como en todo lo que es identidad. */
export interface EventAttendee {
  id: string;
  name: string;
  avatar?: string | null;
}

export interface HouseholdEvent {
  id: string;
  title: string;
  kind: HouseholdEventKind;
  date: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  color: string | null;
  notes: string | null;
  location: string | null;
  source: string;
  userId: string;
  authorName: string | null;
  /** La foto del autor, si la tiene. El nombre se congelo al escribir; la foto es la de hoy. */
  authorAvatar?: string | null;
  editable: boolean;
  /**
   * Quien mas entra en el evento (HOGARIA-SPEC 12o). Viene del servidor con la lista ya resuelta, y
   * `attendeeIds` es lo que el dialog tiene que volver a marcar al editar: sin las dos, o se pintan
   * caras sin seleccion o se pierde a alguien al guardar.
   */
  attendees?: EventAttendee[];
  attendeeIds?: string[];
  /**
   * Cada cuanto se repite (HOGARIA-SPEC 12t-R). `none` o ausente es un dia suelto, que es lo que eran
   * todas las sueltas hasta ayer. Las ocurrencias no se guardan en ningun sitio: el servidor las
   * calcula sobre la ventana leida, y por eso aqui llegan como una entrada por dia.
   */
  recurrence?: HouseholdRecurrence;
  /** Regla ampliada opcional. Ausente conserva la semántica legacy de `recurrence`. */
  recurrenceRule?: CalendarRecurrenceRule | null;
  /** El dia que define la serie. No es `date` cuando se abre la serie desde un martes cualquiera. */
  seriesDate?: string;
}

export const HOUSEHOLD_EVENT_META: Record<
  HouseholdEventKind,
  {
    labelKey: TranslationKey;
    color: string;
    icon: 'shopping_cart' | 'home' | 'event_available' | 'person' | 'flag';
  }
> = {
  shopping: { labelKey: 'nav.shopping', color: '#4FA3D1', icon: 'shopping_cart' },
  home: { labelKey: 'household_event.home', color: '#4CAF50', icon: 'home' },
  appointment: {
    labelKey: 'household_event.appointment',
    color: '#E05A5A',
    icon: 'event_available'
  },
  personal: { labelKey: 'household_event.personal', color: '#8E5AC8', icon: 'person' },
  other: { labelKey: 'household_event.other', color: '#8A8F98', icon: 'flag' }
};

/**
 * Cada cuanto se repite una suelta (HOGARIA-SPEC 12t-R). Dos cadencias y «no se repite», que es lo que
 * se pide de verdad en una casa: el martes de carpintero y el pan de los sabados. Mensual, quincenal y
 * el resto van al §13 —una opcion en el menu que luego no se puede cumplir es peor que no tenerla.
 */
export const HOUSEHOLD_RECURRENCES = ['none', 'daily', 'weekly'] as const;
export type HouseholdRecurrence = (typeof HOUSEHOLD_RECURRENCES)[number];

export type CalendarRecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type CalendarRecurrenceEnd =
  { type: 'never' } | { type: 'date'; date: string } | { type: 'count'; count: number };
/** Days follow ISO-8601 numbering: Monday=1 through Sunday=7. */
export interface CalendarRecurrenceRule {
  frequency: CalendarRecurrenceFrequency;
  interval: number;
  weekdays?: number[];
  end: CalendarRecurrenceEnd;
}

/** Etiquetas del selector, en el catalogo y no en el componente: el idioma cambia y el campo no. */
export const HOUSEHOLD_RECURRENCE_META: Record<HouseholdRecurrence, { labelKey: TranslationKey }> =
  {
    none: { labelKey: 'calendar.no_se_repite' },
    daily: { labelKey: 'calendar.todos_los_dias' },
    weekly: { labelKey: 'calendar.cada_semana' }
  };

export const HOUSEHOLD_EVENT_COLORS = [
  '#4FA3D1',
  '#4CAF50',
  '#E05A5A',
  '#8E5AC8',
  '#C99A2E',
  '#2FA79B'
];

export function eventTimeLabel(event: HouseholdEvent): string {
  if (event.allDay || !event.startTime) return '';
  return event.endTime ? `${event.startTime}–${event.endTime}` : event.startTime;
}
