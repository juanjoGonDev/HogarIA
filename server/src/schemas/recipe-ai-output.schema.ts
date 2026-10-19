import { z } from 'zod';

export const AI_RECIPE_OUTPUT_LIMITS = {
  maxIngredients: 80,
  maxInstructionsPerLevel: 30,
  maxUtensils: 30,
  maxTags: 30
} as const;

const ingredientUnitSchema = z.enum([
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

const recipeIngredientSchema = z
  .object({
    name: z.string().trim().min(1),
    quantity: z.number().finite().positive().max(1_000_000),
    unit: ingredientUnitSchema,
    preparation: z.string().trim().nullable(),
    isOptional: z.boolean(),
    substitutes: z.array(z.string().trim().min(1)).max(10),
    notes: z.string().trim().nullable()
  })
  .strict();

const recipeInstructionStepSchema = z
  .object({
    stepNumber: z.number().int().positive(),
    instruction: z.string().trim().min(1),
    duration: z.number().int().positive().max(1_440).nullable(),
    temperature: z
      .object({ value: z.number().finite(), unit: z.enum(['C', 'F']) })
      .strict()
      .nullable(),
    timerRequired: z.boolean(),
    timerDuration: z.number().int().positive().max(1_440).nullable(),
    tips: z.string().trim().nullable(),
    warning: z.string().trim().nullable(),
    illustration: z.null()
  })
  .strict();

const orderedRecipeStepsSchema = z
  .array(recipeInstructionStepSchema)
  .min(1)
  .max(AI_RECIPE_OUTPUT_LIMITS.maxInstructionsPerLevel)
  .superRefine((steps, context) => {
    steps.forEach((step, index) => {
      if (step.stepNumber !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: [index, 'stepNumber'],
          message: 'Recipe steps must be ordered and numbered from 1.'
        });
      }
    });
  });

const recipeInstructionsByLevelSchema = z
  .object({
    basic: orderedRecipeStepsSchema,
    intermediate: orderedRecipeStepsSchema,
    expert: orderedRecipeStepsSchema
  })
  .strict();

const recipeGuidanceSchema = z
  .object({
    appliances: z.array(z.string().trim().min(1)).max(10),
    parallelTasks: z.array(z.string().trim().min(1)).max(10),
    tipsAndVariations: z.array(z.string().trim().min(1)).max(10),
    batchCookingWarning: z.string().trim().min(1).nullable()
  })
  .strict();

const recipeNutritionSchema = z
  .object({
    calories: z.number().nonnegative(),
    protein: z.number().nonnegative(),
    carbs: z.number().nonnegative(),
    fat: z.number().nonnegative(),
    fiber: z.number().nonnegative().nullable()
  })
  .strict()
  .nullable();

const recipeStorageSchema = z
  .object({
    method: z.string().trim().min(1),
    duration: z.string().trim().min(1),
    reheatingInstructions: z.string().trim().nullable(),
    container: z.string().trim().nullable(),
    freezingPossible: z.boolean(),
    freezingDuration: z.string().trim().nullable()
  })
  .strict()
  .nullable();

/**
 * Canonical model-facing recipe JSON contract. Standalone recipe generation and
 * `weekly_meal_proposal.newRecipes[].recipe` must use this exact schema and shape.
 * The upcoming recipe-view refactor should evolve this contract here, not fork it per workflow.
 */
export const aiRecipeOutputSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    cuisine: z.string().trim().nullable(),
    totalTime: z.number().int().positive().max(1_440),
    prepTime: z.number().int().positive().max(1_440),
    cookTime: z.number().int().nonnegative().max(1_440),
    restTime: z.number().int().nonnegative().max(1_440).nullable(),
    baseServings: z.literal(1),
    calories: z.number().positive().nullable(),
    ingredients: z.array(recipeIngredientSchema).min(1).max(AI_RECIPE_OUTPUT_LIMITS.maxIngredients),
    utensils: z.array(z.string().trim().min(1)).max(AI_RECIPE_OUTPUT_LIMITS.maxUtensils),
    guidance: recipeGuidanceSchema,
    instructionsByLevel: recipeInstructionsByLevelSchema,
    nutrition: recipeNutritionSchema,
    storage: recipeStorageSchema,
    tags: z.array(z.string().trim().min(1)).max(AI_RECIPE_OUTPUT_LIMITS.maxTags)
  })
  .strict();

export type AiRecipeOutput = z.infer<typeof aiRecipeOutputSchema>;
