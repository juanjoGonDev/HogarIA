import { describe, expect, it } from 'vitest';
import {
  buildExpectedMealSlots,
  normalizeMealProposal,
  type MealProposalMemberContext
} from './household-meal-proposal.planner.js';

function member(
  alias: string,
  overrides: Partial<MealProposalMemberContext> = {}
): MealProposalMemberContext {
  return {
    alias,
    householdMemberId: `member-${alias}`,
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

function scheduledEvent(participantAliases: string[], overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-10-12',
    mealType: 'lunch',
    time: '14:00',
    recipe: {
      name: 'Lentejas',
      description: 'Lentejas con verduras.',
      baseServings: 1,
      prepTimeMinutes: 10,
      cookTimeMinutes: 30,
      ingredients: [
        {
          name: 'lentejas',
          quantity: 80,
          unit: 'g',
          preparation: null,
          isOptional: false,
          notes: null
        }
      ],
      instructions: ['Cocer las lentejas con las verduras.']
    },
    participantAliases,
    servings: participantAliases.length,
    objectiveSummary: 'Plato equilibrado para compartir.',
    status: 'scheduled',
    reason: null,
    ...overrides
  };
}

describe('household meal proposal planner', () => {
  it('builds the weekly slots from each selected member schedule and groups equal times', () => {
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

  it('rejects a model response that omits a scheduled member or invents an unselected alias', () => {
    const members = [member('P1'), member('P2')];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    const expectedEvents = slots.map((slot) =>
      scheduledEvent(slot.participantAliases, {
        date: slot.date,
        mealType: slot.mealType,
        time: slot.time,
        servings: slot.participantAliases.length
      })
    );
    const missingOne = expectedEvents.map((event, index) =>
      index === 0 ? { ...event, participantAliases: ['P1'], servings: 1 } : event
    );
    expect(() => normalizeMealProposal({ events: missingOne }, slots, members)).toThrow(
      'MEAL_PROPOSAL_SLOT_COVERAGE_INVALID'
    );
    const inventedAlias = expectedEvents.map((event, index) =>
      index === 0 ? { ...event, participantAliases: ['P1', 'P3'], servings: 2 } : event
    );
    expect(() => normalizeMealProposal({ events: inventedAlias }, slots, members)).toThrow(
      'MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID'
    );
  });

  it('forces an unsafe shared dish to become a safe shared event plus an unresolved personal slot', () => {
    const members = [member('P1'), member('P2', { strictRestrictions: ['cacahuete'] })];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    const result = normalizeMealProposal(
      {
        events: slots
          .map((slot) =>
            scheduledEvent(['P1', 'P2'], {
              date: slot.date,
              mealType: slot.mealType,
              time: slot.time,
              servings: 2
            })
          )
          .map((event) => {
            (event.recipe.ingredients[0] as { name: string }).name = 'cacahuetes';
            return event;
          })
      },
      slots,
      members
    );

    expect(result.events).toHaveLength(14);
    expect(result.events[0]).toMatchObject({ participantAliases: ['P1'], servings: 1 });
    expect(result.events[1]).toMatchObject({
      status: 'unresolved',
      participantAliases: ['P2'],
      recipe: null,
      servings: 0
    });
    expect(JSON.stringify(result.events[1])).not.toContain('cacahuete');
  });

  it('does not call a candidate safe when an affected ingredient is optional or in recipe notes', () => {
    const members = [member('P1', { strictRestrictions: ['cacahuete'] })];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    const candidates = slots.map((slot) => {
      const candidate = scheduledEvent(['P1'], {
        date: slot.date,
        mealType: slot.mealType,
        time: slot.time
      });
      (candidate.recipe.ingredients[0] as { name: string }).name = 'aceite';
      (candidate.recipe.ingredients[0] as { notes: string | null }).notes =
        'Puede contener cacahuete';
      return candidate;
    });

    const result = normalizeMealProposal({ events: candidates }, slots, members);
    expect(result.events).toHaveLength(7);
    expect(result.events[0]).toMatchObject({ status: 'unresolved', recipe: null, servings: 0 });
  });

  it('checks recipe descriptions and instructions for strict allergen conflicts', () => {
    const members = [member('P1', { strictRestrictions: ['gluten'] })];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    const candidates = slots.map((slot) => {
      const candidate = scheduledEvent(['P1'], {
        date: slot.date,
        mealType: slot.mealType,
        time: slot.time
      });
      candidate.recipe.description = 'Una receta familiar.';
      candidate.recipe.instructions = ['Añade una salsa con trazas de gluten.'];
      return candidate;
    });

    const result = normalizeMealProposal({ events: candidates }, slots, members);

    expect(result.events).toHaveLength(7);
    expect(result.events.every((event) => event.status === 'unresolved')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('gluten');
  });

  it('does not expose another selected member private notes in assigned recipe text', () => {
    const members = [
      member('P1'),
      member('P2', { privateOutputTerms: ['miembro-nota-privada-882'] })
    ];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    const candidates = slots.flatMap((slot) => {
      const candidate = scheduledEvent(['P1'], {
        date: slot.date,
        mealType: slot.mealType,
        time: slot.time
      });
      candidate.recipe.description = 'miembro-nota-privada-882';
      return [
        candidate,
        scheduledEvent(['P2'], {
          date: slot.date,
          mealType: slot.mealType,
          time: slot.time
        })
      ];
    });

    const result = normalizeMealProposal({ events: candidates }, slots, members);

    expect(result.events).toHaveLength(14);
    expect(result.events[0]).toMatchObject({ status: 'unresolved', recipe: null });
    expect(JSON.stringify(result)).not.toContain('miembro-nota-privada-882');
  });

  it('does not reveal another member allergy in copy for a different assignee', () => {
    const members = [member('P1', { strictRestrictions: ['pistacho'] }), member('P2')];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    const candidates = slots.flatMap((slot) => [
      scheduledEvent(['P1'], { date: slot.date, mealType: slot.mealType, time: slot.time }),
      scheduledEvent(['P2'], {
        date: slot.date,
        mealType: slot.mealType,
        time: slot.time,
        objectiveSummary: 'Preparado aparte porque P1 es alérgico al pistacho.'
      })
    ]);

    const result = normalizeMealProposal({ events: candidates }, slots, members);

    expect(result.events).toHaveLength(14);
    expect(result.events[1]).toMatchObject({ status: 'unresolved', recipe: null });
    expect(JSON.stringify(result)).not.toContain('pistacho');
  });

  it('matches private names on word boundaries, not as substrings of ingredients', () => {
    const members = [member('P1', { privateOutputTerms: ['Ana'] })];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    const candidates = slots.map((slot) => {
      const candidate = scheduledEvent(['P1'], {
        date: slot.date,
        mealType: slot.mealType,
        time: slot.time
      });
      (candidate.recipe.ingredients[0] as { name: string }).name = 'banana';
      return candidate;
    });

    const result = normalizeMealProposal({ events: candidates }, slots, members);

    expect(result.events).toHaveLength(7);
    expect(result.events.every((event) => event.status === 'scheduled')).toBe(true);
  });

  it('creates unresolved slots without sending members with unsupported strict restrictions to the AI', () => {
    const members = [
      member('P1', { unsupportedRestrictions: ['reacción a un ingrediente no catalogado'] }),
      member('P2')
    ];
    const slots = buildExpectedMealSlots('2026-10-12', members);
    expect(slots).toHaveLength(7);
    expect(slots[0]?.participantAliases).toEqual(['P1', 'P2']);
    expect(slots[0]?.aiParticipantAliases).toEqual(['P2']);
    expect(slots[0]?.unresolvedAliases).toEqual(['P1']);
  });
});
