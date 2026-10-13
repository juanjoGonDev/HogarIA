import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  HouseholdMealPlanningService,
  type HouseholdMealPlanningPatch,
  type HouseholdMealPlanningSettings
} from './household-meal-planning.service';

describe('HouseholdMealPlanningService', () => {
  let service: HouseholdMealPlanningService;
  let http: HttpTestingController;

  const settings: HouseholdMealPlanningSettings = {
    household: {
      objective: { goals: ['balanced'], notes: '' },
      mealTypes: { breakfast: true, lunch: true, snack: true, dinner: true },
      mealTimes: { breakfast: '09:00', lunch: '14:00', snack: '17:00', dinner: '20:30' }
    },
    member: {
      goalOverrideEnabled: false,
      scheduleOverrideEnabled: false,
      personalObjective: { goals: ['variety'], notes: 'Sin repeticiones' },
      personalSchedule: {
        mealTypes: { breakfast: true, lunch: true, snack: false, dinner: true },
        mealTimes: { breakfast: '08:00', lunch: '13:30', snack: '17:00', dinner: '21:00' }
      }
    },
    effective: {
      objective: { goals: ['balanced'], notes: '', source: 'household' },
      schedule: {
        mealTypes: { breakfast: true, lunch: true, snack: true, dinner: true },
        mealTimes: { breakfast: '09:00', lunch: '14:00', snack: '17:00', dinner: '20:30' },
        source: 'household'
      }
    }
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(HouseholdMealPlanningService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads settings without caching and scopes the request to the selected home', () => {
    let result: HouseholdMealPlanningSettings | undefined;
    service.load('home-1').subscribe((value) => (result = value));

    const request = http.expectOne('/api/household/meal-planning');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('x-household-id')).toBe('home-1');
    expect(request.request.headers.get('Cache-Control')).toBeNull();
    request.flush({ success: true, data: settings });

    expect(result).toEqual(settings);
  });

  it('sends a minimal partial patch with the household scope header', () => {
    const patch: HouseholdMealPlanningPatch = {
      member: { scheduleOverrideEnabled: true }
    };
    let result: HouseholdMealPlanningSettings | undefined;
    service.save('home-2', patch).subscribe((value) => (result = value));

    const request = http.expectOne('/api/household/meal-planning');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.headers.get('x-household-id')).toBe('home-2');
    expect(request.request.body).toEqual(patch);
    request.flush({ success: true, data: settings });

    expect(result).toEqual(settings);
  });
});
