import { z } from 'zod';
import { createAiResponseFormat } from './ai-response-format.js';
import { AI_RECIPE_OUTPUT_LIMITS, aiRecipeOutputSchema } from './recipe-ai-output.schema.js';
import { MEAL_TYPE_KEYS } from '../utils/taste-profile.js';

/** Límite superior conservador: 7 días × 4 turnos × 100 miembros. */
export const MEAL_PROPOSAL_LIMITS = {
  maxParticipantAliases: 100,
  maxEvents: 7 * MEAL_TYPE_KEYS.length * 100,
  maxServings: 100,
  maxIngredientsPerRecipe: AI_RECIPE_OUTPUT_LIMITS.maxIngredients,
  maxInstructions: AI_RECIPE_OUTPUT_LIMITS.maxInstructionsPerLevel,
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
/** New recipes in the wrapper reuse the exact output contract used by recipe generation. */
export const householdMealRecipeCandidateSchema = aiRecipeOutputSchema;

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
