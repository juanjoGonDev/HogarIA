import { z } from 'zod';
import { createAiResponseFormat } from './ai-response-format.js';
import { MEAL_TYPE_KEYS } from '../utils/taste-profile.js';

/**
 * Límite superior conservador para una semana: 7 días × 4 turnos × 100 miembros.
 * Un turno puede dividirse en recetas distintas, pero un miembro solo puede aparecer
 * en uno de sus eventos.
 */
export const MEAL_PROPOSAL_LIMITS = {
  maxParticipantAliases: 100,
  maxEvents: 7 * MEAL_TYPE_KEYS.length * 100,
  maxServings: 100,
  maxIngredientsPerRecipe: 80,
  maxInstructions: 30
} as const;

const participantAliasSchema = z
  .string()
  .regex(/^P(?:[1-9]|[1-9]\d|100)$/, 'Use only opaque participant aliases such as P1 or P2.');
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
    preparation: z.string().trim().max(200).nullable(),
    isOptional: z.boolean(),
    notes: z.string().trim().max(300).nullable()
  })
  .strict();

const mealProposalRecipeSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(1_000),
    /** All ingredient quantities are expressed for this fixed one-serving base. */
    baseServings: z.literal(1),
    prepTimeMinutes: z.number().int().min(0).max(1_440),
    cookTimeMinutes: z.number().int().min(0).max(1_440),
    ingredients: z
      .array(mealProposalIngredientSchema)
      .min(1)
      .max(MEAL_PROPOSAL_LIMITS.maxIngredientsPerRecipe),
    instructions: z
      .array(z.string().trim().min(1).max(500))
      .min(1)
      .max(MEAL_PROPOSAL_LIMITS.maxInstructions)
  })
  .strict();

export const mealProposalEventSchema = z
  .object({
    date: z.iso.date(),
    mealType: z.enum(MEAL_TYPE_KEYS),
    time: mealTimeSchema,
    recipe: mealProposalRecipeSchema.nullable(),
    participantAliases: z
      .array(participantAliasSchema)
      .min(1)
      .max(MEAL_PROPOSAL_LIMITS.maxParticipantAliases),
    /** Zero only represents an unresolved event; scheduled meals need at least one serving. */
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

/** Structural contract sent to Structured Outputs; cross-event rules are checked locally below. */
export const mealProposalObjectSchema = z
  .object({
    events: z.array(mealProposalEventSchema).min(1).max(MEAL_PROPOSAL_LIMITS.maxEvents)
  })
  .strict();

export type MealProposal = z.infer<typeof mealProposalObjectSchema>;

/** Validate status/recipe consistency and prevent assigning one participant twice in the same turn. */
export const mealProposalSchema = mealProposalObjectSchema.superRefine((proposal, context) => {
  const assignedParticipantsByTurn = new Map<string, Set<string>>();

  proposal.events.forEach((event, eventIndex) => {
    if (event.status === 'scheduled') {
      if (event.recipe === null) {
        context.addIssue({
          code: 'custom',
          path: ['events', eventIndex, 'recipe'],
          message: 'A scheduled event must include a recipe.'
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
      if (event.recipe !== null) {
        context.addIssue({
          code: 'custom',
          path: ['events', eventIndex, 'recipe'],
          message: 'An unresolved event cannot include a recipe candidate.'
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
  // WebAPI rejects JSON Schema's `format` keyword. z.iso.date() also emits an exact calendar
  // date pattern; keep that provider constraint and continue full local Zod date validation.
  delete schema.properties.events.items.properties.date.format;
  return responseFormat;
}
