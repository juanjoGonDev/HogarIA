import { describe, expect, it } from 'vitest';
import {
  householdMealProposalConfirmRequestSchema,
  householdMealProposalRequestSchema
} from './household-meal-proposal-request.schema.js';

describe('householdMealProposalRequestSchema', () => {
  it('requires one unique set of active membership ids and a Monday week start', () => {
    expect(
      householdMealProposalRequestSchema.safeParse({
        weekStart: '2026-10-12',
        householdMemberIds: ['member-1', 'member-2']
      }).success
    ).toBe(true);
    expect(
      householdMealProposalRequestSchema.safeParse({
        weekStart: '2026-10-13',
        householdMemberIds: ['member-1']
      }).success
    ).toBe(false);
    expect(
      householdMealProposalRequestSchema.safeParse({
        weekStart: '2026-10-12',
        householdMemberIds: ['member-1', 'member-1']
      }).success
    ).toBe(false);
  });

  it('rejects empty, invalid, oversized and unknown request fields', () => {
    for (const value of [
      { weekStart: '2026-02-30', householdMemberIds: ['member-1'] },
      { weekStart: '2026-10-12', householdMemberIds: [] },
      { weekStart: '2026-10-12', householdMemberIds: ['  '] },
      { weekStart: '2026-10-12', householdMemberIds: ['member-1'], goals: ['balanced'] }
    ]) {
      expect(householdMealProposalRequestSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('householdMealProposalConfirmRequestSchema', () => {
  const event = {
    id: 'stable-event-1',
    date: '2026-10-12',
    mealType: 'lunch',
    time: '13:00',
    recipe: {
      name: 'Lentejas',
      description: 'Lentejas sencillas.',
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
      instructions: ['Cocer las lentejas.']
    },
    participantAliases: ['P1'],
    servings: 1,
    objectiveSummary: 'Plato sencillo.',
    status: 'scheduled',
    reason: null
  } as const;

  it('accepts opaque aliases and stable event ids without trusting participant IDs', () => {
    expect(
      householdMealProposalConfirmRequestSchema.safeParse({
        proposalId: 'proposal-1',
        weekStart: '2026-10-12',
        householdMemberIds: ['membership-1'],
        events: [event]
      }).success
    ).toBe(true);
  });

  it('rejects participant IDs, duplicate/invalid event ids and invalid schedules', () => {
    const base = {
      proposalId: 'proposal-1',
      weekStart: '2026-10-12',
      householdMemberIds: ['membership-1'],
      events: [event]
    };
    for (const value of [
      { ...base, events: [{ ...event, id: 'bad:event' }] },
      { ...base, events: [event, event] },
      { ...base, weekStart: '2026-10-13' }
    ]) {
      expect(householdMealProposalConfirmRequestSchema.safeParse(value).success).toBe(false);
    }
  });
});
