import { z } from 'zod';
import { MEAL_PROPOSAL_LIMITS, mealProposalEventSchema } from './household-meal-proposal.schema.js';

export const HOUSEHOLD_MEAL_PROPOSAL_MAX_MEMBERS = 100;

export const householdMealProposalRequestSchema = z
  .object({
    weekStart: z.iso.date(),
    householdMemberIds: z
      .array(z.string().trim().min(1).max(128))
      .min(1)
      .max(HOUSEHOLD_MEAL_PROPOSAL_MAX_MEMBERS)
  })
  .strict()
  .superRefine((value, context) => {
    const [year, month, day] = value.weekStart.split('-').map(Number);
    if (new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay() !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['weekStart'],
        message: 'La semana debe empezar en lunes.'
      });
    }
    if (new Set(value.householdMemberIds).size !== value.householdMemberIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['householdMemberIds'],
        message: 'No se puede seleccionar dos veces a la misma persona.'
      });
    }
  });

export type HouseholdMealProposalRequest = z.infer<typeof householdMealProposalRequestSchema>;

const proposalEventSubmissionSchema = mealProposalEventSchema.extend({
  id: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((value) => !value.includes(':'), 'El identificador no puede incluir dos puntos.')
});

export const householdMealProposalConfirmRequestSchema = z
  .object({
    proposalId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !value.includes(':')),
    weekStart: z.iso.date(),
    householdMemberIds: z
      .array(z.string().trim().min(1).max(128))
      .min(1)
      .max(HOUSEHOLD_MEAL_PROPOSAL_MAX_MEMBERS),
    // Membership IDs are deliberately not accepted here; the server derives them from aliases.
    events: z.array(proposalEventSubmissionSchema).min(1).max(MEAL_PROPOSAL_LIMITS.maxEvents)
  })
  .strict()
  .superRefine((value, context) => {
    const [year, month, day] = value.weekStart.split('-').map(Number);
    if (new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay() !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['weekStart'],
        message: 'La semana debe empezar en lunes.'
      });
    }
    if (new Set(value.householdMemberIds).size !== value.householdMemberIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['householdMemberIds'],
        message: 'No se puede seleccionar dos veces a la misma persona.'
      });
    }
    const eventIds = value.events.map(({ id }) => id);
    if (new Set(eventIds).size !== eventIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'Los eventos no pueden repetirse.'
      });
    }
  });

export type HouseholdMealProposalConfirmRequest = z.infer<
  typeof householdMealProposalConfirmRequestSchema
>;
