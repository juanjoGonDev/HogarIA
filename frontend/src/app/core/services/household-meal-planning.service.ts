import { HttpClient, HttpContext, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { MealType, MealPlan, MealTimes } from '../../shared/models/calendar.model';
import type { TasteGoal } from '../../shared/models/taste-profile';
import { SILENT_TOAST } from '../interceptors/error.interceptor';

export interface MealPlanningObjective {
  goals: TasteGoal[];
  notes: string;
}

export interface MealPlanningSchedule {
  mealTypes: MealPlan;
  mealTimes: MealTimes;
}

export interface HouseholdMealPlanningSettings {
  household: MealPlanningSchedule & { objective: MealPlanningObjective };
  member: {
    goalOverrideEnabled: boolean;
    scheduleOverrideEnabled: boolean;
    personalObjective: MealPlanningObjective;
    personalSchedule: MealPlanningSchedule;
  };
  effective: {
    objective: MealPlanningObjective & { source: 'household' | 'member' };
    schedule: MealPlanningSchedule & { source: 'household' | 'member' };
  };
}

type PartialMealPlan = Partial<Record<MealType, boolean>>;
type PartialMealTimes = Partial<Record<MealType, string>>;

export interface HouseholdMealPlanningPatch {
  household?: {
    objective?: Partial<MealPlanningObjective>;
    mealTypes?: PartialMealPlan;
    mealTimes?: PartialMealTimes;
  };
  member?: {
    goalOverrideEnabled?: boolean;
    scheduleOverrideEnabled?: boolean;
    schedule?: {
      mealTypes?: PartialMealPlan;
      mealTimes?: PartialMealTimes;
    };
  };
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class HouseholdMealPlanningService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/household/meal-planning`;
  private readonly silentContext = new HttpContext().set(SILENT_TOAST, true);

  load(householdId: string): Observable<HouseholdMealPlanningSettings> {
    return this.http
      .get<ApiEnvelope<HouseholdMealPlanningSettings>>(this.apiUrl, {
        headers: this.householdHeaders(householdId),
        context: this.silentContext
      })
      .pipe(map((response) => response.data));
  }

  save(
    householdId: string,
    patch: HouseholdMealPlanningPatch
  ): Observable<HouseholdMealPlanningSettings> {
    return this.http
      .patch<ApiEnvelope<HouseholdMealPlanningSettings>>(this.apiUrl, patch, {
        headers: this.householdHeaders(householdId),
        context: this.silentContext
      })
      .pipe(map((response) => response.data));
  }

  private householdHeaders(householdId: string): HttpHeaders {
    return new HttpHeaders({ 'x-household-id': householdId });
  }
}
