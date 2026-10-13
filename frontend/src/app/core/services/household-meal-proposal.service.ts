import { HttpClient, HttpContext, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { MealType } from '../../shared/models/calendar.model';
import { SILENT_TOAST } from '../interceptors/error.interceptor';

export interface HouseholdMealProposalRequest {
  weekStart: string;
  householdMemberIds: string[];
}

export interface HouseholdMealProposalIngredient {
  name: string;
  quantity: number;
  unit: string;
  preparation: string | null;
  isOptional: boolean;
  notes: string | null;
}

export interface HouseholdMealProposalRecipe {
  name: string;
  description: string;
  baseServings: 1;
  prepTimeMinutes: number;
  cookTimeMinutes: number;
  ingredients: HouseholdMealProposalIngredient[];
  instructions: string[];
}

export interface HouseholdMealProposalEvent {
  id: string;
  date: string;
  mealType: MealType;
  time: string | null;
  recipe: HouseholdMealProposalRecipe | null;
  participantAliases: string[];
  participantIds: string[];
  servings: number;
  objectiveSummary: string;
  status: 'scheduled' | 'unresolved';
  reason: string | null;
}

export interface HouseholdMealProposal {
  proposalId: string;
  weekStart: string;
  participants: Array<{ alias: string; householdMemberId: string }>;
  events: HouseholdMealProposalEvent[];
}

export interface HouseholdMealProposalConfirmRequest extends HouseholdMealProposalRequest {
  proposalId: string;
  events: HouseholdMealProposalEvent[];
}

export interface HouseholdMealProposalConfirmation {
  proposalId: string;
  weekStart: string;
  idempotent: boolean;
  events: Array<{
    id: string;
    proposalEventId: string;
    date: string;
    mealType: MealType;
    time: string | null;
    servings: number;
    participantIds: string[];
    recipeSnapshot: HouseholdMealProposalRecipe | null;
  }>;
  unresolvedEvents: HouseholdMealProposalEvent[];
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
}

@Injectable({ providedIn: 'root' })
export class HouseholdMealProposalService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/household/meal-planning`;
  private readonly silentContext = new HttpContext().set(SILENT_TOAST, true);

  createProposal(
    householdId: string,
    request: HouseholdMealProposalRequest
  ): Observable<HouseholdMealProposal> {
    return this.http
      .post<ApiEnvelope<HouseholdMealProposal>>(`${this.apiUrl}/proposal`, request, {
        headers: this.householdHeaders(householdId),
        context: this.silentContext
      })
      .pipe(map((response) => this.requireData(response)));
  }

  confirmProposal(
    householdId: string,
    request: HouseholdMealProposalConfirmRequest
  ): Observable<HouseholdMealProposalConfirmation> {
    return this.http
      .post<ApiEnvelope<HouseholdMealProposalConfirmation>>(`${this.apiUrl}/confirm`, request, {
        headers: this.householdHeaders(householdId),
        context: this.silentContext
      })
      .pipe(map((response) => this.requireData(response)));
  }

  private householdHeaders(householdId: string): HttpHeaders {
    return new HttpHeaders({ 'x-household-id': householdId });
  }

  private requireData<T>(response: ApiEnvelope<T>): T {
    if (response.success !== true || response.data === undefined) {
      throw new Error('INVALID_MEAL_PROPOSAL_RESPONSE');
    }
    return response.data;
  }
}
