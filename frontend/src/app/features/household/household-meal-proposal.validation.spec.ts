import type { HouseholdMember } from '../../shared/models/household.model';
import type { HouseholdMealProposal } from '../../core/services/household-meal-proposal.service';
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

function proposal(): HouseholdMealProposal {
  return {
    proposalId: 'proposal-1',
    weekStart: '2026-10-12',
    participants: [
      { alias: 'P1', householdMemberId: 'member-1' },
      { alias: 'P2', householdMemberId: 'member-2' }
    ],
    events: [
      {
        id: 'event-1',
        date: '2026-10-12',
        mealType: 'lunch',
        time: '14:00',
        recipe: {
          name: 'Garbanzos',
          description: 'Con verduras',
          baseServings: 1,
          prepTimeMinutes: 10,
          cookTimeMinutes: 25,
          ingredients: [
            {
              name: 'garbanzos',
              quantity: 100,
              unit: 'g',
              preparation: null,
              isOptional: false,
              notes: null
            }
          ],
          instructions: ['Cocinar']
        },
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
  it('accepts a shared, per-serving recipe for the selected active members', () => {
    expect(
      validateHouseholdMealProposal(proposal(), '2026-10-12', ['member-1', 'member-2'], members)
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

  it('rejects invented participants, mismatched IDs, duplicates and invalid per-serving data', () => {
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

    const wrongServingBase = proposal();
    wrongServingBase.events[0].recipe!.baseServings = 2 as 1;
    expect(
      validateHouseholdMealProposal(
        wrongServingBase,
        '2026-10-12',
        ['member-1', 'member-2'],
        members
      )
    ).toBeFalse();

    const duplicateSlot = proposal();
    duplicateSlot.events.push({ ...duplicateSlot.events[0], id: 'event-2' });
    expect(
      validateHouseholdMealProposal(duplicateSlot, '2026-10-12', ['member-1', 'member-2'], members)
    ).toBeFalse();
  });

  it('accepts unresolved slots only when the recipe is omitted and servings are zero', () => {
    const unresolved = proposal();
    unresolved.events[0] = {
      ...unresolved.events[0],
      recipe: null,
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
