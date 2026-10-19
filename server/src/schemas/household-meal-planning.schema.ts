import { z } from 'zod';
import { MEAL_TYPE_KEYS, tasteGoalEnum } from '../utils/taste-profile.js';

const mealTypesPatchSchema = z
  .object({
    breakfast: z.boolean().optional(),
    lunch: z.boolean().optional(),
    snack: z.boolean().optional(),
    dinner: z.boolean().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Indica al menos una comida.');

const mealTimesPatchSchema = z
  .object({
    breakfast: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    lunch: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    snack: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    dinner: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Indica al menos una hora.');

const objectivePatchSchema = z
  .object({
    goals: z.array(tasteGoalEnum).min(1).max(7).optional(),
    notes: z.string().trim().max(500).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Indica al menos un campo del objetivo.');

const householdPatchSchema = z
  .object({
    objective: objectivePatchSchema.optional(),
    mealTypes: mealTypesPatchSchema.optional(),
    mealTimes: mealTimesPatchSchema.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Indica al menos un ajuste del hogar.');

const memberSchedulePatchSchema = z
  .object({
    mealTypes: mealTypesPatchSchema.optional(),
    mealTimes: mealTimesPatchSchema.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Indica al menos un ajuste de horario.');

const memberPatchSchema = z
  .object({
    goalOverrideEnabled: z.boolean().optional(),
    scheduleOverrideEnabled: z.boolean().optional(),
    schedule: memberSchedulePatchSchema.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Indica al menos un ajuste personal.');

export const householdMealPlanningPatchSchema = z
  .object({
    household: householdPatchSchema.optional(),
    member: memberPatchSchema.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No hay ajustes que guardar.');

export type MealTypeKey = (typeof MEAL_TYPE_KEYS)[number];
export type HouseholdMealPlanningPatch = z.infer<typeof householdMealPlanningPatchSchema>;
