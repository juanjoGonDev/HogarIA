import type { HouseholdMember } from '../../shared/models/household.model';
import type {
  HouseholdMealProposal,
  HouseholdMealProposalRecipe
} from '../../core/services/household-meal-proposal.service';
import { validateHouseholdMealProposal } from './household-meal-proposal.validation';

const members: HouseholdMember[] = [member('member-1', 'user-1'), member('member-2', 'user-2')];

function member(id: string, userId: string): HouseholdMember {
  return {
    id,
    userId,
    name: userId,
    email: `${userId}@example.test`,
    role: 'member',
    cookingLevel: 'beginner',
    isActive: true,
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    permissions: {
      pantry: { view: true, edit: false, manage: false },
      recipes: { view: true, create: false, edit: false, delete: false, generateAI: false },
      calendar: { view: true, edit: false },
      members: { invite: false, kick: false, manageRoles: false },
      settings: false
    }
  };
}

function recipe(overrides: Partial<HouseholdMealProposalRecipe> = {}): HouseholdMealProposalRecipe {
  return {
    name: 'Garbanzos',
    description: 'Con verduras',
    baseServings: 1,
    difficulty: 'easy',
    cuisine: 'Mediterránea',
    totalTime: 35,
    prepTime: 10,
    cookTime: 25,
    restTime: null,
    calories: 320,
    ingredients: [
      {
        name: 'garbanzos',
        quantity: 100,
        unit: 'g',
        preparation: null,
        isOptional: false,
        substitutes: [],
        notes: null
      }
    ],
    utensils: ['Olla'],
    guidance: {
      appliances: [],
      parallelTasks: [],
      tipsAndVariations: [],
      batchCookingWarning: null
    },
    instructionsByLevel: {
      basic: [step('Enjuaga los garbanzos')],
      intermediate: [step('Enjuaga los garbanzos')],
      expert: [step('Enjuaga los garbanzos')]
    },
    nutrition: { calories: 320, protein: 14, carbs: 45, fat: 8, fiber: 9 },
    storage: {
      method: 'Refrigerar',
      duration: '3 días',
      reheatingInstructions: 'Calentar a fuego bajo',
      container: 'Recipiente cerrado',
      freezingPossible: true,
      freezingDuration: '2 meses'
    },
    tags: ['legumbres'],
    ...overrides
  };
}

function step(instruction: string) {
  return {
    stepNumber: 1,
    instruction,
    duration: 5,
    tips: null,
    warning: null,
    illustration: null
  };
}

function proposal(): HouseholdMealProposal {
  return {
    proposalId: 'proposal-1',
    weekStart: '2026-10-12',
    participants: [
      { alias: 'P1', householdMemberId: 'member-1' },
      { alias: 'P2', householdMemberId: 'member-2' }
    ],
    recipes: [{ alias: 'N1', source: 'new', recipeId: null, recipe: recipe() }],
    events: [
      {
        id: 'event-1',
        date: '2026-10-12',
        mealType: 'lunch',
        time: '14:00',
        recipeAlias: 'N1',
        participantAliases: ['P1', 'P2'],
        participantIds: ['user-1', 'user-2'],
        servings: 2,
        objectiveSummary: 'Plato compartido',
        status: 'scheduled',
        reason: null
      }
    ]
  };
}

describe('validateHouseholdMealProposal', () => {
  it('accepts a full new recipe linked by alias for selected active members', () => {
    expect(
      validateHouseholdMealProposal(proposal(), '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeTrue();
  });

  it('accepts a catalog recipe with its own serving base and a legacy flat step list', () => {
    const legacyProposal = proposal();
    legacyProposal.recipes[0] = {
      alias: 'C1',
      source: 'catalog',
      recipeId: 'recipe-1',
      recipe: recipe({
        baseServings: 4,
        instructionsByLevel: undefined,
        steps: [{ stepNumber: 4, instruction: 'Cocer a fuego lento' }]
      })
    };
    legacyProposal.events[0].recipeAlias = 'C1';

    expect(
      validateHouseholdMealProposal(legacyProposal, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeTrue();
  });

  it('accepts normalized catalog levels when the legacy steps field is null', () => {
    const catalogProposal = proposal();
    catalogProposal.recipes[0] = {
      alias: 'R1',
      source: 'catalog',
      recipeId: 'recipe-1',
      recipe: recipe({ baseServings: 4, steps: null })
    };
    catalogProposal.events[0].recipeAlias = 'R1';

    expect(
      validateHouseholdMealProposal(
        catalogProposal,
        '2026-10-12',
        ['member-1', 'member-2'],
        members
      )
    ).toBeTrue();
  });

  it('rejects an old week or a membership that is no longer eligible', () => {
    expect(
      validateHouseholdMealProposal(proposal(), '2026-10-19', ['member-1', 'member-2'], members)
    ).toBeFalse();
    const deactivated = members.map((item) =>
      item.id === 'member-2' ? { ...item, isActive: false } : item
    );
    expect(
      validateHouseholdMealProposal(proposal(), '2026-10-12', ['member-1', 'member-2'], deactivated)
    ).toBeFalse();
  });

  it('rejects invented participants, mismatched IDs and duplicate slot assignments', () => {
    const unselected = proposal();
    unselected.participants[1].householdMemberId = 'not-selected';
    expect(
      validateHouseholdMealProposal(unselected, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeFalse();

    const wrongUserId = proposal();
    wrongUserId.events[0].participantIds = ['user-1', 'other-user'];
    expect(
      validateHouseholdMealProposal(wrongUserId, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeFalse();

    const duplicateSlot = proposal();
    duplicateSlot.events.push({ ...duplicateSlot.events[0], id: 'event-2' });
    expect(
      validateHouseholdMealProposal(duplicateSlot, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeFalse();
  });

  it('rejects unknown or missing aliases, duplicate recipe aliases and duplicate catalog IDs', () => {
    const unknownAlias = proposal();
    unknownAlias.events[0].recipeAlias = 'R404';
    expect(
      validateHouseholdMealProposal(unknownAlias, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeFalse();

    const missingAlias = proposal();
    missingAlias.events[0].recipeAlias = null;
    expect(
      validateHouseholdMealProposal(missingAlias, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeFalse();

    const duplicateAlias = proposal();
    duplicateAlias.recipes.push({ ...duplicateAlias.recipes[0] });
    expect(
      validateHouseholdMealProposal(duplicateAlias, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeFalse();

    const duplicateId = proposal();
    duplicateId.recipes[0] = {
      alias: 'C1',
      source: 'catalog',
      recipeId: 'same-id',
      recipe: recipe()
    };
    duplicateId.recipes.push({
      alias: 'C2',
      source: 'catalog',
      recipeId: 'same-id',
      recipe: recipe()
    });
    expect(
      validateHouseholdMealProposal(duplicateId, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeFalse();
  });

  it('rejects malformed complete recipes, invalid detail levels and invalid new/catalog IDs', () => {
    const missingUtensils = proposal();
    (missingUtensils.recipes[0].recipe as unknown as Record<string, unknown>)['utensils'] = null;
    expect(
      validateHouseholdMealProposal(
        missingUtensils,
        '2026-10-12',
        ['member-1', 'member-2'],
        members
      )
    ).toBeFalse();

    const unorderedLevel = proposal();
    unorderedLevel.recipes[0].recipe.instructionsByLevel!.expert[0].stepNumber = 2;
    expect(
      validateHouseholdMealProposal(unorderedLevel, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeFalse();

    const missingStepMetadata = proposal();
    delete missingStepMetadata.recipes[0].recipe.instructionsByLevel!.basic[0].duration;
    expect(
      validateHouseholdMealProposal(
        missingStepMetadata,
        '2026-10-12',
        ['member-1', 'member-2'],
        members
      )
    ).toBeFalse();

    const invalidTemperature = proposal();
    (
      invalidTemperature.recipes[0].recipe.instructionsByLevel!.basic[0] as unknown as Record<
        string,
        unknown
      >
    )['temperature'] = { value: 180, unit: 'K' };
    expect(
      validateHouseholdMealProposal(
        invalidTemperature,
        '2026-10-12',
        ['member-1', 'member-2'],
        members
      )
    ).toBeFalse();

    const invalidTimer = proposal();
    invalidTimer.recipes[0].recipe.instructionsByLevel!.basic[0].timerDuration = 0;
    expect(
      validateHouseholdMealProposal(invalidTimer, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeFalse();

    const noNewId = proposal();
    noNewId.recipes[0].recipeId = 'unexpected';
    expect(
      validateHouseholdMealProposal(noNewId, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeFalse();

    const noCatalogId = proposal();
    noCatalogId.recipes[0].source = 'catalog';
    noCatalogId.recipes[0].recipeId = null;
    expect(
      validateHouseholdMealProposal(noCatalogId, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeFalse();

    const neitherInstructions = proposal();
    delete neitherInstructions.recipes[0].recipe.instructionsByLevel;
    expect(
      validateHouseholdMealProposal(
        neitherInstructions,
        '2026-10-12',
        ['member-1', 'member-2'],
        members
      )
    ).toBeFalse();

    const bothInstructionShapes = proposal();
    bothInstructionShapes.recipes[0].recipe.steps = [{ stepNumber: 1, instruction: 'Duplicado' }];
    expect(
      validateHouseholdMealProposal(
        bothInstructionShapes,
        '2026-10-12',
        ['member-1', 'member-2'],
        members
      )
    ).toBeFalse();
  });

  it('accepts unresolved slots only with no recipe alias and zero servings', () => {
    const unresolved = proposal();
    unresolved.recipes = [];
    unresolved.events[0] = {
      ...unresolved.events[0],
      recipeAlias: null,
      servings: 0,
      status: 'unresolved',
      reason: 'Requiere revisión'
    };
    expect(
      validateHouseholdMealProposal(unresolved, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeTrue();
    unresolved.events[0].reason = null;
    expect(
      validateHouseholdMealProposal(unresolved, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeFalse();
  });
});
