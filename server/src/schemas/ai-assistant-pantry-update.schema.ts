import { z } from 'zod';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  }, 'Expected a real ISO date');

const pantryUnitSchema = z.enum([
  'g',
  'kg',
  'ml',
  'l',
  'cup',
  'tbsp',
  'tsp',
  'unit',
  'bunch',
  'slice',
  'piece'
]);

export const assistantUpdateIngredientSchema = z
  .object({
    changes: z
      .object({
        name: z.string().trim().min(1).max(3000).optional(),
        category: z.string().trim().min(1).max(64).optional(),
        quantity: z.number().finite().min(0).max(100000).optional(),
        unit: pantryUnitSchema.optional(),
        expirationDate: dateSchema.nullable().optional(),
        location: z.enum(['fridge', 'freezer', 'pantry', 'counter']).optional(),
        notes: z.string().trim().max(500).nullable().optional()
      })
      .strict()
      .refine((changes) => Object.keys(changes).length > 0, {
        message: 'At least one pantry ingredient field must change'
      }),
    assistantAction: z
      .object({
        operation: z.literal('update_ingredient'),
        targetId: z.string().trim().min(1).max(128),
        before: z
          .object({
            name: z.string().min(1).max(3000),
            category: z.string().trim().min(1).max(64),
            quantity: z.number().finite().min(0).max(100000),
            unit: z.string().trim().min(1).max(48),
            expirationDate: z.string().max(48).nullable(),
            location: z.string().max(48).nullable(),
            notes: z.string().max(20000).nullable(),
            updatedAt: z.string().max(48).nullable()
          })
          .strict()
      })
      .strict()
  })
  .strict();

export type AssistantUpdateIngredientRequest = z.infer<typeof assistantUpdateIngredientSchema>;
