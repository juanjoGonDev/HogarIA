import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(80);
const memberIdsSchema = z
  .array(idSchema)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'Member IDs must be unique.');

export const householdPlanAssignmentsSchema = z.record(idSchema, memberIdsSchema);

export const householdPlanAssignmentWriteSchema = z
  .object({
    baseVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    basePlanVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    spaceId: idSchema,
    memberIds: memberIdsSchema
  })
  .strict();

export type HouseholdPlanAssignments = z.infer<typeof householdPlanAssignmentsSchema>;
export type HouseholdPlanAssignmentWrite = z.infer<typeof householdPlanAssignmentWriteSchema>;
