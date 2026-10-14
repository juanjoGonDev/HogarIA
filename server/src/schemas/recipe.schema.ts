import { z } from 'zod';
import { formDefault, formField, formPartial } from './form.js';

const difficultyEnum = z.enum(['easy', 'medium', 'hard']);
const mealTypeEnum = z.enum(['breakfast', 'brunch', 'lunch', 'snack', 'dinner', 'dessert']);
const countryCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'Country code must use ISO 3166-1 alpha-2')
  .transform((value) => value.toUpperCase());
const measurementUnitEnum = z.enum([
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

const recipeIngredientSchema = z.object({
  ingredientId: formField(z.string()),
  name: z.string().min(1),
  quantity: z.number().positive(),
  unit: measurementUnitEnum,
  preparation: formField(z.string()),
  isOptional: formDefault(z.boolean(), false),
  substitutes: formDefault(z.array(z.string()), []),
  notes: formField(z.string())
});

const temperatureSchema = z.object({
  value: z.number(),
  unit: z.enum(['C', 'F'])
});

const httpsMediaUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Media URLs must use HTTPS and must not contain credentials');

const recipeImageReferenceSchema = z.union([
  httpsMediaUrlSchema,
  z.string().regex(/^\/api\/recipe-images\/[a-f0-9]{24}$/, 'Invalid local recipe image reference')
]);

export const recipeStepIllustrationSchema = z
  .object({
    url: httpsMediaUrlSchema,
    altText: z.string().trim().min(1).max(250),
    sourceLabel: formField(z.string().trim().max(150)),
    sourceUrl: formField(httpsMediaUrlSchema)
  })
  .strict();

const recipeStepSchema = z
  .object({
    stepNumber: z.number().int().positive(),
    instruction: z.string().min(1),
    duration: formField(z.number().int().positive()),
    temperature: formField(temperatureSchema),
    timerRequired: formDefault(z.boolean(), false),
    timerDuration: formField(z.number().int().positive()),
    tips: formField(z.string()),
    warning: formField(z.string()),
    image: formField(recipeImageReferenceSchema),
    /** Candidate returned by the bounded photo search; the route replaces it with a local asset path. */
    imagePhotoId: formField(z.string().regex(/^[a-f0-9]{24}$/)),
    /** A server-resolved Commons selection id; source URLs and attribution are never client-authored. */
    videoId: formField(z.string().regex(/^[a-f0-9]{24}$/)),
    illustration: formField(recipeStepIllustrationSchema)
  })
  .superRefine((step, context) => {
    if (step.imagePhotoId && step.image !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['imagePhotoId'],
        message: 'Choose a searched step photo or provide an image URL, not both'
      });
    }
  });

const nutritionInfoSchema = z.object({
  calories: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  fiber: formField(z.number()),
  sugar: formField(z.number()),
  sodium: formField(z.number())
});

const storageInfoSchema = z.object({
  method: z.string(),
  container: formField(z.string()),
  duration: z.string(),
  reheatingInstructions: formField(z.string()),
  freezingPossible: formDefault(z.boolean(), false),
  freezingDuration: formField(z.string())
});

const recipeGuidanceSchema = z
  .object({
    appliances: z.array(z.string().trim().min(1)).max(10),
    parallelTasks: z.array(z.string().trim().min(1)).max(10),
    tipsAndVariations: z.array(z.string().trim().min(1)).max(10),
    /** Optional for older saved guidance JSON; generated recipes always provide the explicit decision. */
    batchCookingWarning: formField(z.string().trim().min(1))
  })
  .strict();

const instructionsByLevelSchema = z
  .object({
    basic: z.array(recipeStepSchema).min(1),
    intermediate: z.array(recipeStepSchema).min(1),
    expert: z.array(recipeStepSchema).min(1)
  })
  .strict();

const createRecipeFieldsSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: formField(z.string()),
  difficulty: formDefault(difficultyEnum, 'medium'),
  cuisine: formField(z.string()),
  countryCode: formField(countryCodeSchema),
  mealType: formDefault(z.array(mealTypeEnum), []),
  totalTime: formField(z.number().int().positive()),
  prepTime: formField(z.number().int().positive()),
  cookTime: formField(z.number().int().nonnegative()),
  restTime: formField(z.number().int().nonnegative()),
  servings: formDefault(z.number().int().positive(), 2),
  calories: formField(z.number().positive()),
  image: formField(recipeImageReferenceSchema),
  ingredients: z.array(recipeIngredientSchema).min(1, 'At least one ingredient is required'),
  utensils: formDefault(z.array(z.string()), []),
  steps: formField(z.array(recipeStepSchema).min(1, 'At least one step is required')),
  instructionsByLevel: formField(instructionsByLevelSchema),
  nutrition: formField(nutritionInfoSchema),
  storage: formField(storageInfoSchema),
  guidance: formField(recipeGuidanceSchema),
  tags: formDefault(z.array(z.string()), []),
  isPublic: formDefault(z.boolean(), false)
});

// A recipe stores either its historical flat `steps` list or all generated variants, never both.
export const createRecipeSchema = createRecipeFieldsSchema
  .extend({
    // The origin is informational; ownership remains the authenticated author_id.
    // Editorial catalog rows can only be created by the seed/import path.
    author: formDefault(z.enum(['ai', 'user']), 'user')
  })
  .superRefine((recipe, context) => {
    const hasLegacySteps = Array.isArray(recipe.steps);
    const hasInstructionLevels = recipe.instructionsByLevel != null;

    if (hasLegacySteps === hasInstructionLevels) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Provide either legacy steps or all detail-level instructions, but not both'
      });
    }
  });

// Update recipe schema
export const updateRecipeSchema = formPartial(createRecipeFieldsSchema)
  .extend({
    isFavorite: formField(z.boolean()),
    /** A short-lived candidate id; the server resolves, validates and stores the raster bytes. */
    imagePhotoId: formField(z.string().regex(/^[a-f0-9]{24}$/))
  })
  .superRefine((recipe, context) => {
    if (recipe.imagePhotoId && recipe.image !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['imagePhotoId'],
        message: 'Choose a searched image or provide a URL, not both'
      });
    }
    if (recipe.ingredients === null) {
      context.addIssue({
        code: 'custom',
        path: ['ingredients'],
        message: 'A recipe must keep at least one ingredient'
      });
    }

    if (recipe.steps === null || recipe.instructionsByLevel === null) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'A recipe must keep one instruction representation'
      });
    }

    if (recipe.steps !== undefined && recipe.instructionsByLevel !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'Provide either legacy steps or all detail-level instructions, but not both'
      });
    }
  });

// Recipe filter schema
export const recipeFilterSchema = z.object({
  search: formField(z.string()),
  difficulty: formField(difficultyEnum),
  mealType: formField(mealTypeEnum),
  maxTime: formField(z.number().int().positive()),
  cuisine: formField(z.string()),
  countryCode: formField(countryCodeSchema),
  // `mealType` remains as a backwards-compatible single-value filter.
  mealTypes: formField(z.array(mealTypeEnum).min(1)),
  tags: formField(z.array(z.string())),
  isFavorite: formField(z.boolean()),
  author: formField(z.enum(['ai', 'user'])),
  catalogOnly: formField(z.boolean()),
  page: formDefault(z.number().int().positive(), 1),
  pageSize: formDefault(z.number().int().positive().max(100), 20),
  sortBy: formDefault(
    z.enum(['name', 'difficulty', 'totalTime', 'rating', 'createdAt']),
    'createdAt'
  ),
  sortOrder: formDefault(z.enum(['asc', 'desc']), 'desc')
});

// Adjust servings schema
export const adjustServingsSchema = z.object({
  servings: z.number().int().positive().safe()
});

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
export type RecipeFilterInput = z.infer<typeof recipeFilterSchema>;
export type AdjustServingsInput = z.infer<typeof adjustServingsSchema>;
