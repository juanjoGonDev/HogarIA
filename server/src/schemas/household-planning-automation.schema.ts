import { z } from 'zod';

export const householdPlanningAutomationModeSchema = z.enum(['generate', 'repeat']);
export const householdPlanningAutomationScopeSchema = z.enum(['tasks', 'meals']);
export const householdPlanningAutomationRunStatusSchema = z.enum([
  'in_progress',
  'review_required',
  'completed',
  'cancelled',
  'skipped'
]);
export const householdPlanningAutomationRunFailureCodeSchema = z.enum([
  'AUTOMATION_PAUSED',
  'CONFIG_STALE',
  'AUTHORIZATION_INVALID',
  'LEASE_EXPIRED_AMBIGUOUS',
  'PROVIDER_TIMEOUT_AMBIGUOUS',
  'PROVIDER_REJECTED',
  'INVALID_PROPOSAL',
  'PUBLISH_CONFLICT',
  'TARGET_WEEK_MISSED',
  'WORKER_FAILURE'
]);

export const householdPlanningAutomationRunSummarySchema = z
  .object({
    occurrenceKey: z.string().min(1),
    targetWeekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: householdPlanningAutomationRunStatusSchema,
    failureCode: householdPlanningAutomationRunFailureCodeSchema.nullable(),
    updatedAt: z.string().datetime()
  })
  .strict();

const weekdaySchema = z.number().int().min(1).max(7);
const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(isIanaTimeZone, 'Se requiere una zona horaria IANA válida y explícita');
const scopesSchema = z
  .array(householdPlanningAutomationScopeSchema)
  .max(2)
  .refine((scopes) => new Set(scopes).size === scopes.length, 'No se pueden repetir ámbitos');

const stateShape = {
  enabled: z.boolean(),
  mode: householdPlanningAutomationModeSchema.nullable(),
  scopes: scopesSchema,
  weekday: weekdaySchema.nullable(),
  localTime: localTimeSchema.nullable(),
  timeZone: timeZoneSchema.nullable(),
  version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
};

const completeScheduleKeys = ['mode', 'weekday', 'localTime', 'timeZone'] as const;

export const householdPlanningAutomationStateSchema = z
  .object(stateShape)
  .strict()
  .superRefine((value, context) => {
    if (!value.enabled) return;
    const missing = completeScheduleKeys.filter((key) => value[key] === null);
    if (value.scopes.length === 0 || missing.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['enabled'],
        message: 'La automatización requiere modo, ámbitos, día, hora y zona horaria explícitos'
      });
    }
  });

export const householdPlanningAutomationPatchSchema = z
  .object({
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    enabled: z.boolean().optional(),
    mode: householdPlanningAutomationModeSchema.nullable().optional(),
    scopes: scopesSchema.optional(),
    weekday: weekdaySchema.nullable().optional(),
    localTime: localTimeSchema.nullable().optional(),
    timeZone: timeZoneSchema.nullable().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value).every((key) => key === 'expectedVersion')) {
      context.addIssue({
        code: 'custom',
        path: ['expectedVersion'],
        message: 'El cambio debe incluir al menos un campo'
      });
    }
  });

/** Explicit, version-bound retry of one previously visible automation occurrence. */
export const householdPlanningAutomationRetrySchema = z
  .object({
    expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    occurrenceKey: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => value === value.trim())
  })
  .strict();

const occurrenceShape = {
  scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  localTime: localTimeSchema,
  timeZone: timeZoneSchema,
  utcInstant: z.string().datetime(),
  occurrenceKey: z.string().min(1)
};

export const householdPlanningAutomationResponseSchema = z
  .object({
    ...stateShape,
    nextRunAt: z.string().datetime().nullable(),
    nextRun: z.object(occurrenceShape).strict().nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.enabled) {
      if (value.nextRunAt !== null || value.nextRun !== null) {
        context.addIssue({
          code: 'custom',
          path: ['nextRunAt'],
          message: 'Una automatización pausada no tiene próxima ejecución'
        });
      }
      return;
    }
    const missing = completeScheduleKeys.filter((key) => value[key] === null);
    if (
      value.scopes.length === 0 ||
      missing.length > 0 ||
      value.nextRunAt === null ||
      value.nextRun === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['enabled'],
        message: 'La automatización activa requiere horario completo y próxima ejecución'
      });
    } else if (value.nextRunAt !== value.nextRun.utcInstant) {
      context.addIssue({
        code: 'custom',
        path: ['nextRunAt'],
        message: 'El instante de la próxima ejecución no coincide'
      });
    }
  });

export type HouseholdPlanningAutomationMode = z.infer<typeof householdPlanningAutomationModeSchema>;
export type HouseholdPlanningAutomationScope = z.infer<
  typeof householdPlanningAutomationScopeSchema
>;
export type HouseholdPlanningAutomationRunSummary = z.infer<
  typeof householdPlanningAutomationRunSummarySchema
>;
export type HouseholdPlanningAutomationState = z.infer<
  typeof householdPlanningAutomationStateSchema
>;
export type HouseholdPlanningAutomationPatch = z.infer<
  typeof householdPlanningAutomationPatchSchema
>;
export type HouseholdPlanningAutomationResponse = z.infer<
  typeof householdPlanningAutomationResponseSchema
>;

function isIanaTimeZone(value: string): boolean {
  if (value !== value.trim() || /^[+-]\d{2}(?::?\d{2})?$/.test(value)) return false;
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone.length > 0
    );
  } catch {
    return false;
  }
}
