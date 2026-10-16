import {
  detailLevelForCookingLevel,
  recipeDetailLevelLabelKey,
  recipeDetailLevelFor,
  rememberRecipeDetailLevel,
  scaleRecipeQuantity
} from './recipe-detail.util';

describe('scaleRecipeQuantity', () => {
  it('scales an ingredient for the selected serving count', () => {
    expect(scaleRecipeQuantity(180, 2, 4)).toBe(360);
    expect(scaleRecipeQuantity(1, 2, 3)).toBe(1.5);
  });

  it('rounds displayed amounts to at most two decimals', () => {
    expect(scaleRecipeQuantity(1, 3, 2)).toBe(0.67);
  });

  it('keeps the original amount when any input is invalid', () => {
    expect(scaleRecipeQuantity(2, 0, 4)).toBe(2);
    expect(scaleRecipeQuantity(2, 2, Number.NaN)).toBe(2);
    expect(scaleRecipeQuantity(Number.NaN, 2, 4)).toBeNaN();
  });
});

describe('recipe detail level preferences', () => {
  it('uses the same proficiency names as the personal cooking profile', () => {
    expect(recipeDetailLevelLabelKey('basic')).toBe('auth.beginner');
    expect(recipeDetailLevelLabelKey('intermediate')).toBe('auth.intermediate');
    expect(recipeDetailLevelLabelKey('expert')).toBe('auth.expert');
  });

  it('maps cooking skill to the matching instruction depth', () => {
    expect(detailLevelForCookingLevel('beginner')).toBe('basic');
    expect(detailLevelForCookingLevel('none')).toBe('basic');
    expect(detailLevelForCookingLevel('intermediate')).toBe('intermediate');
    expect(detailLevelForCookingLevel('expert')).toBe('expert');
    expect(detailLevelForCookingLevel('unexpected')).toBe('basic');
  });

  it('defaults to the current selection until a recipe has its own choice', () => {
    expect(recipeDetailLevelFor({}, 'recipe-a', 'intermediate')).toBe('intermediate');
  });

  it('remembers each recipe presentation separately without mutating prior state', () => {
    const initial = { 'recipe-a': 'expert' as const };
    const next = rememberRecipeDetailLevel(initial, 'recipe-b', 'basic');

    expect(initial).toEqual({ 'recipe-a': 'expert' });
    expect(next).toEqual({ 'recipe-a': 'expert', 'recipe-b': 'basic' });
    expect(recipeDetailLevelFor(next, 'recipe-a', 'intermediate')).toBe('expert');
    expect(recipeDetailLevelFor(next, 'recipe-b', 'intermediate')).toBe('basic');
  });
});
