import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { AiProviderAvailabilityService } from './ai-provider-availability.service';
import { HouseholdService } from './household.service';

describe('AiProviderAvailabilityService', () => {
  let service: AiProviderAvailabilityService;
  let http: HttpTestingController;
  let contextRevision: ReturnType<typeof signal<number>>;

  beforeEach(() => {
    contextRevision = signal(0);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: HouseholdService, useValue: { contextRevision } }
      ]
    });
    service = TestBed.inject(AiProviderAvailabilityService);
    TestBed.flushEffects();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('deduplicates availability reads and exposes only configured function flags', () => {
    const first: unknown[] = [];
    const second: unknown[] = [];
    service.load().subscribe((value) => first.push(value));
    service.load().subscribe((value) => second.push(value));

    const request = http.expectOne('/api/ai/availability');
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush({
      data: {
        hasActiveProvider: true,
        functions: { assistant: false, recipes: true },
        requiresHouseholdSelection: false
      }
    });

    expect(first[0]).toEqual(service.availability());
    expect(second[0]).toEqual(service.availability());
    expect(service.hasActiveProvider()).toBeTrue();
    expect(service.isConfigured('assistant')).toBeFalse();
    expect(service.isConfigured('recipes')).toBeTrue();
    expect(service.isConfigured('planning')).toBeFalse();
  });

  it('refreshes after a mutation and treats an unavailable response as unknown', () => {
    service.load().subscribe();
    http.expectOne('/api/ai/availability').flush({
      data: {
        hasActiveProvider: true,
        functions: { assistant: true },
        requiresHouseholdSelection: false
      }
    });
    expect(service.hasActiveProvider()).toBeTrue();

    service.load(true).subscribe((value) => expect(value).toBeNull());
    http.expectOne('/api/ai/availability').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(service.availability()).toBeNull();
    expect(service.hasActiveProvider()).toBeFalse();
    expect(service.isConfigured('assistant')).toBeNull();
  });

  it('opens and closes the setup request without changing provider state', () => {
    service.openSetup('planning');
    expect(service.setupFunction()).toBe('planning');

    service.closeSetup();
    expect(service.setupFunction()).toBeNull();
    expect(service.availability()).toBeNull();
  });

  it('invalidates function availability when the active household scope changes', () => {
    service.load().subscribe();
    http.expectOne('/api/ai/availability').flush({
      data: {
        hasActiveProvider: true,
        functions: { assistant: true },
        requiresHouseholdSelection: false
      }
    });
    expect(service.isConfigured('assistant')).toBeTrue();

    contextRevision.set(1);
    TestBed.flushEffects();
    expect(service.availability()).toBeNull();
    const refreshed = http.expectOne('/api/ai/availability');
    refreshed.flush({
      data: {
        hasActiveProvider: false,
        functions: { assistant: false },
        requiresHouseholdSelection: false
      }
    });
    expect(service.isConfigured('assistant')).toBeFalse();
  });
});
