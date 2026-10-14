import { z } from 'zod';
import { createAiResponseFormat } from './ai-response-format.js';
import { HOUSEHOLD_TASK_LIMITS } from './household-task.schema.js';

const proposalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const zoneIdSchema = z.string().trim().min(1).max(80);

export const householdTaskProposalTaskObjectSchema = z
  .object({
    title: z.string().trim().min(1),
    scheduledDate: proposalDateSchema,
    spaceId: zoneIdSchema.nullable()
  })
  .strict();

/** Structural portion sent to Structured Outputs; week/zone/duplicate invariants are local-only. */
export const householdTaskProposalObjectSchema = z
  .object({
    tasks: z.array(householdTaskProposalTaskObjectSchema).max(HOUSEHOLD_TASK_LIMITS.maxTasksPerWeek)
  })
  .strict();

export type HouseholdTaskProposal = z.infer<typeof householdTaskProposalObjectSchema>;
export type HouseholdTaskProposalTask = z.infer<typeof householdTaskProposalTaskObjectSchema>;

export const HOUSEHOLD_TASK_PROPOSAL_RESPONSE_FORMAT = createAiResponseFormat(
  'household_task_proposal',
  householdTaskProposalObjectSchema
);
