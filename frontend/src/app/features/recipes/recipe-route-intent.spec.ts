import { resolveRecipeRouteIntent } from './recipe-route-intent';

describe('resolveRecipeRouteIntent', () => {
  it('opens AI when its fragment and a recipe query are both present', () => {
    expect(resolveRecipeRouteIntent('recipe-1', 'ai')).toEqual({ type: 'ai' });
  });

  it('uses a selected recipe when the AI fragment is absent', () => {
    expect(resolveRecipeRouteIntent('recipe-1', null)).toEqual({
      type: 'recipe',
      recipeId: 'recipe-1'
    });
  });

  it('starts cooking only for an explicit cooking mode on a selected recipe', () => {
    expect(resolveRecipeRouteIntent('recipe-1', null, 'cooking')).toEqual({
      type: 'recipe',
      recipeId: 'recipe-1',
      mode: 'cooking'
    });
    expect(resolveRecipeRouteIntent('recipe-1', null, 'other')).toEqual({
      type: 'recipe',
      recipeId: 'recipe-1'
    });
    expect(resolveRecipeRouteIntent(null, null, 'cooking')).toEqual({ type: 'none' });
  });

  it('does not activate route-driven dialogs without a matching URL state', () => {
    expect(resolveRecipeRouteIntent(null, null)).toEqual({ type: 'none' });
    expect(resolveRecipeRouteIntent('', null)).toEqual({ type: 'none' });
    expect(resolveRecipeRouteIntent(null, 'other')).toEqual({ type: 'none' });
  });
});
