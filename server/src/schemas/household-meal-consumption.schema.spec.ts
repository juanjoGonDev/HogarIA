import { describe, expect, it } from 'vitest';
import { householdMealConsumptionSchema } from './household-meal-consumption.schema.js';

describe('household meal consumption contract', () => {
  it('accepts a positive actual serving count and a version', () => {
    expect(
      householdMealConsumptionSchema.safeParse({
        status: 'realized',
        servings: 3,
        expectedVersion: 0
      }).success
    ).toBe(true);
  });

  it('accepts not-realized only with zero servings', () => {
    expect(
      householdMealConsumptionSchema.safeParse({
        status: 'not_realized',
        servings: 0,
        expectedVersion: 1
      }).success
    ).toBe(true);
    expect(
      householdMealConsumptionSchema.safeParse({
        status: 'not_realized',
        servings: 1,
        expectedVersion: 1
      }).success
    ).toBe(false);
  });

  it.each([0, -1, 101, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid realized serving count %s',
    (servings) => {
      expect(
        householdMealConsumptionSchema.safeParse({
          status: 'realized',
          servings,
          expectedVersion: 0
        }).success
      ).toBe(false);
    }
  );

  it('rejects unknown fields, missing versions and invalid status', () => {
    expect(
      householdMealConsumptionSchema.safeParse({ status: 'realized', servings: 1 }).success
    ).toBe(false);
    expect(
      householdMealConsumptionSchema.safeParse({
        status: 'skipped',
        servings: 0,
        expectedVersion: 0
      }).success
    ).toBe(false);
    expect(
      householdMealConsumptionSchema.safeParse({
        status: 'realized',
        servings: 1,
        expectedVersion: 0,
        actorId: 'forged'
      }).success
    ).toBe(false);
  });
});
