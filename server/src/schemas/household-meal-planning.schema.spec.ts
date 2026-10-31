import { describe, expect, it } from 'vitest';
import { householdMealPlanningPatchSchema } from './household-meal-planning.schema.js';

describe('householdMealPlanningPatchSchema', () => {
  it('accepts either shared defaults or caller-owned overrides', () => {
    expect(
      householdMealPlanningPatchSchema.safeParse({
        household: { objective: { goals: ['balanced'] } }
      }).success
    ).toBe(true);
    expect(
      householdMealPlanningPatchSchema.safeParse({
        member: { goalOverrideEnabled: true, scheduleOverrideEnabled: false }
      }).success
    ).toBe(true);
  });

  it('validates meal types, goal values, and 24-hour times', () => {
    for (const patch of [
      { household: { mealTypes: { lunch: 'yes' } } },
      { household: { objective: { goals: ['medical-diagnosis'] } } },
      { household: { mealTimes: { dinner: '25:61' } } },
      { member: { schedule: { mealTimes: { breakfast: '9:00' } } } }
    ]) {
      expect(householdMealPlanningPatchSchema.safeParse(patch).success).toBe(false);
    }
  });

  it('rejects empty or unknown patches instead of silently succeeding', () => {
    expect(householdMealPlanningPatchSchema.safeParse({}).success).toBe(false);
    expect(householdMealPlanningPatchSchema.safeParse({ household: {} }).success).toBe(false);
    expect(householdMealPlanningPatchSchema.safeParse({ member: {} }).success).toBe(false);
    expect(
      householdMealPlanningPatchSchema.safeParse({ member: { otherUserId: 'someone-else' } })
        .success
    ).toBe(false);
  });

  it('accepts complete long household meal-planning notes', () => {
    const notes = 'Preferencias del hogar. '.repeat(140).trim();
    const result = householdMealPlanningPatchSchema.parse({
      household: { objective: { notes } }
    });
    expect(result.household?.objective?.notes).toBe(notes);
  });
});
