import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { AiService } from './ai.service';
import type { AIProviderConfig, AIRecipeResponse } from '../../shared/models/ai-config.model';

const CONFIG: AIProviderConfig = {
  id: 'synthetic-config',
  name: 'Synthetic provider',
  provider: 'custom',
  baseUrl: 'http://localhost:8000/v1',
  apiKey: 'sk-synthetic-only',
  model: 'gpt-test',
  temperature: 0.7,
  maxTokens: 2000,
  timeout: 30000,
  retryAttempts: 3,
  concurrency: 1,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z')
};

function recipeStep(instruction: string) {
  return {
    stepNumber: 1,
    instruction,
    duration: null,
    temperature: null,
    timerRequired: false,
    timerDuration: null,
    tips: null,
    warning: null,
    illustration: null
  };
}

describe('AiService', () => {
  let service: AiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(AiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads configurations, publishes loading state, and distinguishes a failed load', () => {
    service.loadConfigs();
    expect(service.configsLoading()).toBeTrue();
    expect(service.configsError()).toBeFalse();
    const load = http.expectOne('/api/ai/configs');
    expect(load.request.context.get(SILENT_TOAST)).toBeTrue();
    load.flush({ data: [CONFIG] });
    expect(service.configs()).toEqual([CONFIG]);
    expect(service.configsLoading()).toBeFalse();
    expect(service.configsError()).toBeFalse();

    service.loadConfigs();
    http.expectOne('/api/ai/configs').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(service.configsLoading()).toBeFalse();
    expect(service.configsError()).toBeTrue();
    // A transient refresh error does not destroy already-loaded records.
    expect(service.configs()).toEqual([CONFIG]);
  });

  it('returns the scoped config snapshot and uses null only when its request fails', async () => {
    let result: AIProviderConfig[] | null | undefined;
    service.loadConfigsSnapshot().subscribe((configs) => (result = configs));
    expect(service.configsLoading()).toBeTrue();
    http.expectOne('/api/ai/configs').flush({ data: [CONFIG] });
    expect(result).toEqual([CONFIG]);
    expect(service.configs()).toEqual([CONFIG]);
    expect(service.configsLoading()).toBeFalse();

    service.loadConfigsSnapshot().subscribe((configs) => (result = configs));
    http.expectOne('/api/ai/configs').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(result).toBeNull();
    expect(service.configsError()).toBeTrue();
    expect(service.configs()).toEqual([CONFIG]);
  });

  it('ignores stale overlapping loads and leaves loading owned by the newest request', () => {
    const firstResult = { ...CONFIG, name: 'Older response' };
    const latestResult = { ...CONFIG, id: 'latest', name: 'Latest response' };

    service.loadConfigs();
    const older = http.expectOne('/api/ai/configs');
    service.loadConfigs();
    const latest = http.expectOne('/api/ai/configs');

    older.flush({ data: [firstResult] });
    const stateWhileLatestIsPending = {
      configs: service.configs(),
      loading: service.configsLoading()
    };
    latest.flush({ data: [latestResult] });

    service.loadConfigs();
    const lateOlder = http.expectOne('/api/ai/configs');
    service.loadConfigs();
    const newer = http.expectOne('/api/ai/configs');
    newer.flush({ data: [latestResult] });
    lateOlder.flush({ data: [firstResult] });

    expect(stateWhileLatestIsPending.configs).toEqual([]);
    expect(stateWhileLatestIsPending.loading).toBeTrue();
    expect(service.configs()).toEqual([latestResult]);
    expect(service.configsLoading()).toBeFalse();
  });

  it('ignores stale load failures and preserves the latest error state', () => {
    service.loadConfigs();
    const staleFailure = http.expectOne('/api/ai/configs');
    service.loadConfigs();
    const latestSuccess = http.expectOne('/api/ai/configs');

    staleFailure.flush({}, { status: 503, statusText: 'Unavailable' });
    expect(service.configsLoading()).toBeTrue();
    expect(service.configsError()).toBeFalse();
    latestSuccess.flush({ data: [CONFIG] });
    expect(service.configs()).toEqual([CONFIG]);
    expect(service.configsError()).toBeFalse();

    service.loadConfigs();
    const staleSuccess = http.expectOne('/api/ai/configs');
    service.loadConfigs();
    const latestFailure = http.expectOne('/api/ai/configs');
    latestFailure.flush({}, { status: 503, statusText: 'Unavailable' });
    expect(service.configsLoading()).toBeFalse();
    expect(service.configsError()).toBeTrue();
    staleSuccess.flush({ data: [{ ...CONFIG, name: 'Late stale result' }] });

    expect(service.configs()).toEqual([CONFIG]);
    expect(service.configsLoading()).toBeFalse();
    expect(service.configsError()).toBeTrue();
  });

  it('does not restore a deleted config from a load that began before deletion', () => {
    service.createConfig(CONFIG).subscribe();
    http.expectOne('/api/ai/configs').flush({ data: CONFIG });

    service.loadConfigs();
    const staleLoad = http.expectOne('/api/ai/configs');
    service.deleteConfig(CONFIG.id).subscribe();
    http.expectOne(`/api/ai/configs/${CONFIG.id}`).flush({ success: true });
    expect(service.configs()).toEqual([]);

    staleLoad.flush({ data: [CONFIG] });

    expect(service.configs()).toEqual([]);
    expect(service.configsLoading()).toBeFalse();
    expect(service.configsError()).toBeFalse();
  });

  it('requests a meal replacement with only guest food preferences and propagates the candidate', () => {
    const guests = [
      {
        allergies: ['cacahuete'],
        intolerances: ['lactosa'],
        diets: ['vegetariana'],
        likes: ['calabacín'],
        dislikes: ['cilantro'],
        notes: 'Sin picante'
      }
    ];
    let candidate: unknown;
    service.replaceMeal({ mealId: 'meal-1', guests }).subscribe((value) => (candidate = value));

    const request = http.expectOne('/api/ai/replace-meal');
    expect(request.request.method).toBe('POST');
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    expect(request.request.body).toEqual({ mealId: 'meal-1', guests });
    const expected = {
      name: 'Arroz de verduras',
      description: 'Alternativa sintética.',
      ingredients: ['arroz', 'verduras'],
      estimatedTime: 25,
      servings: 3
    };
    request.flush({ data: expected });

    expect(candidate).toEqual(expected);
  });

  it('sends selected household members and plural planning goals with a replacement request', () => {
    const requestBody = {
      mealId: 'meal-2',
      householdMemberIds: ['membership-a', 'membership-b'],
      guests: [],
      goals: {
        types: ['weight-loss', 'custom'],
        caloriesTarget: 1700,
        customInstructions: 'Prioriza legumbres.'
      }
    };

    service.replaceMeal(requestBody).subscribe();

    const request = http.expectOne('/api/ai/replace-meal');
    expect(request.request.body).toEqual(requestBody);
    request.flush({
      data: {
        name: 'Lentejas',
        description: 'Plato completo.',
        ingredients: ['lentejas'],
        estimatedTime: 30,
        servings: 2
      }
    });
  });

  it('cancels the replacement HTTP request when its subscriber unsubscribes', () => {
    const subscription = service.replaceMeal({ mealId: 'meal-cancelled' }).subscribe();
    const request = http.expectOne('/api/ai/replace-meal');

    subscription.unsubscribe();

    expect(request.cancelled).toBeTrue();
  });

  it('does not hide a prior load error when deleting a cached config', () => {
    service.createConfig(CONFIG).subscribe();
    http.expectOne('/api/ai/configs').flush({ data: CONFIG });
    service.loadConfigs();
    http.expectOne('/api/ai/configs').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(service.configsError()).toBeTrue();

    service.deleteConfig(CONFIG.id).subscribe();
    http.expectOne(`/api/ai/configs/${CONFIG.id}`).flush({ success: true });

    expect(service.configs()).toEqual([]);
    expect(service.configsError()).toBeTrue();
  });

  it('creates and updates configurations only when the server confirms them', () => {
    let created: AIProviderConfig | null | undefined;
    service.createConfig(CONFIG).subscribe((result) => {
      created = result;
    });
    const createRequest = http.expectOne('/api/ai/configs');
    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.context.get(SILENT_TOAST)).toBeTrue();
    createRequest.flush({ data: CONFIG });
    expect(created).toEqual(CONFIG);
    expect(service.configs()).toEqual([CONFIG]);

    const other = { ...CONFIG, id: 'other-config', name: 'Other provider' };
    service.createConfig(other).subscribe();
    http.expectOne('/api/ai/configs').flush({ data: other });

    const updated = { ...CONFIG, name: 'Updated provider' };
    let saved: AIProviderConfig | null | undefined;
    service.updateConfig(CONFIG.id, { name: updated.name }).subscribe((result) => {
      saved = result;
    });
    const updateRequest = http.expectOne(`/api/ai/configs/${CONFIG.id}`);
    expect(updateRequest.request.method).toBe('PATCH');
    expect(updateRequest.request.context.get(SILENT_TOAST)).toBeTrue();
    updateRequest.flush({ data: updated });
    expect(saved).toEqual(updated);
    expect(service.configs()).toEqual([updated, other]);

    let failed: AIProviderConfig | null | undefined;
    service.updateConfig(CONFIG.id, { name: 'Not saved' }).subscribe((result) => {
      failed = result;
    });
    http
      .expectOne(`/api/ai/configs/${CONFIG.id}`)
      .flush({}, { status: 500, statusText: 'Server error' });
    expect(failed).toBeNull();
    expect(service.configs()).toEqual([updated, other]);
  });

  it('does not corrupt local records when a successful response omits its data envelope', () => {
    let created: AIProviderConfig | null | undefined;
    service.createConfig(CONFIG).subscribe((value) => {
      created = value;
    });
    http.expectOne('/api/ai/configs').flush({ success: true });
    expect(created).toBeNull();
    expect(service.configs()).toEqual([]);

    service.loadConfigs();
    http.expectOne('/api/ai/configs').flush({ data: [CONFIG] });
    let updated: AIProviderConfig | null | undefined;
    service.updateConfig(CONFIG.id, { name: 'Malformed response' }).subscribe((value) => {
      updated = value;
    });
    http.expectOne(`/api/ai/configs/${CONFIG.id}`).flush({ success: true });
    expect(updated).toBeNull();
    expect(service.configs()).toEqual([CONFIG]);

    let testResult: unknown;
    service.testConnection({ configId: CONFIG.id }).subscribe((value) => {
      testResult = value;
    });
    http.expectOne('/api/ai/test-connection').flush({ success: true });
    expect(testResult).toBeNull();
  });

  it('deletes only on confirmation from the API and retains state on failure', () => {
    service.createConfig(CONFIG).subscribe();
    http.expectOne('/api/ai/configs').flush({ data: CONFIG });

    let deleted: boolean | undefined;
    service.deleteConfig(CONFIG.id).subscribe((result) => {
      deleted = result;
    });
    const request = http.expectOne(`/api/ai/configs/${CONFIG.id}`);
    expect(request.request.method).toBe('DELETE');
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush({ success: true });
    expect(deleted).toBeTrue();
    expect(service.configs()).toEqual([]);

    service.createConfig(CONFIG).subscribe();
    http.expectOne('/api/ai/configs').flush({ data: CONFIG });
    let failure: boolean | undefined;
    service.deleteConfig(CONFIG.id).subscribe((result) => {
      failure = result;
    });
    http
      .expectOne(`/api/ai/configs/${CONFIG.id}`)
      .flush({}, { status: 500, statusText: 'Server error' });
    expect(failure).toBeFalse();
    expect(service.configs()).toEqual([CONFIG]);
  });

  it('tests saved or unsaved connection details and normalizes HTTP errors', () => {
    let result: unknown;
    service.testConnection({ configId: CONFIG.id }).subscribe((value) => {
      result = value;
    });
    const savedRequest = http.expectOne('/api/ai/test-connection');
    expect(savedRequest.request.method).toBe('POST');
    expect(savedRequest.request.context.get(SILENT_TOAST)).toBeTrue();
    expect(savedRequest.request.body).toEqual({ configId: CONFIG.id });
    savedRequest.flush({ data: { success: true, model: 'gpt-test', latency: 10 } });
    expect(result).toEqual({ success: true, model: 'gpt-test', latency: 10 });

    service
      .testConnection({
        baseUrl: CONFIG.baseUrl,
        apiKey: CONFIG.apiKey,
        model: CONFIG.model,
        timeout: 30000
      })
      .subscribe((value) => {
        result = value;
      });
    const unsavedRequest = http.expectOne('/api/ai/test-connection');
    expect(unsavedRequest.request.body.configId).toBeUndefined();
    unsavedRequest.flush({
      data: { success: false, model: 'gpt-test', latency: 10, error: 'Synthetic failure' }
    });
    expect(result).toEqual({
      success: false,
      model: 'gpt-test',
      latency: 10,
      error: 'Synthetic failure'
    });

    service.testConnection({ configId: CONFIG.id }).subscribe((value) => {
      result = value;
    });
    http.expectOne('/api/ai/test-connection').flush({}, { status: 502, statusText: 'Bad gateway' });
    expect(result).toBeNull();
  });

  it('preserves usable drafts after a failed retry and clears the opposite result on success', () => {
    const request = {
      ingredients: [],
      utensils: [],
      servings: 2,
      difficulty: 'easy' as const,
      detailLevel: 'basic' as const,
      dietaryRestrictions: [],
      allergies: [],
      preferences: []
    };
    const recipe: AIRecipeResponse = {
      name: 'Synthetic recipe',
      description: 'Fixture only',
      difficulty: 'easy',
      cuisine: null,
      totalTime: 20,
      prepTime: 10,
      cookTime: 10,
      restTime: null,
      baseServings: 1,
      calories: null,
      ingredients: [],
      utensils: [],
      guidance: {
        appliances: [],
        parallelTasks: [],
        tipsAndVariations: [],
        batchCookingWarning: null
      },
      instructionsByLevel: {
        basic: [recipeStep('Cocer.')],
        intermediate: [recipeStep('Cortar y cocer.')],
        expert: [recipeStep('Cocer a hervor suave.')]
      },
      tags: [],
      nutrition: null,
      storage: null
    };

    service.generateRecipe(request).subscribe();
    expect(service.isGenerating()).toBeTrue();
    const generatedRequest = http.expectOne('/api/ai/generate-recipe');
    expect(generatedRequest.request.context.get(SILENT_TOAST)).toBeTrue();
    generatedRequest.flush({ data: recipe });
    expect(service.generatedRecipe()).toEqual(recipe);
    expect(service.isGenerating()).toBeFalse();

    service.generateRecipe(request).subscribe((result) => expect(result).toBeNull());
    const failedGenerationRequest = http.expectOne('/api/ai/generate-recipe');
    expect(failedGenerationRequest.request.context.get(SILENT_TOAST)).toBeTrue();
    failedGenerationRequest.flush({}, { status: 500, statusText: 'Server error' });
    expect(service.generatedRecipe()).toEqual(recipe);
    expect(service.generatedRecipes()).toEqual([]);
    expect(service.isGenerating()).toBeFalse();

    service.generateMultipleRecipes(request).subscribe();
    const generatedMultipleRequest = http.expectOne('/api/ai/generate-multiple-recipes');
    expect(generatedMultipleRequest.request.context.get(SILENT_TOAST)).toBeTrue();
    generatedMultipleRequest.flush({ data: [recipe] });
    expect(service.generatedRecipe()).toBeNull();
    expect(service.generatedRecipes()).toEqual([recipe]);

    service.generateMultipleRecipes(request).subscribe((result) => expect(result).toBeNull());
    const failedMultipleRequest = http.expectOne('/api/ai/generate-multiple-recipes');
    expect(failedMultipleRequest.request.context.get(SILENT_TOAST)).toBeTrue();
    failedMultipleRequest.flush({}, { status: 500, statusText: 'Server error' });
    expect(service.generatedRecipes()).toEqual([recipe]);
    expect(service.isGenerating()).toBeFalse();

    service.clearGenerated();
    expect(service.generatedRecipe()).toBeNull();
    expect(service.generatedRecipes()).toEqual([]);
  });

  it('exposes recommendation and weekly-plan endpoints without reshaping their payloads', () => {
    const recommendationParams = { count: 3 };
    let recommendation: unknown;
    service.getRecommendations(recommendationParams).subscribe((value) => {
      recommendation = value;
    });
    const recommendationsRequest = http.expectOne('/api/ai/recommendations');
    expect(recommendationsRequest.request.body).toBe(recommendationParams);
    recommendationsRequest.flush({ data: ['synthetic'] });
    expect(recommendation).toEqual({ data: ['synthetic'] });

    const planParams = { startDate: '2026-01-01', endDate: '2026-01-07' };
    let plan: unknown;
    service.generateWeeklyPlan(planParams).subscribe((value) => {
      plan = value;
    });
    const planRequest = http.expectOne('/api/ai/plan-week');
    expect(planRequest.request.body).toBe(planParams);
    planRequest.flush({ data: { days: [] } });
    expect(plan).toEqual({ data: { days: [] } });
  });

  it('requests a scoped recipe improvement without mutating generated recipe state', () => {
    const request = {
      recipe: {
        name: 'Tortilla de patata',
        ingredients: [{ name: 'Patata', quantity: 2, unit: 'unit' }],
        steps: [{ stepNumber: 1, instruction: 'Dorar la patata.' }]
      },
      scopes: ['preparation']
    };
    const response = {
      proposal: { name: 'Propuesta sintética' },
      patch: { instructionsByLevel: { basic: [], intermediate: [], expert: [] } },
      scopes: ['preparation']
    };
    let result: unknown;

    service.improveRecipe(request as never).subscribe((value) => (result = value));

    const improveRequest = http.expectOne('/api/ai/improve-recipe');
    expect(improveRequest.request.method).toBe('POST');
    expect(improveRequest.request.body).toEqual(request);
    expect(improveRequest.request.context.get(SILENT_TOAST)).toBeTrue();
    expect(service.isImprovingRecipe()).toBeTrue();
    improveRequest.flush({ data: response });

    expect(result).toEqual(response);
    expect(service.isImprovingRecipe()).toBeFalse();
    expect(service.generatedRecipe()).toBeNull();
  });

  it('returns null and clears improving state when the request fails', () => {
    let result: unknown = 'pending';
    service.improveRecipe({ recipe: {} } as never).subscribe((value) => (result = value));
    const request = http.expectOne('/api/ai/improve-recipe');
    expect(service.isImprovingRecipe()).toBeTrue();
    request.flush({}, { status: 503, statusText: 'Unavailable' });
    expect(result).toBeNull();
    expect(service.isImprovingRecipe()).toBeFalse();
  });
});
