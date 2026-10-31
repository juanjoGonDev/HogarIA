import { z } from 'zod';
import { householdMealShoppingPreviewQuerySchema } from './household-meal-shopping-preview.schema.js';

const approvedItemSchema = z
  .object({
    name: z.string().trim().min(1),
    unit: z.string().trim().min(1),
    quantity: z.number().finite().positive().max(10_000)
  })
  .strict();

/**
 * The browser may select and adjust items from a preview, but cannot send arbitrary products.
 * The route resolves each `(name, unit)` against a fresh server-side preview before writing.
 */
export const householdMealShoppingApprovalSchema = householdMealShoppingPreviewQuerySchema
  .extend({
    previewId: z.string().regex(/^[a-f0-9]{64}$/),
    items: z.array(approvedItemSchema).min(1).max(200)
  })
  .strict();

export type HouseholdMealShoppingApprovalInput = z.infer<
  typeof householdMealShoppingApprovalSchema
>;
