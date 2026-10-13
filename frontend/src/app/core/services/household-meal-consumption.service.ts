import { HttpClient, HttpContext, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SILENT_TOAST } from '../interceptors/error.interceptor';

export type SharedMealConsumptionStatus = 'unrecorded' | 'realized' | 'not_realized';

export interface MealConsumptionWarning {
  code: string;
  ingredientName?: string;
  unit?: string;
}

export interface MealConsumptionRecord {
  mealId: string;
  status: SharedMealConsumptionStatus;
  servings: number | null;
  version: number;
  warnings: MealConsumptionWarning[];
  idempotent?: boolean;
}

export type MealConsumptionInput =
  | { status: 'realized'; servings: number; expectedVersion: number }
  | { status: 'not_realized'; servings: 0; expectedVersion: number };

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class HouseholdMealConsumptionService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/household/meal-planning/meals`;
  private readonly silentContext = new HttpContext().set(SILENT_TOAST, true);

  load(mealId: string, householdId: string): Observable<MealConsumptionRecord> {
    return this.http
      .get<ApiEnvelope<MealConsumptionRecord>>(this.url(mealId), {
        headers: this.householdHeaders(householdId),
        context: this.silentContext
      })
      .pipe(map((response) => response.data));
  }

  save(
    mealId: string,
    householdId: string,
    input: MealConsumptionInput
  ): Observable<MealConsumptionRecord> {
    return this.http
      .put<ApiEnvelope<MealConsumptionRecord>>(this.url(mealId), input, {
        headers: this.householdHeaders(householdId),
        context: this.silentContext
      })
      .pipe(map((response) => response.data));
  }

  private url(mealId: string): string {
    return `${this.apiUrl}/${encodeURIComponent(mealId)}/consumption`;
  }

  private householdHeaders(householdId: string): HttpHeaders {
    return new HttpHeaders({ 'x-household-id': householdId });
  }
}
