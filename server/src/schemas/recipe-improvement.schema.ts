import { z } from 'zod';

export const recipeImproveScopeSchema = z.enum([
  'details',
  'ingredients',
  'timing',
  'preparation',
  'guidance',
  'nutrition',
  'storage'
]);

export type RecipeImproveScope = z.infer<typeof recipeImproveScopeSchema>;

const ingredientSchema = z
  .object({
    name: z.string().trim().min(1),
    quantity: z.number().finite().positive().max(1_000_000),
    unit: z.enum(['g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'unit', 'bunch', 'slice', 'piece']),
    preparation: z.string().trim().nullable().optional(),
    isOptional: z.boolean().optional(),
    substitutes: z.array(z.string().trim().min(1)).max(10).optional(),
    notes: z.string().trim().nullable().optional()
  })
  .strict();

/** Editable step projection deliberately excludes photos, URLs, attributions and media ids. */
const editableStepSchema = z
  .object({
    stepNumber: z.number().int().positive(),
    instruction: z.string().trim().min(1),
    duration: z.number().int().positive().max(1_440).nullable().optional(),
    temperature: z
      .object({ value: z.number().finite(), unit: z.enum(['C', 'F']) })
      .strict()
      .nullable()
      .optional(),
    timerRequired: z.boolean().optional(),
    timerDuration: z.number().int().positive().max(1_440).nullable().optional(),
    tips: z.string().trim().nullable().optional(),
    warning: z.string().trim().nullable().optional(),
    // The shared recipe contract requires null here; URLs and other media stay forbidden.
    illustration: z.null().optional()
  })
  .strict();

const editableGuidanceSchema = z
  .object({
    appliances: z.array(z.string().trim().min(1)).max(10),
    parallelTasks: z.array(z.string().trim().min(1)).max(10),
    tipsAndVariations: z.array(z.string().trim().min(1)).max(10),
    batchCookingWarning: z.string().trim().min(1).nullable()
  })
  .strict();

const editableNutritionSchema = z
  .object({
    calories: z.number().nonnegative(),
    protein: z.number().nonnegative(),
    carbs: z.number().nonnegative(),
    fat: z.number().nonnegative(),
    fiber: z.number().nonnegative().nullable(),
    sugar: z.number().nonnegative().nullable().optional(),
    sodium: z.number().nonnegative().nullable().optional()
  })
  .strict()
  .nullable();

const editableStorageSchema = z
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

const editableRecipeBaseSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().nullable().optional(),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    cuisine: z.string().trim().nullable().optional(),
    totalTime: z.number().int().positive().max(1_440).optional(),
    prepTime: z.number().int().positive().max(1_440).optional(),
    cookTime: z.number().int().nonnegative().max(1_440).optional(),
    restTime: z.number().int().nonnegative().max(1_440).nullable().optional(),
    /** Saved manual recipes can use servings > 1; generated output stays normalized to one. */
    servings: z.number().int().positive().max(100).optional(),
    baseServings: z.literal(1).optional(),
    calories: z.number().positive().nullable().optional(),
    ingredients: z.array(ingredientSchema).min(1).max(80),
    utensils: z.array(z.string().trim().min(1)).max(30).optional(),
    guidance: editableGuidanceSchema.nullable().optional(),
    nutrition: editableNutritionSchema.optional(),
    storage: editableStorageSchema.optional(),
    tags: z.array(z.string().trim().min(1)).max(30).optional()
  })
  .strict();

const editableLevelInstructionsSchema = z
  .object({
    basic: z.array(editableStepSchema).min(1).max(30),
    intermediate: z.array(editableStepSchema).min(1).max(30),
    expert: z.array(editableStepSchema).min(1).max(30)
  })
  .strict();

const editableRecipeWithLevelsSchema = editableRecipeBaseSchema
  .extend({ instructionsByLevel: editableLevelInstructionsSchema })
  .strict();

const editableLegacyRecipeSchema = editableRecipeBaseSchema
  .extend({ steps: z.array(editableStepSchema).min(1).max(30) })
  .strict();

/**
 * The browser submits only recipe content needed for improvement. Saved IDs, ownership,
 * household/member fields, images and media URLs are intentionally outside this contract.
 */
export const editableRecipeForImprovementSchema = z.union([
  editableRecipeWithLevelsSchema,
  editableLegacyRecipeSchema
]);

export const improveRecipeRequestSchema = z
  .object({
    recipe: editableRecipeForImprovementSchema,
    scopes: z.array(recipeImproveScopeSchema).min(1).max(7)
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.scopes).size !== request.scopes.length) {
      context.addIssue({
        code: 'custom',
        path: ['scopes'],
        message: 'Improvement scopes must be unique.'
      });
    }
  });

export type EditableRecipeForImprovement = z.infer<typeof editableRecipeForImprovementSchema>;
export type ImproveRecipeRequest = z.infer<typeof improveRecipeRequestSchema>;
