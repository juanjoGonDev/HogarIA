import { HttpClient, HttpContext, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SILENT_TOAST } from '../interceptors/error.interceptor';

export type HouseholdMealShoppingStockStatus =
  'matched' | 'not_found' | 'ambiguous' | 'unit_mismatch' | 'pantry_not_shared';

export interface HouseholdMealShoppingIngredient {
  name: string;
  unit: string;
  quantity: number;
  stockQuantity: number | null;
  missingQuantity: number | null;
  status: HouseholdMealShoppingStockStatus;
}

export interface HouseholdMealShoppingPreview {
  startDate: string;
  endDate: string;
  previewId: string;
  sharedPantry: boolean;
  plannedMealCount: number;
  requiredIngredients: HouseholdMealShoppingIngredient[];
  optionalIngredients: HouseholdMealShoppingIngredient[];
  warnings: Array<{ code: 'RECIPE_SNAPSHOT_UNAVAILABLE'; date: string }>;
}

export interface HouseholdMealShoppingApprovalRequest {
  startDate: string;
  endDate: string;
  previewId: string;
  items: Array<{ name: string; unit: string; quantity: number }>;
}

export interface HouseholdMealShoppingApproval {
  listId: string | null;
  version: number | null;
  created: boolean;
  idempotent: boolean;
  added: number;
  updated: number;
  removed: number;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
}

@Injectable({ providedIn: 'root' })
export class HouseholdMealShoppingService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/household/meal-planning`;
  private readonly shoppingUrl = `${environment.apiUrl}/shopping`;
  private readonly silentContext = new HttpContext().set(SILENT_TOAST, true);

  loadPreview(
    householdId: string,
    startDate: string,
    endDate: string
  ): Observable<HouseholdMealShoppingPreview> {
    const params = new HttpParams().set('startDate', startDate).set('endDate', endDate);
    return this.http
      .get<ApiEnvelope<HouseholdMealShoppingPreview>>(
        `${this.apiUrl}/shopping-preview`,
        this.options(householdId, params)
      )
      .pipe(map((response) => this.requireData(response)));
  }

  approve(
    householdId: string,
    request: HouseholdMealShoppingApprovalRequest
  ): Observable<HouseholdMealShoppingApproval> {
    return this.http
      .post<ApiEnvelope<HouseholdMealShoppingApproval>>(
        `${this.shoppingUrl}/meal-plan/approve`,
        request,
        this.options(householdId)
      )
      .pipe(map((response) => this.requireData(response)));
  }

  private options(householdId: string, params?: HttpParams) {
    return {
      headers: new HttpHeaders({ 'x-household-id': householdId }),
      context: this.silentContext,
      ...(params ? { params } : {})
    };
  }

  private requireData<T>(response: ApiEnvelope<T>): T {
    if (response.success !== true || response.data === undefined) {
      throw new Error('INVALID_MEAL_SHOPPING_RESPONSE');
    }
    return response.data;
  }
}
