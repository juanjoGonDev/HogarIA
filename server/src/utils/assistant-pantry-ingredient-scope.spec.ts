import { describe, expect, it } from 'vitest';
import {
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
