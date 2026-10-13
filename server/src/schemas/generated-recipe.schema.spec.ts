import { describe, expect, it } from 'vitest';
import { generatedRecipeCandidateSchema } from './generated-recipe.schema.js';

const validCandidate = {
  name: 'Crema de zanahoria',
  description: 'Crema suave para dos personas.',
  difficulty: 'easy',
  cuisine: 'Mediterránea',
  totalTime: 20,
  prepTime: 5,
  cookTime: 15,
  restTime: null,
  servings: 2,
  calories: 180,
  ingredients: [
    {
      name: 'zanahoria',
      quantity: 2,
      unit: 'unit',
      preparation: null,
      isOptional: false,
      substitutes: ['calabacín'],
      notes: null
    }
  ],
  utensils: ['olla'],
  instructionsByLevel: {
    basic: [
      {
        stepNumber: 1,
        instruction: 'Cocer la zanahoria.',
        duration: null,
        tips: null,
        warning: null,
        illustration: null
      }
    ],
    intermediate: [
      {
        stepNumber: 1,
        instruction: 'Cortar la zanahoria y cocerla hasta que esté tierna.',
        duration: null,
        tips: null,
        warning: null,
        illustration: null
      }
    ],
    expert: [
      {
        stepNumber: 1,
        instruction: 'Cortar dados uniformes y cocer a hervor suave hasta textura tierna.',
        duration: null,
        tips: null,
        warning: null,
        illustration: null
      }
    ]
  },
  guidance: {
    appliances: ['Cocina de gas'],
    parallelTasks: ['Mientras hierve el agua, lava y corta las verduras.'],
    tipsAndVariations: ['Añade limón al final para realzar el sabor.'],
    batchCookingWarning: null
  },
  nutrition: { calories: 180, protein: 2, carbs: 20, fat: 5, fiber: 4 },
  storage: {
    method: 'Refrigerada',
    duration: '2 días',
    reheating: 'Calentar',
    container: null,
    freezingPossible: false,
    freezingDuration: null
  },
  tags: ['vegetariana']
};

describe('generatedRecipeCandidateSchema', () => {
  it('acepta una receta completa con los tres niveles de instrucciones', () => {
    expect(generatedRecipeCandidateSchema.parse(validCandidate)).toMatchObject(validCandidate);
  });

  it('exige orientación de cocina con aparatos, tareas paralelas y variaciones', () => {
    expect(
      generatedRecipeCandidateSchema.safeParse({ ...validCandidate, guidance: undefined }).success
    ).toBe(false);
    expect(
      generatedRecipeCandidateSchema.safeParse({
        ...validCandidate,
        guidance: { ...validCandidate.guidance, appliances: ['freidora de aceite'] }
      }).success
    ).toBe(true);
  });

  it('requires an explicit nullable batch-cooking decision with bounded text', () => {
    const { batchCookingWarning: _warning, ...guidanceWithoutWarning } = validCandidate.guidance;
    expect(
      generatedRecipeCandidateSchema.safeParse({
        ...validCandidate,
        guidance: guidanceWithoutWarning
      }).success
    ).toBe(false);
    expect(
      generatedRecipeCandidateSchema.safeParse({
        ...validCandidate,
        guidance: { ...validCandidate.guidance, batchCookingWarning: '' }
      }).success
    ).toBe(false);
    expect(
      generatedRecipeCandidateSchema.safeParse({
        ...validCandidate,
        guidance: { ...validCandidate.guidance, batchCookingWarning: 't'.repeat(501) }
      }).success
    ).toBe(false);
    expect(
      generatedRecipeCandidateSchema.parse({
        ...validCandidate,
        guidance: {
          ...validCandidate.guidance,
          batchCookingWarning: 'Dora en tandas pequeñas.'
        }
      }).guidance.batchCookingWarning
    ).toBe('Dora en tandas pequeñas.');
  });

  it('exige illustration null y rechaza recursos visuales devueltos por el modelo', () => {
    const withImageUrl = {
      ...validCandidate,
      instructionsByLevel: {
        ...validCandidate.instructionsByLevel,
        basic: [
          {
            ...validCandidate.instructionsByLevel.basic[0],
            illustration: {
              url: 'https://images.example.test/step.svg',
              altText: 'Verduras recién lavadas sobre una tabla.',
              sourceLabel: 'Ilustración generada',
              sourceUrl: null
            }
          }
        ]
      }
    };

    expect(generatedRecipeCandidateSchema.safeParse(validCandidate).success).toBe(true);
    expect(generatedRecipeCandidateSchema.safeParse(withImageUrl).success).toBe(false);
    expect(
      generatedRecipeCandidateSchema.safeParse({
        ...validCandidate,
        instructionsByLevel: {
          ...validCandidate.instructionsByLevel,
          basic: [
            {
              ...validCandidate.instructionsByLevel.basic[0],
              illustration: 'https://images.example.test/step.svg'
            }
          ]
        }
      }).success
    ).toBe(false);
    expect(
      generatedRecipeCandidateSchema.safeParse({
        ...validCandidate,
        instructionsByLevel: {
          ...validCandidate.instructionsByLevel,
          basic: [
            {
              stepNumber: 1,
              instruction: 'Cocer la zanahoria.',
              duration: null,
              tips: null,
              warning: null
            }
          ]
        }
      }).success
    ).toBe(false);
  });

  it('rechaza niveles ausentes, listas vacías y pasos desordenados', () => {
    expect(
      generatedRecipeCandidateSchema.safeParse({
        ...validCandidate,
        instructionsByLevel: { basic: validCandidate.instructionsByLevel.basic }
      }).success
    ).toBe(false);
    expect(
      generatedRecipeCandidateSchema.safeParse({
        ...validCandidate,
        instructionsByLevel: {
          ...validCandidate.instructionsByLevel,
          expert: []
        }
      }).success
    ).toBe(false);
    expect(
      generatedRecipeCandidateSchema.safeParse({
        ...validCandidate,
        instructionsByLevel: {
          ...validCandidate.instructionsByLevel,
          intermediate: [
            {
              stepNumber: 2,
              instruction: 'Segundo paso.',
              duration: null,
              tips: null,
              warning: null,
              illustration: null
            },
            {
              stepNumber: 1,
              instruction: 'Primer paso.',
              duration: null,
              tips: null,
              warning: null,
              illustration: null
            }
          ]
        }
      }).success
    ).toBe(false);
  });

  it('rechaza una lista duplicada de pasos o niveles no admitidos', () => {
    expect(
      generatedRecipeCandidateSchema.safeParse({
        ...validCandidate,
        steps: validCandidate.instructionsByLevel.basic
      }).success
    ).toBe(false);
    expect(
      generatedRecipeCandidateSchema.safeParse({
        ...validCandidate,
        instructionsByLevel: {
          ...validCandidate.instructionsByLevel,
          novice: validCandidate.instructionsByLevel.basic
        }
      }).success
    ).toBe(false);
  });
});
