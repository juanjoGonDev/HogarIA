import { z } from 'zod';
import { MEAL_PROPOSAL_LIMITS } from './household-meal-proposal.schema.js';

const expectedVersionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const householdMealConsumptionSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('realized'),
      servings: z.number().int().min(1).max(MEAL_PROPOSAL_LIMITS.maxServings),
      expectedVersion: expectedVersionSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('not_realized'),
      servings: z.literal(0),
      expectedVersion: expectedVersionSchema
    })
    .strict()
]);

export type HouseholdMealConsumptionInput = z.infer<typeof householdMealConsumptionSchema>;
