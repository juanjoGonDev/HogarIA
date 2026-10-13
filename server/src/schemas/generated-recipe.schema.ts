import { z } from 'zod';

const recipeInstructionStepSchema = z
  .object({
    stepNumber: z.number().int().positive(),
    instruction: z.string().trim().min(1),
    duration: z.number().int().positive().nullable(),
    tips: z.string().nullable(),
    warning: z.string().nullable(),
    illustration: z.null()
  })
  .strict();

const orderedStepsSchema = z
  .array(recipeInstructionStepSchema)
  .min(1)
  .superRefine((steps, context) => {
    steps.forEach((step, index) => {
      if (step.stepNumber !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: [index, 'stepNumber'],
          message: 'Recipe steps must be ordered and numbered from 1'
        });
      }
    });
  });

export const recipeInstructionsByLevelSchema = z
  .object({
    basic: orderedStepsSchema,
    intermediate: orderedStepsSchema,
    expert: orderedStepsSchema
  })
  .strict();

const generatedIngredientSchema = z
  .object({
    name: z.string().trim().min(1),
    quantity: z.number().positive(),
    unit: z.enum(['g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'unit', 'bunch', 'slice', 'piece']),
    preparation: z.string().nullable(),
    isOptional: z.boolean(),
    substitutes: z.array(z.string().trim().min(1)).default([]),
    notes: z.string().nullable()
  })
  .strict();

export const generatedRecipeCandidateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(1000),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    cuisine: z.string().max(50).nullable(),
    totalTime: z.number().int().positive(),
    prepTime: z.number().int().positive(),
    cookTime: z.number().int().positive(),
    restTime: z.number().int().positive().nullable(),
    servings: z.number().int().positive(),
    calories: z.number().positive().nullable(),
    ingredients: z.array(generatedIngredientSchema).min(1),
    utensils: z.array(z.string()),
    guidance: z
      .object({
        appliances: z.array(z.string().trim().min(1)).max(10),
        parallelTasks: z.array(z.string().trim().min(1)).max(10),
        tipsAndVariations: z.array(z.string().trim().min(1)).max(10),
        batchCookingWarning: z.string().trim().min(1).max(500).nullable()
      })
      .strict(),
    instructionsByLevel: recipeInstructionsByLevelSchema,
    nutrition: z
      .object({
        calories: z.number(),
        protein: z.number(),
        carbs: z.number(),
        fat: z.number(),
        fiber: z.number().nullable()
      })
      .strict()
      .nullable(),
    storage: z
      .object({
        method: z.string().trim().min(1),
        duration: z.string().trim().min(1),
        reheating: z.string().nullable(),
        container: z.string().nullable(),
        freezingPossible: z.boolean(),
        freezingDuration: z.string().nullable()
      })
      .strict()
      .nullable(),
    tags: z.array(z.string())
  })
  .strict();

export type GeneratedRecipeCandidate = z.infer<typeof generatedRecipeCandidateSchema>;
