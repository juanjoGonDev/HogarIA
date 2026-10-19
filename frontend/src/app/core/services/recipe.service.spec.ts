import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { Recipe, RecipeFilter } from '../../shared/models/recipe.model';
import { RecipeService } from './recipe.service';
import type { RecipeStepVideoCandidate } from '../../shared/models/recipe-step-video';

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe-1',
    name: 'Sopa QA',
    description: 'Una receta sintética',
    difficulty: 'easy',
    cuisine: 'casera',
    mealType: ['dinner'],
    totalTime: 20,
    prepTime: 5,
    cookTime: 15,
    servings: 2,
    ingredients: [],
    utensils: [],
    steps: [],
    author: 'user',
    timesCooked: 0,
    tags: [],
    isFavorite: false,
    isPublic: false,
    createdAt: new Date('2026-09-30T00:00:00Z'),
    updatedAt: new Date('2026-09-30T00:00:00Z'),
    ...overrides
  };
}

describe('RecipeService', () => {
  let service: RecipeService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [RecipeService]
    });
    service = TestBed.inject(RecipeService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads recipes, maps all supported filters, and resets loading after a server error', () => {
    service.loadRecipes();
    expect(service.isLoading()).toBeTrue();
    http.expectOne('/api/recipes').flush({ data: { recipes: [makeRecipe()], total: 1 } });
    expect(service.recipes()).toEqual([makeRecipe()]);
    expect(service.total()).toBe(1);
    expect(service.isLoading()).toBeFalse();

    const filter: RecipeFilter = {
      search: 'sopa',
      difficulty: 'easy',
      mealType: 'dinner',
      maxTime: 30,
      isFavorite: true,
      author: 'ai'
    };
    service.loadRecipes(filter);
    const request = http.expectOne(
      '/api/recipes?search=sopa&difficulty=easy&mealType=dinner&maxTime=30&isFavorite=true&author=ai'
    );
    request.flush({ data: { recipes: [], total: 0 } });
    expect(service.recipes()).toEqual([]);
    expect(service.total()).toBe(0);

    service.loadRecipes();
    http.expectOne('/api/recipes').flush({}, { status: 500, statusText: 'Server Error' });
    expect(service.isLoading()).toBeFalse();
    expect(service.recipesLoadError()).toBeTrue();
    expect(service.recipes()).toEqual([]);
  });

  it('clears stale results on a filter error and retries the same filter without a duplicate toast', () => {
    const stale = makeRecipe({ id: 'stale', name: 'Filtro anterior' });
    service.loadRecipes({ search: 'anterior' });
    http.expectOne('/api/recipes?search=anterior').flush({ data: { recipes: [stale], total: 1 } });

    service.loadRecipes({ search: 'reciente', author: 'ai' });
    const failed = http.expectOne('/api/recipes?search=reciente&author=ai');
    expect(failed.request.context.get(SILENT_TOAST)).toBeTrue();
    failed.flush({ message: 'Synthetic failure' }, { status: 503, statusText: 'Unavailable' });

    expect(service.isLoading()).toBeFalse();
    expect(service.recipesLoadError()).toBeTrue();
    expect(service.recipes()).toEqual([stale]);
    expect(service.total()).toBe(1);

    const recovered = makeRecipe({ id: 'ai', name: 'Receta IA' });
    service.retryLoadRecipes();
    const retry = http.expectOne('/api/recipes?search=reciente&author=ai');
    expect(retry.request.context.get(SILENT_TOAST)).toBeTrue();
    retry.flush({ data: { recipes: [recovered], total: 1 } });

    expect(service.recipesLoadError()).toBeFalse();
    expect(service.recipes()).toEqual([recovered]);
    expect(service.total()).toBe(1);
  });

  it('sends country, multiple meal types, catalog scope and pagination to the recipe-book API', () => {
    service.loadRecipes({
      search: 'Maíz',
      countryCode: 'SV',
      mealTypes: ['breakfast', 'snack'],
      cuisine: 'salvadoreña',
      catalogOnly: true,
      page: 2,
      pageSize: 12,
      sortBy: 'name',
      sortOrder: 'asc'
    });

    const request = http.expectOne((candidate) => candidate.url === '/api/recipes');
    expect(request.request.params.get('search')).toBe('Maíz');
    expect(request.request.params.get('countryCode')).toBe('SV');
    expect(request.request.params.get('mealTypes')).toBe('breakfast,snack');
    expect(request.request.params.get('cuisine')).toBe('salvadoreña');
    expect(request.request.params.get('catalogOnly')).toBe('true');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('pageSize')).toBe('12');
    expect(request.request.params.get('sortBy')).toBe('name');
    expect(request.request.params.get('sortOrder')).toBe('asc');
    request.flush({ data: { recipes: [], total: 0, page: 2, pageSize: 12 } });
    expect(service.isLoading()).toBeFalse();
  });

  it('keeps photo-search failures available to the inline retry state without a duplicate global toast', () => {
    let failure: { status?: number } | undefined;
    service.searchRecipePhotos('tortilla española').subscribe({
      error: (error: { status?: number }) => (failure = error)
    });

    const request = http.expectOne('/api/recipes/step-photos/search?q=tortilla%20espa%C3%B1ola');
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush(
      { success: false, message: 'Photo search unavailable' },
      { status: 502, statusText: 'Bad Gateway' }
    );
    expect(failure?.status).toBe(502);
  });

  it('caches bounded video search by generic scene and drops failed cache entries for retry', () => {
    const video: RecipeStepVideoCandidate = {
      id: 'a'.repeat(24),
      title: 'Cortar verduras',
      author: 'Autora sintética',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cutting.webm',
      thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Cutting.jpg',
      durationSeconds: 12,
      mimeType: 'video/webm'
    };
    let first: RecipeStepVideoCandidate[] | undefined;
    service.searchStepVideos('cut').subscribe((value) => (first = value));
    const request = http.expectOne('/api/recipes/step-videos/search?scene=cut');
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush({
      data: [
        video,
        ...Array.from({ length: 7 }, (_, index) => ({
          ...video,
          id: String(index).padStart(24, '0')
        }))
      ]
    });
    expect(first?.length).toBe(5);

    let cached: RecipeStepVideoCandidate[] | undefined;
    service.searchStepVideos('cut').subscribe((value) => (cached = value));
    http.expectNone('/api/recipes/step-videos/search?scene=cut');
    expect(cached).toEqual(first);

    service.searchStepVideos('mix').subscribe({ error: () => undefined });
    http
      .expectOne('/api/recipes/step-videos/search?scene=mix')
      .flush({}, { status: 502, statusText: 'Bad Gateway' });
    service.retryStepVideos('mix').subscribe((value) => (cached = value));
    http.expectOne('/api/recipes/step-videos/search?scene=mix').flush({ data: [] });
    expect(cached).toEqual([]);
  });

  it('prepares authenticated native playback without putting a credential in the stream URL', () => {
    const result: boolean[] = [];
    service
      .prepareStepVideoPlayback('recipe id', 'a'.repeat(24))
      .subscribe((ready) => result.push(ready));
    const request = http.expectOne(
      '/api/recipes/recipe%20id/step-videos/aaaaaaaaaaaaaaaaaaaaaaaa/playback'
    );
    expect(request.request.withCredentials).toBeTrue();
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush({ success: true });

    const url = service.stepVideoStreamUrl('recipe id', 'a'.repeat(24));
    expect(url).toBe('/api/recipes/recipe%20id/step-videos/aaaaaaaaaaaaaaaaaaaaaaaa/stream');
    expect(url).not.toContain('?');
    expect(result).toEqual([true]);
  });

  it('does not let an older filter response replace the newest results', () => {
    service.loadRecipes({ search: 'Maíz', catalogOnly: true });
    service.loadRecipes({
      search: 'Maíz',
      countryCode: 'SV',
      mealType: 'breakfast',
      catalogOnly: true
    });

    const requests = http.match((request) => request.url === '/api/recipes');
    expect(requests.length).toBe(2);

    const filtered = makeRecipe({ id: 'riguas', name: 'Riguas de elote', countryCode: 'SV' });
    requests[1].flush({ data: { recipes: [filtered], total: 1 } });
    expect(service.recipes()).toEqual([filtered]);
    expect(service.total()).toBe(1);
    expect(service.isLoading()).toBeFalse();

    const stale = makeRecipe({ id: 'tamal', name: 'Tamal de elote' });
    requests[0].flush({ data: { recipes: [stale], total: 4 } });
    expect(service.recipes()).toEqual([filtered]);
    expect(service.total()).toBe(1);
    expect(service.isLoading()).toBeFalse();
  });

  it('normalizes a missing catalog cover to the optional UI image field', () => {
    service.loadRecipes();
    http.expectOne('/api/recipes').flush({
      data: { recipes: [{ ...makeRecipe(), image: null }], total: 1 }
    });

    expect(service.recipes()[0].image).toBeUndefined();
  });

  it('returns the recipe DTO itself and updates currentRecipe for a deep-link read', () => {
    const expected = makeRecipe();
    let result: Recipe | null | undefined;

    service.getRecipe(expected.id).subscribe((value) => (result = value));
    http.expectOne(`/api/recipes/${expected.id}`).flush({ success: true, data: expected });

    expect(result).toEqual(expected);
    expect(service.currentRecipe()).toEqual(expected);
  });

  it('normalizes persisted video attribution into the shared clip shape for cooking and editing', () => {
    const candidate = {
      id: 'a'.repeat(24),
      title: 'Corte de prueba',
      author: 'Autora sintética',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cutting.webm',
      thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Cutting.jpg',
      durationSeconds: 10,
      mimeType: 'video/webm' as const
    };
    const apiRecipe = {
      ...makeRecipe(),
      steps: [
        {
          stepNumber: 1,
          instruction: 'Corta verduras.',
          videoId: candidate.id,
          videoAttribution: Object.fromEntries(
            Object.entries(candidate).filter(([key]) => key !== 'id')
          )
        }
      ]
    } as unknown as Recipe;
    let result: Recipe | null | undefined;

    service.getRecipe(apiRecipe.id).subscribe((value) => (result = value));
    http.expectOne(`/api/recipes/${apiRecipe.id}`).flush({ data: apiRecipe });

    expect(result?.steps?.[0].video).toEqual(candidate);
    expect(
      (result?.steps?.[0] as unknown as Record<string, unknown>)['videoAttribution']
    ).toBeUndefined();
  });

  it('returns null for a missing recipe', () => {
    let result: Recipe | null | undefined;
    service.getRecipe('missing').subscribe((value) => (result = value));
    http
      .expectOne('/api/recipes/missing')
      .flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });
    expect(result).toBeNull();
  });

  it('patches the existing recipe and refreshes both recipe signals without masking failures', () => {
    const original = makeRecipe();
    const updated = makeRecipe({ name: 'Sopa corregida', servings: 4 });
    service.loadRecipes();
    http.expectOne('/api/recipes').flush({ data: { recipes: [original], total: 1 } });
    service.getRecipe(original.id).subscribe();
    http.expectOne(`/api/recipes/${original.id}`).flush({ data: original });

    let result: Recipe | undefined;
    service
      .updateRecipe(original.id, { name: updated.name, servings: updated.servings })
      .subscribe((recipe) => (result = recipe));
    const request = http.expectOne({ method: 'PATCH', url: `/api/recipes/${original.id}` });
    expect(request.request.body).toEqual({ name: updated.name, servings: updated.servings });
    request.flush({ success: true, data: updated });

    expect(result).toEqual(updated);
    expect(service.currentRecipe()).toEqual(updated);
    expect(service.recipes()).toEqual([updated]);

    let failure: unknown;
    service.updateRecipe(original.id, { name: 'No guardar' }).subscribe({
      error: (error: unknown) => (failure = error)
    });
    http
      .expectOne({ method: 'PATCH', url: `/api/recipes/${original.id}` })
      .flush({}, { status: 403, statusText: 'Forbidden' });
    expect(failure).toEqual(jasmine.objectContaining({ status: 403 }));
    expect(service.currentRecipe()).toEqual(updated);
    expect(service.recipes()).toEqual([updated]);
  });

  it('prepends a created recipe and returns null without changing the list on failure', () => {
    const existing = makeRecipe();
    service.loadRecipes();
    http.expectOne('/api/recipes').flush({ data: { recipes: [existing], total: 1 } });

    const created = makeRecipe({ id: 'recipe-2', name: 'Nueva' });
    let result: Recipe | null | undefined;
    service.createRecipe({ name: created.name }).subscribe((value) => (result = value));
    http.expectOne({ method: 'POST', url: '/api/recipes' }).flush({ data: created });
    expect(result).toEqual(created);
    expect(service.recipes()).toEqual([created, existing]);

    let failed: Recipe | null | undefined;
    service.createRecipe({ name: 'No guardada' }).subscribe((value) => (failed = value));
    http
      .expectOne({ method: 'POST', url: '/api/recipes' })
      .flush({}, { status: 500, statusText: 'Server Error' });
    expect(failed).toBeNull();
    expect(service.recipes()).toEqual([created, existing]);
  });

  it('toggles favorite for the matching recipe and preserves state on failure', () => {
    const initial = makeRecipe();
    service.loadRecipes();
    http.expectOne('/api/recipes').flush({ data: { recipes: [initial], total: 1 } });

    service.toggleFavorite(initial.id);
    http
      .expectOne({ method: 'POST', url: `/api/recipes/${initial.id}/favorite` })
      .flush({ data: { isFavorite: true } });
    expect(service.recipes()[0].isFavorite).toBeTrue();

    service.toggleFavorite(initial.id);
    http
      .expectOne({ method: 'POST', url: `/api/recipes/${initial.id}/favorite` })
      .flush({}, { status: 500, statusText: 'Server Error' });
    expect(service.recipes()[0].isFavorite).toBeTrue();
  });

  it('removes a successfully unfavorited recipe from favorites results only', () => {
    const first = makeRecipe({ id: 'favorite-1', isFavorite: true });
    const second = makeRecipe({ id: 'favorite-2', name: 'Otra sopa', isFavorite: true });
    service.loadRecipes({ isFavorite: true });
    http.expectOne('/api/recipes?isFavorite=true').flush({
      data: { recipes: [first, second], total: 2 }
    });

    service.toggleFavorite(first.id);
    http
      .expectOne({ method: 'POST', url: `/api/recipes/${first.id}/favorite` })
      .flush({}, { status: 500, statusText: 'Server Error' });
    expect(service.recipes()).toEqual([first, second]);
    expect(service.total()).toBe(2);

    service.toggleFavorite(first.id);
    http
      .expectOne({ method: 'POST', url: `/api/recipes/${first.id}/favorite` })
      .flush({ data: { isFavorite: false } });

    expect(service.recipes()).toEqual([second]);
    expect(service.total()).toBe(1);
  });

  it('keeps an unfavorited recipe visible in unfiltered results', () => {
    const first = makeRecipe({ id: 'favorite-1', isFavorite: true });
    const second = makeRecipe({ id: 'favorite-2', name: 'Otra sopa', isFavorite: true });
    service.loadRecipes();
    http.expectOne('/api/recipes').flush({ data: { recipes: [first, second], total: 2 } });

    service.toggleFavorite(first.id);
    http
      .expectOne({ method: 'POST', url: `/api/recipes/${first.id}/favorite` })
      .flush({ data: { isFavorite: false } });

    expect(service.recipes()).toEqual([{ ...first, isFavorite: false }, second]);
    expect(service.total()).toBe(2);
  });

  it('keeps the loaded filter when a later filter request fails', () => {
    const first = makeRecipe({ id: 'favorite-1', isFavorite: true });
    const second = makeRecipe({ id: 'favorite-2', name: 'Otra sopa', isFavorite: true });
    service.loadRecipes();
    http.expectOne('/api/recipes').flush({ data: { recipes: [first, second], total: 2 } });

    service.loadRecipes({ isFavorite: true });
    http
      .expectOne('/api/recipes?isFavorite=true')
      .flush({}, { status: 500, statusText: 'Server Error' });
    expect(service.recipesLoadError()).toBeTrue();
    expect(service.recipes()).toEqual([first, second]);

    service.toggleFavorite(first.id);
    http
      .expectOne({ method: 'POST', url: `/api/recipes/${first.id}/favorite` })
      .flush({ data: { isFavorite: false } });

    expect(service.recipes()).toEqual([{ ...first, isFavorite: false }, second]);
    expect(service.total()).toBe(2);
  });

  it('returns the cooking result, increments once on success and keeps it on failure', () => {
    const initial = makeRecipe();
    service.loadRecipes();
    http.expectOne('/api/recipes').flush({ data: { recipes: [initial], total: 1 } });

    const successfulResults: boolean[] = [];
    service.recordCooking(initial.id).subscribe((result) => successfulResults.push(result));
    const successfulCooking = http.expectOne({
      method: 'POST',
      url: `/api/recipes/${initial.id}/cook`
    });
    expect(successfulCooking.request.context.get(SILENT_TOAST)).toBeTrue();
    successfulCooking.flush({ success: true });
    expect(successfulResults).toEqual([true]);
    expect(service.recipes()[0].timesCooked).toBe(1);

    const failedResults: boolean[] = [];
    service.recordCooking(initial.id).subscribe((result) => failedResults.push(result));
    http
      .expectOne({ method: 'POST', url: `/api/recipes/${initial.id}/cook` })
      .flush({}, { status: 500, statusText: 'Server Error' });
    expect(failedResults).toEqual([false]);
    expect(service.recipes()[0].timesCooked).toBe(1);

    const malformedResults: boolean[] = [];
    service.recordCooking(initial.id).subscribe((result) => malformedResults.push(result));
    http
      .expectOne({ method: 'POST', url: `/api/recipes/${initial.id}/cook` })
      .flush({ success: false });
    expect(malformedResults).toEqual([false]);
    expect(service.recipes()[0].timesCooked).toBe(1);
  });

  it('posts adjusted servings and returns the API response', () => {
    let result: unknown;
    service.adjustServings('recipe-1', 3).subscribe((value) => (result = value));
    http
      .expectOne(
        (request) =>
          request.url === '/api/recipes/recipe-1/adjust-servings' && request.method === 'POST'
      )
      .flush({ data: { servings: 3 } });
    expect(result).toEqual({ data: { servings: 3 } });
  });

  it('shares only the fixed photo scene request and retries it on demand', () => {
    const photo = {
      id: 'a'.repeat(24),
      altText: 'Vegetables on a board',
      author: 'Ana',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg'
    };
    let first: unknown;
    let second: unknown;
    service.searchStepPhoto('cut').subscribe((value) => (first = value));
    service.searchStepPhoto('cut').subscribe((value) => (second = value));
    const search = http.expectOne('/api/recipes/step-photos?scene=cut');
    expect(search.request.params.keys()).toEqual(['scene']);
    search.flush({ success: true, data: photo });
    expect(first).toEqual(photo);
    expect(second).toEqual(photo);

    let retried: unknown;
    service.retryStepPhoto('cut').subscribe((value) => (retried = value));
    http.expectOne('/api/recipes/step-photos?scene=cut').flush({ success: true, data: null });
    expect(retried).toBeNull();
  });

  it('searches recipe images through the same-origin endpoint using only the explicit query', () => {
    const query = 'tortilla española';
    let result: unknown;
    service.searchRecipePhotos(query).subscribe((value) => (result = value));

    const request = http.expectOne('/api/recipes/step-photos/search?q=tortilla%20espa%C3%B1ola');
    expect(request.request.method).toBe('GET');
    request.flush({
      success: true,
      data: [{ id: 'c'.repeat(24), previewUrl: '/api/recipe-photo-previews/x' }]
    });
    expect(result).toEqual([{ id: 'c'.repeat(24), previewUrl: '/api/recipe-photo-previews/x' }]);
  });

  it('loads and reuses same-origin photo blobs, then allows an explicit retry after image failure', () => {
    const id = 'b'.repeat(24);
    const createObjectUrl = spyOn(URL, 'createObjectURL').and.returnValue('blob:step-photo');
    let first: string | undefined;
    let second: string | undefined;
    service.loadStepPhotoImage(id).subscribe((value) => (first = value));
    service.loadStepPhotoImage(id).subscribe((value) => (second = value));
    const imageRequest = http.expectOne(`/api/recipes/step-photos/${id}/image`);
    expect(imageRequest.request.responseType).toBe('blob');
    imageRequest.flush(new Blob(['synthetic image'], { type: 'image/jpeg' }));
    expect(first).toBe('blob:step-photo');
    expect(second).toBe('blob:step-photo');
    expect(createObjectUrl).toHaveBeenCalledTimes(1);

    service.forgetStepPhotoImage(id);
    service.loadStepPhotoImage(id).subscribe();
    http
      .expectOne(`/api/recipes/step-photos/${id}/image`)
      .flush(new Blob(['synthetic image'], { type: 'image/jpeg' }));
    expect(createObjectUrl).toHaveBeenCalledTimes(2);
  });

  it('deletes only the selected recipe, and keeps the list when deletion fails', () => {
    const first = makeRecipe();
    const second = makeRecipe({ id: 'recipe-2', name: 'Otra' });
    service.loadRecipes();
    http.expectOne('/api/recipes').flush({ data: { recipes: [first, second], total: 2 } });

    let result: boolean | undefined;
    service.deleteRecipe(first.id).subscribe((value) => (result = value));
    http.expectOne({ method: 'DELETE', url: `/api/recipes/${first.id}` }).flush({ success: true });
    expect(result).toBeTrue();
    expect(service.recipes()).toEqual([second]);

    let failed: boolean | undefined;
    service.deleteRecipe(second.id).subscribe((value) => (failed = value));
    http
      .expectOne({ method: 'DELETE', url: `/api/recipes/${second.id}` })
      .flush({}, { status: 500, statusText: 'Server Error' });
    expect(failed).toBeFalse();
    expect(service.recipes()).toEqual([second]);
  });
});
