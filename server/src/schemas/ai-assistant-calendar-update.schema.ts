import { z } from 'zod';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  }, 'Expected a real ISO date');

const eventKindSchema = z.enum(['appointment', 'home', 'shopping', 'personal', 'other']);
const eventTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();
const eventTextSchema = (max: number) => z.string().trim().min(1).max(max).nullable();

const eventSnapshotSchema = z
  .object({
    householdId: z.string().max(128).nullable(),
    title: z.string().trim().min(1).max(120),
    kind: eventKindSchema,
    date: dateSchema,
    startTime: eventTimeSchema,
    endTime: eventTimeSchema,
    allDay: z.boolean(),
    color: z.string().max(48).nullable(),
    notes: z.string().max(500).nullable(),
    location: z.string().max(120).nullable(),
    recurrence: z.enum(['none', 'daily', 'weekly']),
    recurrenceRule: z.string().max(4000).nullable(),
    exceptions: z.string().max(4000),
    source: z.string().max(32),
    updatedAt: z.string().max(48).nullable()
  })
  .strict();

export const assistantUpdateCalendarEventSchema = z
  .object({
    changes: z
      .object({
        title: z.string().trim().min(1).max(120).optional(),
        kind: eventKindSchema.optional(),
        date: dateSchema.optional(),
        startTime: eventTimeSchema.optional(),
        endTime: eventTimeSchema.optional(),
        allDay: z.boolean().optional(),
        notes: eventTextSchema(500).optional(),
        location: eventTextSchema(120).optional()
      })
      .strict()
      .superRefine((changes, context) => {
        if (Object.keys(changes).length === 0) {
          context.addIssue({
            code: 'custom',
            message: 'At least one calendar event field must change'
          });
        }
        if (
          changes.startTime !== undefined &&
          changes.endTime !== undefined &&
          changes.startTime !== null &&
          changes.endTime !== null &&
          changes.endTime < changes.startTime
        ) {
          context.addIssue({
            code: 'custom',
            path: ['endTime'],
            message: 'endTime cannot be earlier than startTime'
          });
        }
        if (
          changes.allDay === true &&
          ((changes.startTime !== undefined && changes.startTime !== null) ||
            (changes.endTime !== undefined && changes.endTime !== null))
        ) {
          context.addIssue({
            code: 'custom',
            path: ['allDay'],
            message: 'All-day events cannot have time values'
          });
        }
      }),
    assistantAction: z
      .object({
        operation: z.literal('update_event'),
        targetId: z.string().trim().min(1).max(128),
        householdId: z.string().trim().min(1).max(128).nullable(),
        before: eventSnapshotSchema
      })
      .strict()
  })
  .strict();

export type AssistantUpdateCalendarEventRequest = z.infer<
  typeof assistantUpdateCalendarEventSchema
>;
