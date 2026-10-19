import { describe, expect, it } from 'vitest';
import {
  assistantPantryIngredientIdentitiesMatch,
  assistantPantryIngredientScope,
  comparablePantryIngredientName,
  comparablePantryIngredientUpdatedAt
} from './assistant-pantry-ingredient-scope.js';

describe('assistantPantryIngredientScope', () => {
  it('limits a household context to the current user’s household and personal records', () => {
    expect(assistantPantryIngredientScope('user-1', 'home-1')).toEqual({
      clause: 'user_id = ? AND (household_id = ? OR household_id IS NULL)',
      params: ['user-1', 'home-1'],
      householdId: 'home-1'
    });
  });

  it('limits personal context to the current user’s personal records', () => {
    expect(assistantPantryIngredientScope('user-1', null)).toEqual({
      clause: 'user_id = ? AND household_id IS NULL',
      params: ['user-1'],
      householdId: null
    });
  });

  it('normalizes ingredient names without accent-folding or changing internal words', () => {
    expect(comparablePantryIngredientName('  cafe\u0301   molido ')).toBe('café molido');
    expect(comparablePantryIngredientName('CAFÉ MOLIDO')).toBe('café molido');
  });

  it('matches duplicate identity by normalized name, unit, location, and expiration date', () => {
    const existing = {
      name: '  LENTEJAS  ',
      unit: 'UNIT',
      location: 'PANTRY',
      expirationDate: null
    };
    expect(
      assistantPantryIngredientIdentitiesMatch(existing, {
        name: 'lentejas',
        unit: 'unit',
        location: 'pantry',
        expirationDate: undefined
      })
    ).toBe(true);
    expect(
      assistantPantryIngredientIdentitiesMatch(existing, {
        ...existing,
        expirationDate: '2026-12-31'
      })
    ).toBe(false);
    expect(
      assistantPantryIngredientIdentitiesMatch(
        { ...existing, unit: null, location: null },
        { ...existing, unit: null, location: null }
      )
    ).toBe(true);
    expect(
      assistantPantryIngredientIdentitiesMatch(
        { ...existing, unit: null },
        { ...existing, unit: 'unit' }
      )
    ).toBe(false);
  });

  it('compares SQLite UTC timestamps and their API ISO representation equally', () => {
    expect(comparablePantryIngredientUpdatedAt('2026-10-16 20:04:06')).toBe(
      '2026-10-16T20:04:06.000Z'
    );
    expect(comparablePantryIngredientUpdatedAt('2026-10-16T22:04:06+02:00')).toBe(
      '2026-10-16T20:04:06.000Z'
    );
    expect(comparablePantryIngredientUpdatedAt(new Date('2026-10-16T20:04:06Z'))).toBe(
      '2026-10-16T20:04:06.000Z'
    );
    expect(comparablePantryIngredientUpdatedAt(null)).toBeNull();
  });
});
