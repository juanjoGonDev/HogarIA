import { describe, expect, it } from 'vitest';
import { RECIPE_RESPONSE_FORMAT } from './ai-generated-output.schema.js';
import { createMealProposalResponseFormat } from './household-meal-proposal.schema.js';
import { generatedRecipeCandidateSchema } from './generated-recipe.schema.js';
import { householdMealRecipeCandidateSchema } from './household-meal-proposal.schema.js';

describe('shared AI recipe output contract', () => {
  it('uses one Zod schema for standalone recipes and new recipes in weekly plans', () => {
    expect(householdMealRecipeCandidateSchema).toBe(generatedRecipeCandidateSchema);
  });

  it('emits the exact same strict recipe JSON Schema in both provider requests', () => {
    const recipeFormat = RECIPE_RESPONSE_FORMAT.json_schema.schema;
    const proposalFormat = createMealProposalResponseFormat().json_schema.schema as {
      properties: {
        newRecipes: {
          items: {
            properties: { recipe: Record<string, unknown> };
          };
        };
      };
    };

    expect(proposalFormat.properties.newRecipes.items.properties.recipe).toEqual(recipeFormat);
  });

  it('does not publish arbitrary maxLength caps for recipe text in strict provider schemas', () => {
    expect(JSON.stringify(RECIPE_RESPONSE_FORMAT.json_schema.schema)).not.toContain('"maxLength"');
    const weeklySchema = createMealProposalResponseFormat().json_schema.schema as {
      properties: { newRecipes: { items: { properties: { recipe: unknown } } } };
    };
    const weeklyRecipeSchema = weeklySchema.properties.newRecipes.items.properties.recipe;
    expect(JSON.stringify(weeklyRecipeSchema)).not.toContain('"maxLength"');
  });
});
