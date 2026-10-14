import { z } from 'zod';
import { createAiResponseFormat } from './ai-response-format.js';
import { MEAL_TYPE_KEYS } from '../utils/taste-profile.js';

/** Límite superior conservador: 7 días × 4 turnos × 100 miembros. */
export const MEAL_PROPOSAL_LIMITS = {
  maxParticipantAliases: 100,
  maxEvents: 7 * MEAL_TYPE_KEYS.length * 100,
  maxServings: 100,
  maxIngredientsPerRecipe: 80,
  maxInstructions: 30,
  maxRecipeDefinitions: 7 * MEAL_TYPE_KEYS.length * 100
} as const;

const participantAliasSchema = z
  .string()
  .regex(/^P(?:[1-9]|[1-9]\d|100)$/, 'Use only opaque participant aliases such as P1 or P2.');
export const householdRecipeAliasSchema = z.string().regex(/^(?:R|N)[1-9]\d{0,3}$/);
export const newHouseholdRecipeAliasSchema = z.string().regex(/^N[1-9]\d{0,3}$/);

const mealTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();
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

const mealProposalIngredientSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    quantity: z.number().positive().max(1_000_000),
    unit: ingredientUnitSchema,
    preparation: z.string().trim().max(500).nullable(),
    isOptional: z.boolean(),
    substitutes: z.array(z.string().trim().min(1).max(200)).max(10),
    notes: z.string().trim().max(500).nullable()
  })
  .strict();

const mealRecipeInstructionStepSchema = z
  .object({
    stepNumber: z.number().int().positive(),
    instruction: z.string().trim().min(1).max(2_000),
    duration: z.number().int().positive().max(1_440).nullable(),
    temperature: z
      .object({ value: z.number(), unit: z.enum(['C', 'F']) })
      .strict()
      .nullable(),
    timerRequired: z.boolean(),
    timerDuration: z.number().int().positive().max(1_440).nullable(),
    tips: z.string().trim().max(500).nullable(),
    warning: z.string().trim().max(500).nullable(),
    illustration: z.null()
  })
  .strict();

const orderedRecipeStepsSchema = z
  .array(mealRecipeInstructionStepSchema)
  .min(1)
  .max(MEAL_PROPOSAL_LIMITS.maxInstructions)
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

const instructionsByLevelSchema = z
  .object({
    basic: orderedRecipeStepsSchema,
    intermediate: orderedRecipeStepsSchema,
    expert: orderedRecipeStepsSchema
  })
  .strict();

/** New recipes are canonical generated recipes, with one-serving ingredient quantities. */
export const householdMealRecipeCandidateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(1_000),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    cuisine: z.string().trim().max(50).nullable(),
    totalTime: z.number().int().positive().max(1_440),
    prepTime: z.number().int().positive().max(1_440),
    cookTime: z.number().int().nonnegative().max(1_440),
    restTime: z.number().int().nonnegative().max(1_440).nullable(),
    baseServings: z.literal(1),
    calories: z.number().positive().nullable(),
    ingredients: z
      .array(mealProposalIngredientSchema)
      .min(1)
      .max(MEAL_PROPOSAL_LIMITS.maxIngredientsPerRecipe),
    utensils: z.array(z.string().trim().min(1).max(120)).max(30),
    guidance: z
      .object({
        appliances: z.array(z.string().trim().min(1).max(120)).max(10),
        parallelTasks: z.array(z.string().trim().min(1).max(500)).max(10),
        tipsAndVariations: z.array(z.string().trim().min(1).max(500)).max(10),
        batchCookingWarning: z.string().trim().min(1).max(500).nullable()
      })
      .strict(),
    instructionsByLevel: instructionsByLevelSchema,
    nutrition: z
      .object({
        calories: z.number().nonnegative(),
        protein: z.number().nonnegative(),
        carbs: z.number().nonnegative(),
        fat: z.number().nonnegative(),
        fiber: z.number().nonnegative().nullable()
      })
      .strict()
      .nullable(),
    storage: z
      .object({
        method: z.string().trim().min(1).max(200),
        duration: z.string().trim().min(1).max(100),
        reheatingInstructions: z.string().trim().max(500).nullable(),
        container: z.string().trim().max(200).nullable(),
        freezingPossible: z.boolean(),
        freezingDuration: z.string().trim().max(100).nullable()
      })
      .strict()
      .nullable(),
    tags: z.array(z.string().trim().min(1).max(50)).max(30)
  })
  .strict();

export const mealProposalEventSchema = z
  .object({
    date: z.iso.date(),
    mealType: z.enum(MEAL_TYPE_KEYS),
    time: mealTimeSchema,
    recipeAlias: householdRecipeAliasSchema.nullable(),
    participantAliases: z
      .array(participantAliasSchema)
      .min(1)
      .max(MEAL_PROPOSAL_LIMITS.maxParticipantAliases),
    servings: z.number().int().min(0).max(MEAL_PROPOSAL_LIMITS.maxServings),
    objectiveSummary: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .describe(
        'Short, neutral culinary summary for display. Never reveal allergies, diagnoses, sensitive goals, or private member notes.'
      ),
    status: z.enum(['scheduled', 'unresolved']),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .nullable()
      .describe('Clear, neutral explanation when unresolved; null for a scheduled meal.')
  })
  .strict();

const newRecipeDefinitionSchema = z
  .object({
    alias: newHouseholdRecipeAliasSchema,
    recipe: householdMealRecipeCandidateSchema
  })
  .strict();

/** The raw provider contract; recipes are declared once and events point to opaque aliases. */
export const mealProposalObjectSchema = z
  .object({
    newRecipes: z.array(newRecipeDefinitionSchema).max(MEAL_PROPOSAL_LIMITS.maxRecipeDefinitions),
    events: z.array(mealProposalEventSchema).min(1).max(MEAL_PROPOSAL_LIMITS.maxEvents)
  })
  .strict();

export type MealProposal = z.infer<typeof mealProposalObjectSchema>;
export type MealProposalRecipeCandidate = z.infer<typeof householdMealRecipeCandidateSchema>;
export type MealProposalEvent = MealProposal['events'][number];

/** Trusted server-side catalog map entry returned to the client with the proposal. */
export interface ResolvedMealProposalRecipe {
  alias: string;
  source: 'catalog' | 'new';
  recipeId: string | null;
  recipe: Record<string, unknown>;
}

/** Validate recipe/status consistency and prevent duplicate assignment or alias definition. */
export const mealProposalSchema = mealProposalObjectSchema.superRefine((proposal, context) => {
  const assignedParticipantsByTurn = new Map<string, Set<string>>();
  const aliases = new Set<string>();
  const referencedNewRecipes = new Set<string>();

  proposal.newRecipes.forEach((definition, recipeIndex) => {
    if (aliases.has(definition.alias)) {
      context.addIssue({
        code: 'custom',
        path: ['newRecipes', recipeIndex, 'alias'],
        message: 'Recipe aliases must be unique.'
      });
    }
    aliases.add(definition.alias);
  });

  proposal.events.forEach((event, eventIndex) => {
    if (event.status === 'scheduled') {
      if (event.recipeAlias === null) {
        context.addIssue({
          code: 'custom',
          path: ['events', eventIndex, 'recipeAlias'],
          message: 'A scheduled event must reference a recipe.'
        });
      }
      if (event.servings < 1) {
        context.addIssue({
          code: 'custom',
          path: ['events', eventIndex, 'servings'],
          message: 'A scheduled event must have at least one serving.'
        });
      }
      if (event.reason !== null) {
        context.addIssue({
          code: 'custom',
          path: ['events', eventIndex, 'reason'],
          message: 'A scheduled event cannot include an unresolved reason.'
        });
      }
    } else {
      if (event.recipeAlias !== null) {
        context.addIssue({
          code: 'custom',
          path: ['events', eventIndex, 'recipeAlias'],
          message: 'An unresolved event cannot reference a recipe.'
        });
      }
      if (event.servings !== 0) {
        context.addIssue({
          code: 'custom',
          path: ['events', eventIndex, 'servings'],
          message: 'An unresolved event must have zero servings.'
        });
      }
      if (event.reason === null) {
        context.addIssue({
          code: 'custom',
          path: ['events', eventIndex, 'reason'],
          message: 'An unresolved event must explain why it needs attention.'
        });
      }
    }

    if (event.recipeAlias?.startsWith('N')) referencedNewRecipes.add(event.recipeAlias);

    const turnKey = `${event.date}:${event.mealType}`;
    let assigned = assignedParticipantsByTurn.get(turnKey);
    if (!assigned) {
      assigned = new Set<string>();
      assignedParticipantsByTurn.set(turnKey, assigned);
    }

    event.participantAliases.forEach((alias, aliasIndex) => {
      if (assigned.has(alias)) {
        context.addIssue({
          code: 'custom',
          path: ['events', eventIndex, 'participantAliases', aliasIndex],
          message: 'A participant may appear only once in the same date and meal type.'
        });
      }
      assigned.add(alias);
    });
  });

  for (const alias of referencedNewRecipes) {
    if (!aliases.has(alias)) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'Every new-recipe alias must have exactly one recipe definition.'
      });
    }
  }
  for (const alias of aliases) {
    if (!referencedNewRecipes.has(alias)) {
      context.addIssue({
        code: 'custom',
        path: ['newRecipes'],
        message: 'Unused new recipes are not allowed.'
      });
    }
  }
});

export function createMealProposalResponseFormat() {
  const responseFormat = createAiResponseFormat('weekly_meal_proposal', mealProposalObjectSchema);
  const schema = responseFormat.json_schema.schema as {
    properties: {
      events: {
        items: { properties: { date: Record<string, unknown> } };
      };
    };
  };
  // WebAPI rejects JSON Schema's `format` keyword. Keep the exact calendar-date pattern locally.
  delete schema.properties.events.items.properties.date.format;
  return responseFormat;
}
