import { describe, expect, it } from 'vitest';
import { normalizeIngredientMatchKey } from './ingredient-match.js';

describe('ingredient match normalization', () => {
  it('normalizes Unicode compatibility forms, case, and repeated whitespace', () => {
    expect(normalizeIngredientMatchKey('  ＲＩＣＥ\u00a0  integral  ')).toBe('rice integral');
  });

  it('keeps the established Spanish case-folding behavior for accents', () => {
    expect(normalizeIngredientMatchKey('  PIMENTÓN   DULCE ')).toBe(
      normalizeIngredientMatchKey('pimentón dulce')
    );
  });
});
