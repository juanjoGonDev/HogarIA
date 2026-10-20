import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { AiFunctionKey } from '../../shared/models/ai-config.model';
import { aiFunctionForRequest, aiProviderGateInterceptor } from './ai-provider-gate.interceptor';
import { AiProviderAvailabilityService } from '../services/ai-provider-availability.service';

describe('aiFunctionForRequest', () => {
  it('maps all known AI generation entry points to their assigned function', () => {
    const cases: Array<[string, string, AiFunctionKey]> = [
      ['POST', '/api/ai/assistant/proposals', 'assistant'],
      ['POST', '/api/ai/assistant/meal-proposals/refine', 'assistant'],
      ['POST', '/api/ai/generate-recipe', 'recipes'],
      ['POST', '/api/ai/recommendations', 'recipes'],
      ['POST', '/api/household/meal-planning/proposal', 'planning'],
      ['POST', '/api/ai/plan-week', 'planning'],
      ['POST', '/api/pantry/expiry/estimate', 'shopping_pantry'],
      ['POST', '/api/shopping/lists/synthetic-list/photo/analyze', 'shopping_pantry'],
      ['POST', '/api/receipts', 'shopping_pantry'],
      ['POST', '/api/receipts/synthetic-receipt/retry', 'shopping_pantry']
    ];

    for (const [method, path, functionKey] of cases) {
      expect(aiFunctionForRequest(method, path)).withContext(path).toBe(functionKey);
    }
  });

  it('does not gate reads, mutations, or unrelated POST endpoints', () => {
    expect(aiFunctionForRequest('GET', '/api/ai/generate-recipe')).toBeNull();
    expect(aiFunctionForRequest('PATCH', '/api/ai/configs/synthetic')).toBeNull();
    expect(aiFunctionForRequest('POST', '/api/recipes')).toBeNull();
    expect(aiFunctionForRequest('POST', '/api/ai/assistant/not-a-route')).toBeNull();
  });
});

describe('aiProviderGateInterceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  let availability: AiProviderAvailabilityService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([aiProviderGateInterceptor])),
        provideHttpClientTesting()
      ]
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    availability = TestBed.inject(AiProviderAvailabilityService);
  });

  afterEach(() => http.verify());

  it('opens setup and suppresses a generation request when its function is unassigned', () => {
    let completed = false;
    client.post('/api/ai/generate-recipe', { prompt: 'synthetic' }).subscribe({
      complete: () => (completed = true)
    });
    http.expectOne('/api/ai/availability').flush({
      data: {
        hasActiveProvider: true,
        functions: { recipes: false },
        requiresHouseholdSelection: false
      }
    });

    expect(availability.setupFunction()).toBe('recipes');
    expect(completed).toBeTrue();
    http.expectNone('/api/ai/generate-recipe');
  });

  it('continues to the API when the requested function has a provider', () => {
    let response: unknown;
    client.post('/api/ai/assistant/proposals', { prompt: 'synthetic' }).subscribe((value) => {
      response = value;
    });
    http.expectOne('/api/ai/availability').flush({
      data: {
        hasActiveProvider: true,
        functions: { assistant: true },
        requiresHouseholdSelection: false
      }
    });
    http.expectOne('/api/ai/assistant/proposals').flush({ success: true });

    expect(response).toEqual({ success: true });
    expect(availability.setupFunction()).toBeNull();
  });

  it('fails open when availability is unknown, leaving the server guard authoritative', () => {
    let response: unknown;
    client.post('/api/receipts', {}).subscribe((value) => (response = value));
    http.expectOne('/api/ai/availability').flush({}, { status: 503, statusText: 'Unavailable' });
    http.expectOne('/api/receipts').flush({ success: true });

    expect(response).toEqual({ success: true });
  });
});
