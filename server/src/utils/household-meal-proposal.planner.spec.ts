import { describe, expect, it } from 'vitest';
import {
  buildExpectedMealSlots,
  buildUnresolvedMealProposal,
  normalizeMealProposal,
  type MealProposalMemberContext
} from './household-meal-proposal.planner.js';
import type { HouseholdMealRecipeCatalogEntry } from './household-meal-recipe-catalog.js';
import type { MealProposalRecipeCandidate } from '../schemas/household-meal-proposal.schema.js';

function member(
  alias: string,
  overrides: Partial<MealProposalMemberContext> = {}
): MealProposalMemberContext {
  return {
    alias,
    householdMemberId: `member-${alias}`,
    userId: `user-${alias}`,
    schedule: {
      mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
      mealTimes: { breakfast: '09:00', lunch: '14:00', snack: '17:00', dinner: '20:30' }
    },
    goal: { goals: ['balanced'], notes: '' },
    goalOverrideEnabled: false,
    strictRestrictions: [],
    unsupportedRestrictions: [],
    likes: [],
    dislikes: [],
    privateOutputTerms: [],
    privateGoalTerms: [],
    ...overrides
  };
}

function candidateRecipe(): MealProposalRecipeCandidate {
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
    name: 'Lentejas',
    description: 'Lentejas con verduras.',
    difficulty: 'easy',
    cuisine: null,
    totalTime: 40,
    prepTime: 10,
    cookTime: 30,
    restTime: null,
    baseServings: 1,
    calories: null,
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
      intermediate: [step('Cocer las lentejas con verduras.')],
      expert: [step('Cocer suavemente las lentejas para mantener su textura.')]
    },
    nutrition: null,
    storage: null,
    tags: ['legumbres']
  };
}

function event(participantAliases: string[], overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-10-12',
    mealType: 'lunch',
    time: '14:00',
    recipeAlias: 'N1',
    participantAliases,
    servings: participantAliases.length,
    objectiveSummary: 'Plato equilibrado para compartir.',
    status: 'scheduled',
    reason: null,
    ...overrides
  };
}

function recipeProposal(events: unknown[], recipe = candidateRecipe()) {
  return { newRecipes: [{ alias: 'N1', recipe }], events };
}

function selectableCatalogRecipe(
  overrides: Partial<HouseholdMealRecipeCatalogEntry> = {}
): HouseholdMealRecipeCatalogEntry {
  return {
    alias: 'R1',
    source: 'catalog',
    recipeId: 'saved-recipe-1',
    selectable: true,
    recipe: {
      name: 'Arroz guardado',
      description: 'Una receta del catálogo.',
      baseServings: 2,
      ingredients: [{ name: 'arroz', quantity: 100, unit: 'g', isOptional: false }],
      instructionsByLevel: {
        basic: [{ instruction: 'Cocer.' }],
        intermediate: [{ instruction: 'Cocer.' }],
        expert: [{ instruction: 'Cocer.' }]
      }
    },
    ...overrides
  };
}

describe('household meal proposal planner', () => {
  it('builds weekly slots from member schedules and groups matching times', () => {
    const slots = buildExpectedMealSlots('2026-10-12', [
      member('P1'),
      member('P2'),
      member('P3', {
        schedule: {
          mealTypes: { breakfast: true, lunch: false, snack: false, dinner: false },
          mealTimes: { breakfast: '08:00', lunch: '13:30', snack: '17:00', dinner: '20:30' }
        }
      })
    ]);
    expect(slots).toHaveLength(14);
    expect(slots[0]).toMatchObject({
      date: '2026-10-12',
      mealType: 'breakfast',
      time: '08:00',
      participantAliases: ['P3']
    });
    expect(slots[1]).toMatchObject({
      date: '2026-10-12',
      mealType: 'lunch',
      time: '14:00',
      participantAliases: ['P1', 'P2']
    });
  });

  it('rejects omitted slots and invented participant aliases', () => {
    const members = [member('P1'), member('P2')];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    const events = slots.map((slot) =>
      event(slot.participantAliases, { date: slot.date, mealType: slot.mealType, time: slot.time })
    );
    const missing = events.map((item, index) =>
      index === 0 ? { ...item, participantAliases: ['P1'], servings: 1 } : item
    );
    expect(() => normalizeMealProposal(recipeProposal(missing), slots, members, [])).toThrow(
      'MEAL_PROPOSAL_SLOT_COVERAGE_INVALID'
    );
    const invented = events.map((item, index) =>
      index === 0 ? { ...item, participantAliases: ['P1', 'P3'], servings: 2 } : item
    );
    expect(() => normalizeMealProposal(recipeProposal(invented), slots, members, [])).toThrow(
      'MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID'
    );
  });

  it('deduplicates a complete generated recipe used across the week and forces base-one serving', () => {
    const members = [member('P1')];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    const result = normalizeMealProposal(
      recipeProposal(
        slots.map((slot) =>
          event(['P1'], { date: slot.date, mealType: slot.mealType, time: slot.time })
        )
      ),
      slots,
      members,
      []
    );
    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0]).toMatchObject({
      alias: 'N1',
      source: 'new',
      recipeId: null,
      recipe: {
        baseServings: 1,
        instructionsByLevel: {
          basic: expect.any(Array),
          intermediate: expect.any(Array),
          expert: expect.any(Array)
        }
      }
    });
    expect(result.events).toHaveLength(7);
    expect(result.events.every((item) => item.recipeAlias === 'N1' && item.servings === 1)).toBe(
      true
    );
  });

  it('resolves only selectable catalog aliases and preserves their recipe ID', () => {
    const members = [member('P1')];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    const catalog = selectableCatalogRecipe();
    const events = slots.map((slot) =>
      event(['P1'], {
        date: slot.date,
        mealType: slot.mealType,
        time: slot.time,
        recipeAlias: 'R1'
      })
    );
    const result = normalizeMealProposal({ newRecipes: [], events }, slots, members, [catalog]);
    expect(result.recipes).toEqual([catalog]);
    expect(result.events.every((item) => item.recipeAlias === 'R1')).toBe(true);
    expect(() =>
      normalizeMealProposal(
        { newRecipes: [], events: events.map((item) => ({ ...item, recipeAlias: 'R2' })) },
        slots,
        members,
        [catalog]
      )
    ).toThrow('MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID');
    const unavailable = normalizeMealProposal({ newRecipes: [], events }, slots, members, [
      { ...catalog, selectable: false }
    ]);
    expect(unavailable.events.every((item) => item.status === 'unresolved')).toBe(true);
  });

  it('turns an unsafe shared recipe into a safe group plus an unresolved allergic participant', () => {
    const members = [member('P1'), member('P2', { strictRestrictions: ['cacahuete'] })];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    const recipe = candidateRecipe();
    recipe.ingredients[0]!.name = 'cacahuetes';
    const result = normalizeMealProposal(
      recipeProposal(
        slots.map((slot) =>
          event(['P1', 'P2'], {
            date: slot.date,
            mealType: slot.mealType,
            time: slot.time,
            servings: 2
          })
        ),
        recipe
      ),
      slots,
      members,
      []
    );
    expect(result.events).toHaveLength(14);
    expect(result.events[0]).toMatchObject({ participantAliases: ['P1'], servings: 1 });
    expect(result.events[1]).toMatchObject({
      status: 'unresolved',
      recipeAlias: null,
      participantAliases: ['P2'],
      servings: 0
    });
    expect(JSON.stringify(result.events[1])).not.toContain('cacahuete');
  });

  it('scans every instruction level and all recipe text for strict restrictions and private disclosures', () => {
    const members = [member('P1', { strictRestrictions: ['gluten'] })];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    const recipe = candidateRecipe();
    recipe.instructionsByLevel.expert[0]!.instruction = 'Añade una salsa con trazas de gluten.';
    const candidates = slots.map((slot) =>
      event(['P1'], { date: slot.date, mealType: slot.mealType, time: slot.time })
    );
    const result = normalizeMealProposal(recipeProposal(candidates, recipe), slots, members, []);
    expect(result.events.every((item) => item.status === 'unresolved')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('gluten');
  });

  it('removes member-private output terms from new recipe fields before they reach the preview', () => {
    const members = [member('P1', { privateOutputTerms: ['dato-sensible-xyz'] })];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    const recipe = candidateRecipe();
    recipe.guidance.tipsAndVariations = ['dato-sensible-xyz'];
    const result = normalizeMealProposal(
      recipeProposal(
        slots.map((slot) =>
          event(['P1'], { date: slot.date, mealType: slot.mealType, time: slot.time })
        ),
        recipe
      ),
      slots,
      members,
      []
    );
    expect(result.events.every((item) => item.status === 'unresolved')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('dato-sensible-xyz');
  });

  it('creates review placeholders for unsupported restrictions without sending that member to AI', () => {
    const members = [
      member('P1', { unsupportedRestrictions: ['restricción no catalogada'] }),
      member('P2')
    ];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    expect(slots[0]).toMatchObject({
      participantAliases: ['P1', 'P2'],
      aiParticipantAliases: ['P2'],
      unresolvedAliases: ['P1']
    });
  });

  it('rejects incomplete provider coverage but creates nonempty local unresolved events when nobody is eligible', () => {
    const members = [member('P1')];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    expect(() =>
      normalizeMealProposal({ newRecipes: [], events: [] }, slots, members, [])
    ).toThrow();
    const unsupported = [member('P1', { unsupportedRestrictions: ['restricción no catalogada'] })];
    const unresolved = buildUnresolvedMealProposal(
      buildExpectedMealSlots('2026-10-12', unsupported)
    );
    expect(unresolved.recipes).toEqual([]);
    expect(unresolved.events).toHaveLength(7);
    expect(unresolved.events.every((item) => item.status === 'unresolved')).toBe(true);
  });
});
