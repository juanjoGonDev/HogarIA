import { describe, expect, it } from 'vitest';
import {
  createHouseholdRecipeCatalogFilePart,
  HOUSEHOLD_RECIPE_CATALOG_FILENAME,
  HouseholdRecipeCatalogAttachmentError
} from './household-meal-recipe-catalog-attachment.js';

const recipe = {
  alias: 'R1',
  name: 'Tortilla de patata',
  description: 'Tortilla jugosa.',
  baseServings: 4,
  difficulty: 'medium',
  cuisine: 'española',
  totalTime: 35,
  prepTime: 15,
  cookTime: 20,
  restTime: null,
  calories: 310,
  ingredients: [
    {
      name: 'patata',
      quantity: 600,
      unit: 'g',
      preparation: 'pelada',
      isOptional: false,
      substitutes: [],
      notes: null
    }
  ],
  utensils: ['sartén'],
  guidance: {
    appliances: ['cocina de gas'],
    parallelTasks: [],
    tipsAndVariations: ['Dejar reposar antes de cortar.'],
    batchCookingWarning: null
  },
  instructionsByLevel: {
    basic: [
      {
        stepNumber: 1,
        instruction: 'Pela y corta la patata.',
        duration: null,
        temperature: null,
        timerRequired: false,
        timerDuration: null,
        tips: null,
        warning: null,
        illustration: null
      }
    ],
    intermediate: [
      {
        stepNumber: 1,
        instruction: 'Corta la patata en láminas.',
        duration: null,
        temperature: null,
        timerRequired: false,
        timerDuration: null,
        tips: null,
        warning: null,
        illustration: null
      }
    ],
    expert: [
      {
        stepNumber: 1,
        instruction: 'Laminar la patata uniformemente.',
        duration: null,
        temperature: null,
        timerRequired: false,
        timerDuration: null,
        tips: null,
        warning: null,
        illustration: null
      }
    ]
  },
  nutrition: null,
  storage: null,
  tags: ['vegetariana']
};
const catalogEntry = { alias: 'R1', selectable: true, recipe };

function decoded(part: ReturnType<typeof createHouseholdRecipeCatalogFilePart>) {
  const base64 = part.file.file_data.slice('data:application/json;base64,'.length);
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as Record<string, unknown>;
}

describe('household recipe catalog attachment', () => {
  it('encodes complete recipe content with opaque aliases and no internal identity fields', () => {
    const part = createHouseholdRecipeCatalogFilePart({ recipes: [catalogEntry] });

    expect(part.file.filename).toBe(HOUSEHOLD_RECIPE_CATALOG_FILENAME);
    expect(part.file.file_data.startsWith('data:application/json;base64,')).toBe(true);
    expect(decoded(part)).toEqual({ version: 1, recipes: [catalogEntry] });
    expect(part.file.file_data).not.toContain('recipe-row-id');
    expect(part.file.file_data).not.toContain('owner@example.test');
  });

  it('fails before producing an attachment when the complete catalog exceeds the byte cap', () => {
    expect(() =>
      createHouseholdRecipeCatalogFilePart({
        recipes: [
          { ...catalogEntry, recipe: { ...recipe, description: 'x'.repeat(2 * 1024 * 1024) } }
        ]
      })
    ).toThrowError(HouseholdRecipeCatalogAttachmentError);
  });
});
