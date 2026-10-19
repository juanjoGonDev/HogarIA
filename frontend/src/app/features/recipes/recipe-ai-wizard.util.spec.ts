import {
  filterRecipeIngredientsByCategory,
  mergeAllRecipeIngredients
} from './recipe-ai-wizard.util';

describe('recipe AI wizard ingredient selection', () => {
  const ingredients = [
    { id: 'carrot', category: 'vegetables' },
    { id: 'milk', category: 'dairy' },
    { id: 'pepper', category: 'vegetables' }
  ];

  it('filters the visible category without mutating selections from other categories', () => {
    const selected = [ingredients[1]];

    expect(filterRecipeIngredientsByCategory(ingredients, 'vegetables')).toEqual([
      ingredients[0],
      ingredients[2]
    ]);
    expect(selected).toEqual([ingredients[1]]);
    expect(filterRecipeIngredientsByCategory(ingredients, 'all')).toEqual(ingredients);
  });

  it('selects every available ingredient once and keeps existing choices', () => {
    expect(mergeAllRecipeIngredients([ingredients[0]], [ingredients[0], ingredients[1]])).toEqual([
      ingredients[0],
      ingredients[1]
    ]);
  });
});
