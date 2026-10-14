import { describe, expect, it } from 'vitest';
import { improveRecipeRequestSchema } from './recipe-improvement.schema.js';

describe('improveRecipeRequestSchema text boundaries', () => {
  it('accepts existing recipe text beyond the former character limits', () => {
    const longText = 'x'.repeat(2_501);
    const step = { stepNumber: 1, instruction: longText, tips: longText, warning: longText };
    const result = improveRecipeRequestSchema.safeParse({
      recipe: {
        name: longText,
        description: longText,
        difficulty: 'easy',
        cuisine: longText,
        ingredients: [
          {
            name: longText,
            quantity: 1,
            unit: 'g',
            preparation: longText,
            isOptional: false,
            substitutes: [longText],
            notes: longText
          }
        ],
        utensils: [longText],
        guidance: {
          appliances: [longText],
          parallelTasks: [longText],
          tipsAndVariations: [longText],
          batchCookingWarning: longText
        },
        nutrition: null,
        storage: {
          method: longText,
          duration: longText,
          reheatingInstructions: longText,
          container: longText,
          freezingPossible: true,
          freezingDuration: longText
        },
        tags: [longText],
        instructionsByLevel: {
          basic: [step],
          intermediate: [step],
          expert: [step]
        }
      },
      scopes: ['details', 'ingredients', 'preparation', 'guidance', 'storage']
    });

    expect(result.success).toBe(true);
  });

  it('still rejects repeated improvement scopes', () => {
    const result = improveRecipeRequestSchema.safeParse({
      recipe: {
        name: 'Receta',
        difficulty: 'easy',
        ingredients: [{ name: 'Ingrediente', quantity: 1, unit: 'g' }],
        instructionsByLevel: {
          basic: [{ stepNumber: 1, instruction: 'Preparar.' }],
          intermediate: [{ stepNumber: 1, instruction: 'Preparar.' }],
          expert: [{ stepNumber: 1, instruction: 'Preparar.' }]
        }
      },
      scopes: ['details', 'details']
    });

    expect(result.success).toBe(false);
  });
});
