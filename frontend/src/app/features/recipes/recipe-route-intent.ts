export type RecipeRouteIntent =
  { type: 'ai' } | { type: 'recipe'; recipeId: string; mode?: 'cooking' } | { type: 'none' };

/** AI links use the fragment; a selected recipe deep link uses its query parameter. */
export function resolveRecipeRouteIntent(
  recipeId: string | null,
  fragment: string | null,
  mode: string | null = null
): RecipeRouteIntent {
  if (fragment === 'ai') return { type: 'ai' };
  if (recipeId) {
    return mode === 'cooking'
      ? { type: 'recipe', recipeId, mode: 'cooking' }
      : { type: 'recipe', recipeId };
  }
  return { type: 'none' };
}
