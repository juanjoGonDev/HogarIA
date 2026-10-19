import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MealPlan, MealTimes } from '../meal-times';
import { emptyTasteProfile, TasteResponse } from '../../shared/models/taste-profile';
import { environment } from '../../../environments/environment';
import { TasteProfileService } from './taste-profile.service';
import { SILENT_TOAST } from '../interceptors/error.interceptor';

const TASTE_URL = `${environment.apiUrl}/auth/taste`;

function response(data: Partial<TasteResponse> | null): { data: TasteResponse | null } {
  return { data: data as TasteResponse | null };
}

function completeResponse(overrides: Partial<TasteResponse> = {}): TasteResponse {
  return {
    taste: emptyTasteProfile(),
    onboarding: { status: 'pending', completedAt: null },
    ...overrides
  };
}

describe('TasteProfileService', () => {
  let service: TasteProfileService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [TasteProfileService]
    });

    service = TestBed.inject(TasteProfileService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('starts with safe defaults and reports an empty taste profile', () => {
    expect(service.taste()).toEqual(emptyTasteProfile());
    expect(service.onboarding()).toEqual({ status: 'pending', completedAt: null });
    expect(service.profile()).toEqual({ cookingLevel: 'beginner', modules: [] });
    expect(service.mealTimes()).toEqual({
      breakfast: '09:00',
      lunch: '14:00',
      snack: '17:00',
      dinner: '20:30'
    });
    expect(service.mealPlan()).toEqual({ breakfast: true, lunch: true, snack: true, dinner: true });
    expect(service.isLoading()).toBeFalse();
    expect(service.isLoaded()).toBeFalse();
    expect(service.hasProfile()).toBeFalse();
  });

  it('loads once when multiple consumers call ensureLoaded and skips after success', () => {
    service.ensureLoaded();
    service.ensureLoaded();

    expect(service.isLoading()).toBeTrue();
    const request = httpMock.expectOne(TASTE_URL);
    expect(request.request.method).toBe('GET');
    request.flush(response(completeResponse()));

    expect(service.isLoading()).toBeFalse();
    expect(service.isLoaded()).toBeTrue();
    service.ensureLoaded();
    httpMock.expectNone(TASTE_URL);
  });

  it('applies normalized taste, household profile, onboarding, meal times, and meal plan', () => {
    service.load().subscribe();
    expect(service.isLoading()).toBeTrue();

    const request = httpMock.expectOne(TASTE_URL);
    request.flush(
      response({
        taste: {
          goal: 'variety',
          likes: ['Pollo']
        } as unknown as TasteResponse['taste'],
        onboarding: { status: 'done', completedAt: '2026-01-02T10:00:00.000Z' },
        profile: {
          cookingLevel: 'expert',
          modules: ['home', 'pantry', 'pantry', 'not-a-module']
        } as unknown as TasteResponse['profile'],
        mealTimes: {
          breakfast: ' 07:30 ',
          lunch: 'not-a-time',
          dinner: null
        },
        mealPlan: {
          breakfast: false,
          lunch: 'false',
          dinner: false
        } as unknown as TasteResponse['mealPlan']
      })
    );

    expect(service.taste()).toEqual({
      ...emptyTasteProfile(),
      goals: ['variety'],
      likes: ['Pollo']
    });
    expect(service.hasProfile()).toBeTrue();
    expect(service.onboarding()).toEqual({
      status: 'done',
      completedAt: '2026-01-02T10:00:00.000Z'
    });
    expect(service.profile()).toEqual({ cookingLevel: 'expert', modules: ['pantry', 'home'] });
    expect(service.mealTimes()).toEqual({
      breakfast: '07:30',
      lunch: '14:00',
      snack: '17:00',
      dinner: '20:30'
    });
    expect(service.mealPlan()).toEqual({
      breakfast: false,
      lunch: true,
      snack: true,
      dinner: false
    });
    expect(service.isLoaded()).toBeTrue();
    expect(service.isLoading()).toBeFalse();
  });

  it('uses response defaults and preserves optional state when fields are omitted', () => {
    const previousTimes: MealTimes = {
      breakfast: '08:15',
      lunch: '13:15',
      snack: '16:15',
      dinner: '19:15'
    };
    const previousPlan: MealPlan = {
      breakfast: false,
      lunch: true,
      snack: false,
      dinner: true
    };
    service.mealTimes.set(previousTimes);
    service.mealPlan.set(previousPlan);

    service.load().subscribe();
    httpMock.expectOne(TASTE_URL).flush(response({}));

    expect(service.taste()).toEqual(emptyTasteProfile());
    expect(service.onboarding()).toEqual({ status: 'pending', completedAt: null });
    expect(service.profile()).toEqual({ cookingLevel: 'beginner', modules: [] });
    expect(service.mealTimes()).toEqual(previousTimes);
    expect(service.mealPlan()).toEqual(previousPlan);
    expect(service.isLoaded()).toBeTrue();
    expect(service.isLoading()).toBeFalse();
  });

  it('ignores a null profile payload without marking the profile loaded', () => {
    service.load().subscribe();
    httpMock.expectOne(TASTE_URL).flush(response(null));

    expect(service.isLoaded()).toBeFalse();
    expect(service.isLoading()).toBeFalse();
    expect(service.taste()).toEqual(emptyTasteProfile());
  });

  it('clears loading after a load error and permits a later retry', () => {
    let receivedError: unknown;
    service.load().subscribe({ error: (error) => (receivedError = error) });

    const failedRequest = httpMock.expectOne(TASTE_URL);
    expect(service.isLoading()).toBeTrue();
    failedRequest.flush('unavailable', { status: 503, statusText: 'Service Unavailable' });

    expect(receivedError).toBeTruthy();
    expect(service.isLoading()).toBeFalse();
    expect(service.isLoaded()).toBeFalse();

    service.ensureLoaded();
    service.ensureLoaded();
    expect(service.isLoading()).toBeTrue();
    httpMock.expectOne(TASTE_URL).flush(response(completeResponse()));
    expect(service.isLoaded()).toBeTrue();
    expect(service.isLoading()).toBeFalse();
  });

  it('swallows ensureLoaded errors, clears loading, and retries on the next call', () => {
    service.ensureLoaded();
    httpMock
      .expectOne(TASTE_URL)
      .flush('network error', { status: 0, statusText: 'Unknown Error' });

    expect(service.isLoading()).toBeFalse();
    expect(service.isLoaded()).toBeFalse();

    service.ensureLoaded();
    httpMock.expectOne(TASTE_URL).flush(response(completeResponse()));
    expect(service.isLoaded()).toBeTrue();
    expect(service.isLoading()).toBeFalse();
  });

  it('sends only taste in a minimal PATCH and applies the successful response', () => {
    const taste = { notes: 'Sin cilantro' };
    let result: TasteResponse | undefined;
    service.save(taste).subscribe((value) => (result = value));

    expect(service.isLoading()).toBeTrue();
    const request = httpMock.expectOne(TASTE_URL);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ taste });
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();

    const saved = completeResponse({
      taste: { ...emptyTasteProfile(), notes: 'Sin cilantro' }
    });
    request.flush(response(saved));

    expect(result).toEqual(saved);
    expect(service.taste().notes).toBe('Sin cilantro');
    expect(service.isLoaded()).toBeTrue();
    expect(service.isLoading()).toBeFalse();
  });

  it('includes every supplied optional field in a complete PATCH', () => {
    const patch = {
      taste: { goals: ['muscle-gain' as const], allergies: ['Gluten'] },
      onboardingStatus: 'done' as const,
      profile: { cookingLevel: 'expert' as const, modules: [] },
      mealTimes: { breakfast: '06:30', dinner: null },
      mealPlan: { lunch: false, snack: true }
    };
    service
      .save(patch.taste, patch.onboardingStatus, patch.profile, patch.mealTimes, patch.mealPlan)
      .subscribe();

    const request = httpMock.expectOne(TASTE_URL);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({
      taste: patch.taste,
      onboardingStatus: patch.onboardingStatus,
      cookingLevel: patch.profile.cookingLevel,
      modules: patch.profile.modules,
      mealTimes: patch.mealTimes,
      mealPlan: patch.mealPlan
    });
    request.flush(
      response(
        completeResponse({
          taste: { ...emptyTasteProfile(), ...patch.taste },
          onboarding: { status: 'done', completedAt: '2026-02-03T11:00:00.000Z' },
          profile: { ...patch.profile },
          mealTimes: { breakfast: '06:30', dinner: null },
          mealPlan: { lunch: false, snack: true }
        })
      )
    );

    expect(service.isLoading()).toBeFalse();
    expect(service.taste().goals).toEqual(['muscle-gain']);
    expect(service.profile()).toEqual({ cookingLevel: 'expert', modules: [] });
    expect(service.mealTimes().breakfast).toBe('06:30');
    expect(service.mealTimes().dinner).toBe('20:30');
    expect(service.mealPlan()).toEqual({
      breakfast: true,
      lunch: false,
      snack: true,
      dinner: true
    });
  });

  it('omits absent nested profile fields and clears loading when PATCH fails', () => {
    let receivedError: unknown;
    service
      .save({ notes: 'Retry later' }, undefined, {}, undefined, undefined)
      .subscribe({ error: (error) => (receivedError = error) });

    const request = httpMock.expectOne(TASTE_URL);
    expect(request.request.body).toEqual({ taste: { notes: 'Retry later' } });
    expect(service.isLoading()).toBeTrue();
    request.flush('conflict', { status: 409, statusText: 'Conflict' });

    expect(receivedError).toBeTruthy();
    expect(service.isLoading()).toBeFalse();
    expect(service.isLoaded()).toBeFalse();
  });
});
