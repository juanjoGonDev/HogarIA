import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  HouseholdMealShoppingService,
  type HouseholdMealShoppingApprovalRequest,
  type HouseholdMealShoppingPreview
} from './household-meal-shopping.service';

describe('HouseholdMealShoppingService', () => {
  let service: HouseholdMealShoppingService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(HouseholdMealShoppingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the read-only household preview with a bounded range and household scope', () => {
    const preview: HouseholdMealShoppingPreview = {
      startDate: '2026-10-13',
      endDate: '2026-11-12',
      previewId: 'a'.repeat(64),
      sharedPantry: true,
      plannedMealCount: 2,
      requiredIngredients: [],
      optionalIngredients: [],
      warnings: []
    };
    let result: HouseholdMealShoppingPreview | undefined;
    service.loadPreview('home-1', preview.startDate, preview.endDate).subscribe((value) => {
      result = value;
    });

    const request = http.expectOne(
      '/api/household/meal-planning/shopping-preview?startDate=2026-10-13&endDate=2026-11-12'
    );
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('x-household-id')).toBe('home-1');
    request.flush({ success: true, data: preview });
    expect(result).toEqual(preview);
  });

  it('sends only the explicit edited selection to Compra approval', () => {
    const input: HouseholdMealShoppingApprovalRequest = {
      startDate: '2026-10-14',
      endDate: '2026-11-13',
      previewId: 'b'.repeat(64),
      items: [{ name: 'Arroz', unit: 'g', quantity: 180 }]
    };
    let listId: string | null | undefined;
    service.approve('home-2', input).subscribe((value) => (listId = value.listId));

    const request = http.expectOne('/api/shopping/meal-plan/approve');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('x-household-id')).toBe('home-2');
    expect(request.request.body).toEqual(input);
    request.flush({
      success: true,
      data: {
        listId: 'shopping-list-id',
        version: 2,
        created: false,
        idempotent: false,
        added: 0,
        updated: 1,
        removed: 0
      }
    });
    expect(listId).toBe('shopping-list-id');
  });
});
