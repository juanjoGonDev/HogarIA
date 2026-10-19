import { describe, expect, it } from 'vitest';
import { aiRecipeOutputSchema } from '../schemas/recipe-ai-output.schema.js';
import {
  createHouseholdMealRecipeId,
  createHouseholdMealRecipeSnapshot
} from './household-meal-recipe-snapshot.js';

const step = {
  stepNumber: 1,
  instruction: 'Cocer hasta que esté tierno.',
  duration: 20,
  temperature: { value: 95, unit: 'C' },
  timerRequired: true,
  timerDuration: 20,
  tips: 'Mantén el hervor suave.',
  warning: null,
  illustration: null
};

describe('household meal recipe snapshot', () => {
  it('projects full recipe details with ingredient quantities expressed per serving', () => {
    const source = {
      name: 'Arroz con verduras',
      description: 'Plato para compartir.',
      difficulty: 'medium',
      cuisine: 'española',
      totalTime: 30,
      prepTime: 10,
      cookTime: 20,
      restTime: null,
      baseServings: 2,
      calories: 350,
      ingredients: [
        {
          name: 'arroz',
          quantity: 160,
          unit: 'g',
          preparation: null,
          isOptional: false,
          substitutes: [],
          notes: null
        }
      ],
      utensils: ['olla'],
      guidance: {
        appliances: ['vitrocerámica'],
        parallelTasks: ['Lavar las verduras.'],
        tipsAndVariations: ['Añade perejil al servir.'],
        batchCookingWarning: null
      },
      instructionsByLevel: {
        basic: [{ ...step, instruction: 'Cocer el arroz.' }],
        intermediate: [{ ...step, instruction: 'Sofreír y cocer el arroz.' }],
        expert: [{ ...step, instruction: 'Controlar la hidratación del grano.' }]
      },
      nutrition: { calories: 350, protein: 8, carbs: 65, fat: 7, fiber: 3 },
      storage: {
        method: 'Refrigerar',
        duration: '3 días',
        reheatingInstructions: 'Calentar completamente.',
        container: 'Recipiente cerrado',
        freezingPossible: true,
        freezingDuration: '2 meses'
      },
      tags: ['almuerzo']
    };

    const snapshot = createHouseholdMealRecipeSnapshot(source);

    expect(snapshot).toMatchObject({
      name: 'Arroz con verduras',
      baseServings: 1,
      ingredients: [{ name: 'arroz', quantity: 80, unit: 'g' }],
      guidance: source.guidance,
      instructionsByLevel: {
        basic: [{ instruction: 'Cocer el arroz.' }],
        intermediate: [{ instruction: 'Sofreír y cocer el arroz.' }],
        expert: [{ instruction: 'Controlar la hidratación del grano.' }]
      },
      storage: source.storage
    });
    expect(source.ingredients[0]?.quantity).toBe(160);
  });

  it('fills missing skill levels from legacy flat steps for saved catalog recipes', () => {
    const snapshot = createHouseholdMealRecipeSnapshot({
      name: 'Sopa',
      baseServings: 4,
      ingredients: [{ name: 'agua', quantity: 1, unit: 'l' }],
      steps: [{ stepNumber: 1, instruction: 'Calentar el agua.' }],
      guidance: { appliances: ['cocina'], extraLegacyField: 'ignored' },
      storage: { method: 'Frío', reheating: 'No aplica' }
    });

    expect(snapshot).toMatchObject({
      ingredients: [{ quantity: 0.25 }],
      instructionsByLevel: {
        basic: [{ stepNumber: 1, instruction: 'Calentar el agua.', illustration: null }],
        intermediate: [{ stepNumber: 1, instruction: 'Calentar el agua.', illustration: null }],
        expert: [{ stepNumber: 1, instruction: 'Calentar el agua.', illustration: null }]
      },
      guidance: {
        appliances: ['cocina'],
        parallelTasks: [],
        tipsAndVariations: [],
        batchCookingWarning: null
      },
      storage: {
        method: 'Frío',
        duration: '',
        reheatingInstructions: 'No aplica',
        container: null,
        freezingPossible: false,
        freezingDuration: null
      }
    });
  });

  it('projects legacy catalog nutrition into the canonical AI recipe shape', () => {
    const snapshot = createHouseholdMealRecipeSnapshot({
      name: 'Arroz con verduras',
      description: 'Plato sintético.',
      difficulty: 'medium',
      cuisine: 'española',
      totalTime: 30,
      prepTime: 10,
      cookTime: 20,
      restTime: null,
      baseServings: 1,
      calories: 350,
      ingredients: [{ name: 'arroz', quantity: 80, unit: 'g' }],
      utensils: ['olla'],
      guidance: {
        appliances: [],
        parallelTasks: [],
        tipsAndVariations: [],
        batchCookingWarning: null
      },
      instructionsByLevel: {
        basic: [{ ...step, temperature: null }],
        intermediate: [{ ...step, temperature: null }],
        expert: [{ ...step, temperature: null }]
      },
      nutrition: {
        calories: 350,
        protein: 8,
        carbs: 65,
        fat: 7,
        fiber: 3,
        sugar: 2,
        sodium: 120
      },
      storage: null,
      tags: ['almuerzo']
    });

    expect(snapshot.nutrition).toEqual({
      calories: 350,
      protein: 8,
      carbs: 65,
      fat: 7,
      fiber: 3
    });
    expect(aiRecipeOutputSchema.safeParse(snapshot).success).toBe(true);
  });

  it('creates a deterministic opaque private-recipe ID from proposal and alias', () => {
    const first = createHouseholdMealRecipeId('proposal-123', 'N1');
    expect(first).toMatch(/^ai_[a-f0-9]{32}$/);
    expect(createHouseholdMealRecipeId('proposal-123', 'N1')).toBe(first);
    expect(createHouseholdMealRecipeId('proposal-123', 'N2')).not.toBe(first);
    expect(createHouseholdMealRecipeId('proposal-456', 'N1')).not.toBe(first);
  });
});
