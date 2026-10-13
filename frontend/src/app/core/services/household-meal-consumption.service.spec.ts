import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HouseholdMealConsumptionService } from './household-meal-consumption.service';

describe('HouseholdMealConsumptionService', () => {
  let service: HouseholdMealConsumptionService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(HouseholdMealConsumptionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the latest assigned-meal status and version in the active household', () => {
    let result: unknown;
    service.load('meal-1', 'home-1').subscribe((value) => (result = value));

    const request = http.expectOne('/api/household/meal-planning/meals/meal-1/consumption');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('x-household-id')).toBe('home-1');
    request.flush({
      success: true,
      data: {
        mealId: 'meal-1',
        status: 'unrecorded',
        servings: null,
        version: 0,
        warnings: []
      }
    });
    expect(result).toEqual({
      mealId: 'meal-1',
      status: 'unrecorded',
      servings: null,
      version: 0,
      warnings: []
    });
  });

  it('sends an absolute realized serving count and expected version', () => {
    let result: unknown;
    service
      .save('meal-1', 'home-1', { status: 'realized', servings: 3, expectedVersion: 2 })
      .subscribe((value) => (result = value));

    const request = http.expectOne('/api/household/meal-planning/meals/meal-1/consumption');
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('x-household-id')).toBe('home-1');
    expect(request.request.body).toEqual({
      status: 'realized',
      servings: 3,
      expectedVersion: 2
    });
    request.flush({
      success: true,
      data: { mealId: 'meal-1', status: 'realized', servings: 3, version: 3, warnings: [] }
    });
    expect(result).toEqual({
      mealId: 'meal-1',
      status: 'realized',
      servings: 3,
      version: 3,
      warnings: []
    });
  });

  it('sends zero servings for a meal that was not realized', () => {
    service
      .save('meal-1', 'home-1', { status: 'not_realized', servings: 0, expectedVersion: 0 })
      .subscribe();
    const request = http.expectOne('/api/household/meal-planning/meals/meal-1/consumption');
    expect(request.request.body).toEqual({
      status: 'not_realized',
      servings: 0,
      expectedVersion: 0
    });
    request.flush({
      success: true,
      data: { mealId: 'meal-1', status: 'not_realized', servings: 0, version: 1, warnings: [] }
    });
  });
});
