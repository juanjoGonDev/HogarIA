import { z } from 'zod';
import {
  householdRecipeAliasSchema,
  MEAL_PROPOSAL_LIMITS,
  mealProposalEventSchema
} from './household-meal-proposal.schema.js';

export const HOUSEHOLD_MEAL_PROPOSAL_MAX_MEMBERS = 100;

export const householdMealProposalRequestSchema = z
  .object({
    weekStart: z.iso.date(),
    householdMemberIds: z
      .array(z.string().trim().min(1).max(128))
      .min(1)
      .max(HOUSEHOLD_MEAL_PROPOSAL_MAX_MEMBERS)
  })
  .strict()
  .superRefine((value, context) => {
    const [year, month, day] = value.weekStart.split('-').map(Number);
    if (new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay() !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['weekStart'],
        message: 'La semana debe empezar en lunes.'
      });
    }
    if (new Set(value.householdMemberIds).size !== value.householdMemberIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['householdMemberIds'],
        message: 'No se puede seleccionar dos veces a la misma persona.'
      });
    }
  });

export type HouseholdMealProposalRequest = z.infer<typeof householdMealProposalRequestSchema>;

const proposalEventSubmissionSchema = mealProposalEventSchema.extend({
  // The preview echoes these IDs for rendering only. Confirmation ignores them and resolves aliases again.
  participantIds: z
    .array(z.string().trim().min(1).max(128))
    .max(HOUSEHOLD_MEAL_PROPOSAL_MAX_MEMBERS)
    .optional(),
  id: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((value) => !value.includes(':'), 'El identificador no puede incluir dos puntos.')
});

const proposalRecipeDefinitionSubmissionSchema = z
  .object({
    alias: householdRecipeAliasSchema,
    source: z.enum(['catalog', 'new']),
    recipeId: z.string().trim().min(1).max(128).nullable(),
    recipe: z.record(z.string(), z.unknown())
  })
  .strict();

export const householdMealProposalConfirmRequestSchema = z
  .object({
    proposalId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !value.includes(':')),
    weekStart: z.iso.date(),
    householdMemberIds: z
      .array(z.string().trim().min(1).max(128))
      .min(1)
      .max(HOUSEHOLD_MEAL_PROPOSAL_MAX_MEMBERS),
    recipes: z
      .array(proposalRecipeDefinitionSubmissionSchema)
      .max(MEAL_PROPOSAL_LIMITS.maxRecipeDefinitions),
    // Alias-to-membership resolution is always repeated server-side; echoed participantIds are untrusted.
    events: z.array(proposalEventSubmissionSchema).min(1).max(MEAL_PROPOSAL_LIMITS.maxEvents)
  })
  .strict()
  .superRefine((value, context) => {
    const [year, month, day] = value.weekStart.split('-').map(Number);
    if (new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay() !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['weekStart'],
        message: 'La semana debe empezar en lunes.'
      });
    }
    if (new Set(value.householdMemberIds).size !== value.householdMemberIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['householdMemberIds'],
        message: 'No se puede seleccionar dos veces a la misma persona.'
      });
    }
    const eventIds = value.events.map(({ id }) => id);
    if (new Set(eventIds).size !== eventIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'Los eventos no pueden repetirse.'
      });
    }
    const recipeAliases = value.recipes.map(({ alias }) => alias);
    if (new Set(recipeAliases).size !== recipeAliases.length) {
      context.addIssue({
        code: 'custom',
        path: ['recipes'],
        message: 'Las recetas no pueden repetir alias.'
      });
    }
    const recipesByAlias = new Map(value.recipes.map((recipe) => [recipe.alias, recipe]));
    const usedAliases = new Set<string>();
    value.events.forEach((event, eventIndex) => {
      if (event.status === 'unresolved') return;
      const alias = event.recipeAlias;
      if (!alias) return;
      const recipe = recipesByAlias.get(alias);
      if (!recipe) {
        context.addIssue({
          code: 'custom',
          path: ['events', eventIndex, 'recipeAlias'],
          message: 'Cada plato planificado debe referenciar una receta incluida.'
        });
        return;
      }
      usedAliases.add(alias);
      const isNew = alias.startsWith('N');
      if (
        (isNew && (recipe.source !== 'new' || recipe.recipeId !== null)) ||
        (!isNew && (recipe.source !== 'catalog' || recipe.recipeId === null))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['recipes'],
          message: 'El origen y el identificador de la receta no coinciden con su alias.'
        });
      }
    });
    value.recipes.forEach((recipe, recipeIndex) => {
      if (!usedAliases.has(recipe.alias)) {
        context.addIssue({
          code: 'custom',
          path: ['recipes', recipeIndex],
          message: 'No se permiten recetas sin un evento planificado.'
        });
      }
    });
  });

export type HouseholdMealProposalConfirmRequest = z.infer<
  typeof householdMealProposalConfirmRequestSchema
>;
