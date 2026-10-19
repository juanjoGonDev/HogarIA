import { z } from 'zod';
import { dayFromISO, RECURRENCES, RECURRENCE_FREQUENCIES } from '../utils/calendar-recurrence.js';
import { DATE_PATTERN, formArray, formBool, formColor, formDate, formDefault, formField, formList, formNumber, formPartial, formText, formTime, optionalDate, requiredText } from './form.js';

/** Orden del dia en Espana: la merienda va antes que la cena (HOGARIA-SPEC 12o). */
const mealTypeEnum = z.enum(['breakfast', 'lunch', 'snack', 'dinner']);
const goalTypeEnum = z.enum([
  'balanced', 'weight-loss', 'weight-gain', 'muscle-gain', 'maintenance', 'variety', 'custom'
]);
const goalFrequencyEnum = z.enum(['daily', 'weekly']);

const customGoalSchema = z.object({
  name: requiredText(100, 'Objetivo'),
  target: formNumber({ positive: true }),
  unit: formText(20, 'Unidad'),
  frequency: formDefault(goalFrequencyEnum, 'daily')
});

const nutritionalGoalsSchema = z
  .object({
  /** `types` is canonical; `type` accepts calendars saved by the previous single-choice UI. */
  types: formArray(goalTypeEnum).optional(),
  type: formField(goalTypeEnum),
  customInstructions: formText(2000),
  dailyCalories: formNumber({ positive: true }),
  dailyProtein: formNumber({ positive: true }),
  dailyCarbs: formNumber({ positive: true }),
  dailyFat: formNumber({ positive: true }),
  restrictions: formArray(z.string()),
  customGoals: formArray(customGoalSchema)
  })
  .superRefine((goals, context) => {
    const selected = goals.types?.length ? goals.types : goals.type ? [goals.type] : ['balanced'];
    if (selected.includes('custom') && !goals.customInstructions?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customInstructions'],
        message: 'Describe el objetivo personalizado'
      });
    }
  })
  .transform(({ type: legacyType, types, customInstructions, ...rest }) => ({
    ...rest,
    types: [...new Set(types?.length ? types : legacyType ? [legacyType] : ['balanced'])],
    customInstructions: customInstructions?.trim() ?? null
  }));

const mealSchema = z.object({
  date: formDate('Fecha'),
  mealType: mealTypeEnum,
  recipeId: formText(40, 'Receta'),
  customMeal: formText(200, 'Plato'),
  time: formTime('Hora'),
  servings: formNumber({ int: true, positive: true }),
  notes: formText(500, 'Notas')
});

// Calendar schemas
export const createCalendarSchema = z.object({
  weekStart: formDate('weekStart'),
  goals: formField(nutritionalGoalsSchema)
});

export const updateCalendarSchema = z.object({
  goals: formField(nutritionalGoalsSchema)
});

export const addMealSchema = mealSchema;

/**
 * Todo opcional, y todo admite `null` para PODER quitarlo: con `.optional()` a secas borrar la hora
 * de una comida era imposible (el frontend mandaba `undefined`, que significa «no tocar»).
 */
export const updateMealSchema = z.object({
  recipeId: formText(40, 'Receta'),
  customMeal: formText(200, 'Plato'),
  time: formTime('Hora'),
  servings: formNumber({ int: true, positive: true }),
  notes: formText(500, 'Notas'),
  completed: formBool()
});

/** Sustituciones de comidas de una sola vez: el servidor aplica todas o ninguna. */
export const replaceSelectedMealsSchema = z.object({
  replacements: z
    .array(
      z.object({
        id: z.string().trim().min(1, 'Comida'),
        customMeal: requiredText(200, 'Plato nuevo')
      }).strict()
    )
    .min(1, 'Selecciona al menos un plato')
    .max(28, 'No se pueden sustituir más de 28 platos a la vez')
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'No repitas platos')
}).strict();

export const completeMealSchema = z.object({
  completed: z.boolean({ error: 'completed: true o false' })
});

export const calendarFilterSchema = z.object({
  startDate: optionalDate('startDate'),
  endDate: optionalDate('endDate')
});

export const updateGoalsSchema = nutritionalGoalsSchema;

export type CreateCalendarInput = z.infer<typeof createCalendarSchema>;
export type UpdateCalendarInput = z.infer<typeof updateCalendarSchema>;
export type AddMealInput = z.infer<typeof addMealSchema>;
export type UpdateMealInput = z.infer<typeof updateMealSchema>;
export type CompleteMealInput = z.infer<typeof completeMealSchema>;
export type CalendarFilterInput = z.infer<typeof calendarFilterSchema>;
export type UpdateGoalsInput = z.infer<typeof updateGoalsSchema>;

/**
 * Sueltas del calendario de la casa (HOGARIA-SPEC §8f). `meal` esta en la lista de tipos pero NO se
 * puede crear por aqui: la comida la manda el plan semanal, y si existiera una fila suelta por plato
 * habria dos verdades que se desincronizan en cuanto alguien cambie la cena.
 */
export const CALENDAR_EVENT_KINDS = ['meal', 'shopping', 'home', 'appointment', 'personal', 'other'] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];
const eventKindEnum = z.enum(CALENDAR_EVENT_KINDS);
// Cada cuanto se repite una suelta (HOGARIA-SPEC 12t-R). La lista vive en el modulo que la expande,
// para que «que cadencias existen» no pueda responder dos cosas distintas segun donde se pregunte.
const recurrenceEnum = z.enum(RECURRENCES);
const recurrenceRuleEndSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('never') }),
  z.object({
    type: z.literal('date'),
    date: formDate('Fecha final').refine((date) => dayFromISO(date) !== null, 'Fecha final: el día no existe')
  }),
  z.object({ type: z.literal('count'), count: z.number().int().min(1).max(999) })
]);
const recurrenceRuleSchema = z
  .object({
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    interval: z.number().int().min(1).max(99),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, 'No repitas días de la semana')
      .optional(),
    end: recurrenceRuleEndSchema
  })
  .superRefine((rule, ctx) => {
    if (rule.frequency !== 'weekly' && rule.weekdays !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'Los días de la semana solo se aplican a una repetición semanal', path: ['weekdays'] });
    }
  });
type StructuredRecurrenceRule = z.infer<typeof recurrenceRuleSchema>;
const eventUserId = z.string().trim().min(1, 'Sin identificador').max(40);

export const calendarEventFilterSchema = z.object({
  from: formDate('from'),
  to: formDate('to'),
  // Coma de tipos. Un tipo que no existe se ignora en vez de reventar: es un filtro, no una
  // escritura, y lo que se pide al cambiar de pestana es «ensename lo que sepas».
  kinds: z
    .string()
    .trim()
    .nullish()
    .transform((value) =>
      !value
        ? ([] as CalendarEventKind[])
        : value
            .split(',')
            .map((kind) => kind.trim())
            .filter((kind): kind is CalendarEventKind =>
              (CALENDAR_EVENT_KINDS as readonly string[]).includes(kind)
            )
    ),
  limit: z.coerce.number().int().min(1).max(500).catch(200)
});

/** Campos, sin el refine cruzado: asi el PATCH puede reutilizarlos con `.omit()`. */
const calendarEventFields = z.object({
  title: requiredText(120, 'Titulo'),
  kind: formDefault(eventKindEnum, 'other'),
  /**
   * Cada cuanto se repite (12t-R). Una fila, no una fila por dia: las ocurrencias se calculan al leer.
   * Los dias quitados (`exceptions`) no se pueden escribir por aqui —los gestiona el server con
   * «solo este dia no»—, porque aceptar la lista del cliente seria poder quitarle dias a la serie de
   * otra persona a traicion.
   */
  recurrence: formDefault(recurrenceEnum, 'none'),
  /** Regla avanzada opcional; al estar presente es la fuente efectiva de expansión. */
  recurrenceRule: recurrenceRuleSchema.nullish(),
  date: formDate('Dia'),
  startTime: formTime('Desde'),
  endTime: formTime('Hasta'),
  allDay: formBool(),
  color: formColor(),
  notes: formText(500, 'Notas'),
  location: formText(120, 'Sitio'),
  sharedWithHousehold: formBool(),
  /**
   * Quien mas entra en el evento (HOGARIA-SPEC 12o). `null` y `[]` lo dejan sin invitados, y que
   * `undefined` signifique «no tocar» es lo que hace que el dialog pueda guardar el titulo sin
   * desinvitar a media casa por accidente.
   */
  attendeeIds: formList(eventUserId)
});

// OJO: `.omit()` de zod 4 no puede usarse sobre un objeto con `.refine()` — por eso las
// horas se validan aparte (`compareEventTimes`) y el schema de arriba queda limpio.
function compareEventTimes(value: { startTime?: string | null; endTime?: string | null }): boolean {
  return !value.startTime || !value.endTime || value.startTime <= value.endTime;
}

export const createCalendarEventSchema = calendarEventFields.superRefine((value, ctx) => {
  if (!compareEventTimes(value)) {
    ctx.addIssue({ code: 'custom', message: 'endTime no puede ser anterior a startTime', path: ['endTime'] });
  }
  if (value.recurrenceRule?.end.type === 'date' && value.recurrenceRule.end.date < value.date) {
    ctx.addIssue({ code: 'custom', message: 'La fecha final no puede ser anterior al inicio de la serie', path: ['recurrenceRule', 'end', 'date'] });
  }
});

export const updateCalendarEventSchema = formPartial(calendarEventFields.omit({ sharedWithHousehold: true }))
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Nada que actualizar' });
    }
    if (!compareEventTimes(value)) {
      ctx.addIssue({ code: 'custom', message: 'endTime no puede ser anterior a startTime', path: ['endTime'] });
    }
    const recurrenceRule = value.recurrenceRule as StructuredRecurrenceRule | null | undefined;
    if (
      recurrenceRule &&
      recurrenceRule.end.type === 'date' &&
      typeof value.date === 'string' &&
      recurrenceRule.end.date < value.date
    ) {
      ctx.addIssue({ code: 'custom', message: 'La fecha final no puede ser anterior al inicio de la serie', path: ['recurrenceRule', 'end', 'date'] });
    }
  });

export type CalendarEventFilter = z.infer<typeof calendarEventFilterSchema>;
export type CreateCalendarEvent = z.infer<typeof createCalendarEventSchema>;
export type UpdateCalendarEvent = z.infer<typeof updateCalendarEventSchema>;

/** Se exporta para que el contrato de formularios compruebe el patron de fecha en un solo sitio. */
export { DATE_PATTERN };
