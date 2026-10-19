export interface CategoryIngredient {
  id: string;
  category: string;
}

/** Filter only the rendered choices; callers keep the selected collection untouched. */
export function filterRecipeIngredientsByCategory<T extends CategoryIngredient>(
  ingredients: readonly T[],
  category: string
): T[] {
  return category === 'all'
    ? [...ingredients]
    : ingredients.filter((item) => item.category === category);
}

/** Add all available rows without losing existing selections or adding duplicate ids. */
export function mergeAllRecipeIngredients<T extends { id: string }>(
  selected: readonly T[],
  available: readonly T[]
): T[] {
  const ids = new Set(selected.map((item) => item.id));
  return [...selected, ...available.filter((item) => !ids.has(item.id))];
}
