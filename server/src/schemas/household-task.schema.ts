import { z } from 'zod';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealIsoDate, 'La fecha no es válida');

const weekStartSchema = dateSchema.refine(isMonday, 'La semana debe comenzar en lunes');

export const HOUSEHOLD_TASK_LIMITS = {
  maxTasksPerWeek: 200,
  maxDetailsLength: 500
} as const;

export const householdTaskOccurrenceSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1),
  details: z.string().trim().max(HOUSEHOLD_TASK_LIMITS.maxDetailsLength).nullable(),
  spaceId: z.string().trim().min(1).max(80).nullable(),
  scheduledDate: dateSchema,
  assignedMemberId: z.string().trim().min(1).max(80).nullable(),
  completed: z.boolean()
});

export const householdTaskOccurrencesSchema = z
  .array(householdTaskOccurrenceSchema)
  .max(HOUSEHOLD_TASK_LIMITS.maxTasksPerWeek)
  .superRefine((tasks, context) => {
    const ids = new Set<string>();
    tasks.forEach((task, index) => {
      if (ids.has(task.id)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: 'El identificador de la tarea está repetido'
        });
      }
      ids.add(task.id);
    });
  });

export const householdTaskWeekQuerySchema = z.object({ weekStart: weekStartSchema });

export const householdTaskWeekWriteSchema = z
  .object({
    baseVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    weekStart: weekStartSchema,
    tasks: householdTaskOccurrencesSchema,
    assistantAction: z
      .object({
        operation: z.literal('update_task'),
        targetId: z.string().trim().min(1).max(80),
        before: householdTaskOccurrenceSchema
      })
      .strict()
      .nullable()
      .optional()
  })
  .superRefine((value, context) => {
    const start = Date.parse(`${value.weekStart}T00:00:00.000Z`);
    const end = start + 6 * 86_400_000;
    value.tasks.forEach((task, index) => {
      const date = Date.parse(`${task.scheduledDate}T00:00:00.000Z`);
      if (date < start || date > end) {
        context.addIssue({
          code: 'custom',
          path: ['tasks', index, 'scheduledDate'],
          message: 'La tarea debe pertenecer a la semana seleccionada'
        });
      }
    });
  });

export type HouseholdTaskOccurrence = z.infer<typeof householdTaskOccurrenceSchema>;
export type HouseholdTaskWeekWrite = z.infer<typeof householdTaskWeekWriteSchema>;

function isRealIsoDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function isMonday(value: string): boolean {
  return new Date(`${value}T00:00:00.000Z`).getUTCDay() === 1;
}
