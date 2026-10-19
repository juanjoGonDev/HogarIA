import { describe, expect, it } from 'vitest';
import {
  findIngredientRestrictionConflicts,
  findUnsupportedStrictRestrictions,
  safeGuestNote
} from './recipe-replacement.js';

describe('findIngredientRestrictionConflicts', () => {
  it('normalizes accents/case and checks direct ingredient wording', () => {
    expect(findIngredientRestrictionConflicts(['Queso rallado', 'tomate'], ['LÁCTEOS'])).toEqual([
      'Queso rallado'
    ]);
  });

  it('matches common allergen families rather than only exact labels', () => {
    expect(
      findIngredientRestrictionConflicts(['harina de trigo', 'aceite de oliva'], ['celiaquía'])
    ).toEqual(['harina de trigo']);
    expect(findIngredientRestrictionConflicts(['almendras'], ['frutos secos'])).toEqual([
      'almendras'
    ]);
  });

  it('matches celery, mustard, sulphites, lupin, and mollusc aliases', () => {
    const cases = [
      ['apio', 'celery stalk'],
      ['mostaza', 'mostaza de Dijon'],
      ['sulfitos', 'dióxido de azufre'],
      ['altramuz', 'harina de altramuz'],
      ['moluscos', 'pulpo']
    ] as const;

    for (const [restriction, ingredient] of cases) {
      expect(findIngredientRestrictionConflicts([ingredient], [restriction])).toEqual([ingredient]);
    }
  });

  it('accepts supported allergy families and rejects restrictions without a verifier', () => {
    expect(findUnsupportedStrictRestrictions(['lactosa', 'celiaquía', 'altramuz'])).toEqual([]);
    expect(findUnsupportedStrictRestrictions(['fructosa', 'histamina'])).toEqual([
      'fructosa',
      'histamina'
    ]);
  });

  it('leaves unrelated ingredients untouched', () => {
    expect(findIngredientRestrictionConflicts(['arroz', 'calabacín'], ['cacahuete'])).toEqual([]);
    expect(findIngredientRestrictionConflicts(['eggplant'], ['huevo'])).toEqual([]);
  });

  it('removes obvious personal identifiers from guest notes before provider use', () => {
    expect(safeGuestNote('Sin picante; correo ana@example.test, tel. +34 600 123 456')).toBe(
      'Sin picante; correo [dato omitido], tel. [dato omitido]'
    );
  });
});
