import { describe, expect, it } from 'vitest';
import {
  createMealProposalResponseFormat,
  MEAL_PROPOSAL_LIMITS,
  mealProposalSchema,
  type MealProposal,
  type MealProposalRecipeCandidate
} from './household-meal-proposal.schema.js';

function recipe(): MealProposalRecipeCandidate {
  const step = (instruction: string) => ({
    stepNumber: 1,
    instruction,
    duration: null,
    temperature: null,
    timerRequired: false,
    timerDuration: null,
    tips: null,
    warning: null,
    illustration: null
  });
  return {
    name: 'Lentejas con verduras',
    description: 'Guiso sencillo de lentejas y verduras.',
    difficulty: 'easy',
    cuisine: 'mediterránea',
    totalTime: 50,
    prepTime: 15,
    cookTime: 35,
    restTime: null,
    baseServings: 1,
    calories: 420,
    ingredients: [
      {
        name: 'lentejas',
        quantity: 80,
        unit: 'g',
        preparation: null,
        isOptional: false,
        substitutes: [],
        notes: null
      }
    ],
    utensils: ['olla'],
    guidance: {
      appliances: [],
      parallelTasks: [],
      tipsAndVariations: [],
      batchCookingWarning: null
    },
    instructionsByLevel: {
      basic: [step('Lavar las lentejas.')],
      intermediate: [step('Sofreír las verduras y añadir las lentejas.')],
      expert: [step('Controlar la cocción para mantener las lentejas enteras.')]
    },
    nutrition: { calories: 420, protein: 20, carbs: 54, fat: 8, fiber: 12 },
    storage: {
      method: 'Refrigerar',
      duration: '3 días',
      reheatingInstructions: 'Calentar hasta que esté bien caliente.',
      container: 'Recipiente hermético',
      freezingPossible: true,
      freezingDuration: '2 meses'
    },
    tags: ['legumbres']
  };
}

function makeScheduledEvent(overrides: Partial<MealProposal['events'][number]> = {}) {
  return {
    date: '2026-10-13',
    mealType: 'dinner' as const,
    time: '20:30',
    recipeAlias: 'N1',
    participantAliases: ['P1'],
    servings: 1,
    objectiveSummary: 'Una comida equilibrada con legumbres y verduras.',
    status: 'scheduled' as const,
    reason: null,
    ...overrides
  };
}

function makeUnresolvedEvent(overrides: Record<string, unknown> = {}) {
  return {
    ...makeScheduledEvent(),
    time: null,
    recipeAlias: null,
    servings: 0,
    status: 'unresolved' as const,
    reason: 'No se ha encontrado una opción segura para este grupo.',
    ...overrides
  };
}

function proposal(events: MealProposal['events'] = [makeScheduledEvent()]): MealProposal {
  return {
    newRecipes: [{ alias: 'N1', recipe: recipe() }],
    events
  };
}

function getObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(getObjects);
  if (!value || typeof value !== 'object') return [];
  const node = value as Record<string, unknown>;
  const children: unknown[] = [];
  if (node.properties && typeof node.properties === 'object') {
    children.push(...Object.values(node.properties as Record<string, unknown>));
  }
  if (node.items) children.push(node.items);
  if (node.anyOf) children.push(node.anyOf);
  return [node, ...children.flatMap(getObjects)];
}

describe('meal proposal schema', () => {
  it('uses a WebAPI-supported date pattern in the strict provider schema', () => {
    const responseFormat = createMealProposalResponseFormat();
    const schema = responseFormat.json_schema.schema as {
      properties: { events: { items: { properties: { date: Record<string, unknown> } } } };
    };
    const dateSchema = schema.properties.events.items.properties.date;
    expect(dateSchema.type).toBe('string');
    expect(dateSchema.pattern).toContain('-02-29');
    expect(dateSchema.format).toBeUndefined();
    expect(JSON.stringify(responseFormat.json_schema.schema)).not.toContain('"format"');
  });

  it('accepts scheduled aliases, full new recipes, and explicit unresolved events', () => {
    const parsed = mealProposalSchema.parse({
      newRecipes: [{ alias: 'N1', recipe: recipe() }],
      events: [makeScheduledEvent(), makeUnresolvedEvent({ date: '2026-10-14', mealType: 'lunch' })]
    });
    expect(parsed.events[0]).toMatchObject({ status: 'scheduled', servings: 1, recipeAlias: 'N1' });
    expect(parsed.events[1]).toMatchObject({
      status: 'unresolved',
      recipeAlias: null,
      servings: 0
    });
  });

  it('rejects empty event arrays and requires complete instructions at all three levels', () => {
    expect(mealProposalSchema.safeParse({ newRecipes: [], events: [] }).success).toBe(false);
    const incomplete = recipe() as unknown as Record<string, unknown>;
    incomplete.instructionsByLevel = { basic: recipe().instructionsByLevel.basic };
    expect(
      mealProposalSchema.safeParse({
        newRecipes: [{ alias: 'N1', recipe: incomplete }],
        events: [makeScheduledEvent()]
      }).success
    ).toBe(false);
    const responseFormat = createMealProposalResponseFormat();
    const root = responseFormat.json_schema.schema as { properties: Record<string, unknown> };
    expect(root.properties.events).toMatchObject({ type: 'array', minItems: 1 });
  });

  it('requires a real ISO calendar date, a valid meal type, and a 24-hour time or null', () => {
    expect(
      mealProposalSchema.safeParse(proposal([makeScheduledEvent({ date: '2026-02-29' })])).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse(proposal([makeScheduledEvent({ date: '2026-10-13T00:00:00Z' })]))
        .success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse(proposal([makeScheduledEvent({ mealType: 'brunch' as never })]))
        .success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse(proposal([makeScheduledEvent({ time: '24:00' })])).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse(proposal([makeScheduledEvent({ time: '9:00' })])).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse(proposal([makeScheduledEvent({ date: '2024-02-29' })])).success
    ).toBe(true);
    expect(
      mealProposalSchema.safeParse(proposal([makeScheduledEvent({ time: null })])).success
    ).toBe(true);
  });

  it('enforces one-serving ingredients and bounded recipes/events/servings', () => {
    const valid = recipe();
    const maxIngredients = Array.from(
      { length: MEAL_PROPOSAL_LIMITS.maxIngredientsPerRecipe },
      (_, index) => ({
        name: `ingrediente ${index + 1}`,
        quantity: 1,
        unit: 'g' as const,
        preparation: null,
        isOptional: false,
        substitutes: [],
        notes: null
      })
    );
    expect(
      mealProposalSchema.safeParse({
        newRecipes: [{ alias: 'N1', recipe: { ...valid, ingredients: maxIngredients } }],
        events: [
          makeScheduledEvent({
            participantAliases: Array.from({ length: 100 }, (_, index) => `P${index + 1}`),
            servings: 100
          })
        ]
      }).success
    ).toBe(true);
    expect(
      mealProposalSchema.safeParse(proposal([makeScheduledEvent({ servings: 101 })])).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({
        newRecipes: [{ alias: 'N1', recipe: { ...valid, baseServings: 2 } }],
        events: [makeScheduledEvent()]
      }).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({
        newRecipes: [
          { alias: 'N1', recipe: { ...valid, ingredients: [...maxIngredients, maxIngredients[0]] } }
        ],
        events: [makeScheduledEvent()]
      }).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({
        newRecipes: [],
        events: Array.from({ length: MEAL_PROPOSAL_LIMITS.maxEvents + 1 }, (_, index) =>
          makeScheduledEvent({
            date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
            recipeAlias: 'R1'
          })
        )
      }).success
    ).toBe(false);
  });

  it('rejects duplicate/invented recipe aliases and unreferenced new recipes', () => {
    expect(
      mealProposalSchema.safeParse({
        newRecipes: [{ alias: 'N1', recipe: recipe() }],
        events: [makeScheduledEvent({ recipeAlias: 'N2' })]
      }).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({
        newRecipes: [
          { alias: 'N1', recipe: recipe() },
          { alias: 'N1', recipe: recipe() }
        ],
        events: [makeScheduledEvent()]
      }).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({
        newRecipes: [
          { alias: 'N1', recipe: recipe() },
          { alias: 'N2', recipe: recipe() }
        ],
        events: [makeScheduledEvent()]
      }).success
    ).toBe(false);
  });

  it('rejects duplicate participants within the same date and meal type', () => {
    expect(
      mealProposalSchema.safeParse(
        proposal([
          makeScheduledEvent({ recipeAlias: 'N1', participantAliases: ['P1'] }),
          makeScheduledEvent({ recipeAlias: 'N1', participantAliases: ['P1', 'P2'] })
        ])
      ).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse(
        proposal([
          makeScheduledEvent({ recipeAlias: 'N1', participantAliases: ['P1'] }),
          makeScheduledEvent({ recipeAlias: 'N1', participantAliases: ['P2'] })
        ])
      ).success
    ).toBe(true);
  });

  it('requires scheduled recipe references and unresolved events without recipes', () => {
    expect(
      mealProposalSchema.safeParse(proposal([makeScheduledEvent({ recipeAlias: null })])).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse(proposal([makeScheduledEvent({ reason: 'unexpected' })])).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({ newRecipes: [], events: [makeUnresolvedEvent()] }).success
    ).toBe(true);
    expect(
      mealProposalSchema.safeParse({
        newRecipes: [{ alias: 'N1', recipe: recipe() }],
        events: [makeUnresolvedEvent()]
      }).success
    ).toBe(false);
  });

  it('builds a normalized strict JSON Schema with all keys required and closed', () => {
    const format = createMealProposalResponseFormat();
    expect(format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'weekly_meal_proposal', strict: true }
    });
    const nodes = getObjects(format.json_schema.schema);
    expect(nodes.length).toBeGreaterThan(5);
    for (const node of nodes) {
      if (node.type === 'object' || node.properties) {
        const properties = node.properties as Record<string, unknown>;
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(properties));
      }
    }
    const root = format.json_schema.schema as { properties: Record<string, unknown> };
    expect(root.properties.events).toMatchObject({
      type: 'array',
      minItems: 1,
      maxItems: MEAL_PROPOSAL_LIMITS.maxEvents
    });
    expect(root.properties.newRecipes).toMatchObject({
      type: 'array',
      maxItems: MEAL_PROPOSAL_LIMITS.maxRecipeDefinitions
    });
  });
});
