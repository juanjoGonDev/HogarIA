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

export interface AssistantHouseholdMealProposalRequest extends HouseholdMealProposalRequest {
  instructions: string;
}

export interface HouseholdMealProposalIngredient {
  name: string;
  quantity: number;
  unit: string;
  preparation: string | null;
  isOptional: boolean;
  substitutes: string[];
  notes: string | null;
}

export interface HouseholdMealRecipeInstructionStep {
  stepNumber: number;
  instruction: string;
  temperature?: { value: number; unit: 'C' | 'F' } | null;
  timerRequired?: boolean;
  timerDuration?: number | null;
  duration?: number | null;
  tips?: string | null;
  warning?: string | null;
  illustration?: unknown;
}

export type HouseholdMealRecipeInstructionLevel = 'basic' | 'intermediate' | 'expert';

export interface HouseholdMealProposalRecipeInstructionsByLevel {
  basic: HouseholdMealRecipeInstructionStep[];
  intermediate: HouseholdMealRecipeInstructionStep[];
  expert: HouseholdMealRecipeInstructionStep[];
}

export interface HouseholdMealProposalRecipe {
  name: string;
  description: string;
  baseServings: number;
  difficulty: 'easy' | 'medium' | 'hard';
  cuisine: string | null;
  totalTime: number;
  prepTime: number;
  cookTime: number;
  restTime: number | null;
  calories: number | null;
  ingredients: HouseholdMealProposalIngredient[];
  utensils: string[];
  guidance: {
    appliances: string[];
    parallelTasks: string[];
    tipsAndVariations: string[];
    batchCookingWarning: string | null;
  };
  instructionsByLevel?: HouseholdMealProposalRecipeInstructionsByLevel;
  /** Saved catalog recipes can still use the editor's historical flat-step shape. */
  steps?: HouseholdMealRecipeInstructionStep[] | null;
  nutrition: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber: number | null;
  } | null;
  storage: {
    method: string;
    duration: string;
    reheatingInstructions: string | null;
    container: string | null;
    freezingPossible: boolean;
    freezingDuration: string | null;
  } | null;
  tags: string[];
}

export interface HouseholdMealProposalRecipeReference {
  alias: string;
  source: 'catalog' | 'new';
  recipeId: string | null;
  recipe: HouseholdMealProposalRecipe;
}

export interface HouseholdMealProposalEvent {
  id: string;
  date: string;
  mealType: MealType;
  time: string | null;
  recipeAlias: string | null;
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
  recipes: HouseholdMealProposalRecipeReference[];
  events: HouseholdMealProposalEvent[];
}

export interface HouseholdMealProposalConfirmRequest extends HouseholdMealProposalRequest {
  proposalId: string;
  recipes: HouseholdMealProposalRecipeReference[];
  events: HouseholdMealProposalEvent[];
}

export interface AssistantHouseholdMealProposalRefinementRequest extends HouseholdMealProposalConfirmRequest {
  instructions: string;
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
  private readonly assistantApiUrl = `${environment.apiUrl}/ai/assistant/meal-proposals`;
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

  createAssistantProposal(
    householdId: string,
    request: AssistantHouseholdMealProposalRequest
  ): Observable<HouseholdMealProposal> {
    return this.http
      .post<ApiEnvelope<HouseholdMealProposal>>(`${this.assistantApiUrl}`, request, {
        headers: this.assistantHouseholdHeaders(householdId),
        context: this.silentContext
      })
      .pipe(map((response) => this.requireData(response)));
  }

  refineAssistantProposal(
    householdId: string,
    request: AssistantHouseholdMealProposalRefinementRequest
  ): Observable<HouseholdMealProposal> {
    return this.http
      .post<ApiEnvelope<HouseholdMealProposal>>(`${this.assistantApiUrl}/refine`, request, {
        headers: this.assistantHouseholdHeaders(householdId),
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

  private assistantHouseholdHeaders(householdId: string): HttpHeaders {
    return new HttpHeaders({ 'x-assistant-household-id': householdId });
  }

  private requireData<T>(response: ApiEnvelope<T>): T {
    if (response.success !== true || response.data === undefined) {
      throw new Error('INVALID_MEAL_PROPOSAL_RESPONSE');
    }
    return response.data;
  }
}
