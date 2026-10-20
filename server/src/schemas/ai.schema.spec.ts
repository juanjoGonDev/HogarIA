import { describe, expect, it } from 'vitest';
import {
  createAiConfigSchema,
  generateRecipeSchema,
  mealReplacementCandidateSchema,
  replaceMealSchema,
  AI_CONFIG_DEFAULT_MAX_TOKENS,
  AI_CONFIG_MAX_TIMEOUT_MS,
  testConnectionSchema
} from './ai.schema.js';

const config = (timeout: number) => ({
  name: 'Prueba IA',
  baseUrl: 'https://example.test/v1',
  apiKey: 'synthetic-key',
  model: 'gpt-5',
  timeout
});

describe('createAiConfigSchema timeout', () => {
  it('shares the ten-minute ceiling between saved configs and connection tests', () => {
    expect(AI_CONFIG_MAX_TIMEOUT_MS).toBe(600_000);
    expect(createAiConfigSchema.safeParse(config(AI_CONFIG_MAX_TIMEOUT_MS)).success).toBe(true);
    expect(createAiConfigSchema.safeParse(config(AI_CONFIG_MAX_TIMEOUT_MS + 1)).success).toBe(
      false
    );
    expect(
      testConnectionSchema.safeParse({ configId: 'synthetic-config', timeout: 600_000 }).success
    ).toBe(true);
    expect(
      testConnectionSchema.safeParse({ configId: 'synthetic-config', timeout: 600_001 }).success
    ).toBe(false);
  });

  it('requires a positive integer when supplied and defaults omitted config timeouts to 30 seconds', () => {
    for (const timeout of [0, -1, 1.5]) {
      expect(createAiConfigSchema.safeParse(config(timeout)).success).toBe(false);
    }

    const { timeout: _timeout, ...withoutTimeout } = config(30_000);
    expect(createAiConfigSchema.parse(withoutTimeout).timeout).toBe(30_000);
  });
});

describe('createAiConfigSchema recipe output budget', () => {
  it('defaults a new config to the full supported token budget without overriding supplied values', () => {
    expect(AI_CONFIG_DEFAULT_MAX_TOKENS).toBe(4096);
    expect(createAiConfigSchema.parse(config(30_000)).maxTokens).toBe(4096);
    expect(createAiConfigSchema.parse({ ...config(30_000), maxTokens: 1200 }).maxTokens).toBe(1200);
  });
});

describe('generateRecipeSchema servings', () => {
  it('does not silently cap a household recipe at the old 20-serving limit', () => {
    const parsed = generateRecipeSchema.parse({
      ingredients: [{ id: 'rice', name: 'arroz', quantity: 1, unit: 'kg' }],
      servings: 27
    });

    expect(parsed.servings).toBe(27);
  });

  it('carries household member selections and ephemeral guest preferences', () => {
    const parsed = generateRecipeSchema.parse({
      ingredients: [{ id: 'rice', name: 'arroz', quantity: 1, unit: 'kg' }],
      householdMemberIds: ['membership-a'],
      guests: [{ allergies: ['cacahuete'], likes: ['calabacín'] }]
    });

    expect(parsed.householdMemberIds).toEqual(['membership-a']);
    expect(parsed.guests).toMatchObject([{ allergies: ['cacahuete'], likes: ['calabacín'] }]);
  });

  it('bounds participant selections and does not accept identifying guest properties', () => {
    const base = {
      ingredients: [{ id: 'rice', name: 'arroz', quantity: 1, unit: 'kg' }]
    };
    expect(
      generateRecipeSchema.safeParse({ ...base, householdMemberIds: Array(51).fill('member') })
        .success
    ).toBe(false);
    expect(
      generateRecipeSchema.safeParse({ ...base, guests: [{ name: 'Invitada' }] }).success
    ).toBe(false);
    expect(generateRecipeSchema.safeParse({ ...base, guests: Array(9).fill({}) }).success).toBe(
      false
    );
  });
});

describe('generateWeeklyPlanSchema participants', () => {
  const base = {
    startDate: '2026-10-05',
    endDate: '2026-10-11',
    goals: { type: 'balanced' }
  };

  it('accepts ephemeral guests and household member selections', async () => {
    const { generateWeeklyPlanSchema } = await import('./ai.schema.js');
    const parsed = generateWeeklyPlanSchema.parse({
      ...base,
      householdMemberIds: ['membership-a'],
      guests: [{ allergies: ['huevo'], dislikes: ['picante'] }]
    });

    expect(parsed.householdMemberIds).toEqual(['membership-a']);
    expect(parsed.guests[0].allergies).toEqual(['huevo']);
  });

  it('rejects client-supplied household preferences instead of treating them as member profiles', async () => {
    const { generateWeeklyPlanSchema } = await import('./ai.schema.js');
    const parsed = generateWeeklyPlanSchema.safeParse({
      ...base,
      householdPreferences: {
        likes: ['forged-household-like'],
        dislikes: [],
        allergies: ['forged-household-allergy']
      }
    });

    expect(parsed.success).toBe(false);
  });
});

describe('replaceMealSchema guests', () => {
  const guest = {
    allergies: ['cacahuetes'],
    intolerances: ['lactosa'],
    diets: ['vegetariana'],
    likes: ['calabacín'],
    dislikes: ['cilantro'],
    notes: 'No muy picante'
  };

  it('accepts multiple ephemeral guest preference profiles', () => {
    const parsed = replaceMealSchema.parse({ mealId: 'meal-1', guests: [guest, guest] });
    expect(parsed.guests).toHaveLength(2);
    expect(parsed.guests[0].allergies).toEqual(['cacahuetes']);
  });

  it('rejects guest names and other identifying fields', () => {
    expect(
      replaceMealSchema.safeParse({ mealId: 'meal-1', guests: [{ ...guest, name: 'Ana' }] }).success
    ).toBe(false);
  });

  it('bounds guest count and free-text fields', () => {
    expect(
      replaceMealSchema.safeParse({ mealId: 'meal-1', guests: Array(9).fill(guest) }).success
    ).toBe(false);
    expect(
      replaceMealSchema.safeParse({
        mealId: 'meal-1',
        guests: [{ ...guest, notes: 'x'.repeat(301) }]
      }).success
    ).toBe(false);
  });

  it('accepts selected household members and plural or custom planning goals', () => {
    const parsed = replaceMealSchema.parse({
      mealId: 'meal-1',
      householdMemberIds: ['member-a'],
      goals: {
        types: ['weight-loss', 'custom'],
        caloriesTarget: 1700,
        customInstructions: 'Prioriza legumbres y verduras.'
      }
    });

    expect(parsed.householdMemberIds).toEqual(['member-a']);
    expect(parsed.goals).toMatchObject({
      types: ['weight-loss', 'custom'],
      caloriesTarget: 1700,
      customInstructions: 'Prioriza legumbres y verduras.'
    });
  });

  it('rejects invalid member selections and custom goals without instructions', () => {
    expect(
      replaceMealSchema.safeParse({
        mealId: 'meal-1',
        householdMemberIds: Array(51).fill('member-a')
      }).success
    ).toBe(false);
    expect(
      replaceMealSchema.safeParse({ mealId: 'meal-1', goals: { types: ['custom'] } }).success
    ).toBe(false);
  });
});

describe('mealReplacementCandidateSchema output text', () => {
  it('accepts long recipe names, descriptions and ingredient strings from AI', () => {
    const longText = 'x'.repeat(2_501);
    const parsed = mealReplacementCandidateSchema.parse({
      safe: true,
      name: longText,
      description: longText,
      ingredients: [longText],
      estimatedTime: 30,
      servings: 2
    });

    expect(parsed.name).toBe(longText);
    expect(parsed.description).toBe(longText);
    expect(parsed.ingredients).toEqual([longText]);
  });
});
