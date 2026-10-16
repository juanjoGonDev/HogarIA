import { HttpClient, HttpContext, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, type Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import type {
  AssistantActionCandidate,
  AssistantActionPlan,
  AssistantActionRefinementResult,
  AssistantActionRefinementScope,
  AssistantBatchRefinementResult,
  AssistantBatchRefinementScope,
  AssistantRouteHint
} from '../../shared/models/ai-action-assistant.model';
import { HouseholdService } from './household.service';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
}

@Injectable({ providedIn: 'root' })
export class AiActionAssistantService {
  private readonly apiUrl = `${environment.apiUrl}/ai/assistant`;
  private readonly http = inject(HttpClient);
  private readonly household = inject(HouseholdService);

  propose(input: { prompt: string; route?: AssistantRouteHint }): Observable<AssistantActionPlan> {
    return this.http
      .post<ApiResponse<AssistantActionPlan>>(`${this.apiUrl}/proposals`, input, {
        context: this.silentContext(),
        headers: this.householdHeaders()
      })
      .pipe(map((response) => this.requireData(response)));
  }

  refine(input: {
    actionId: string;
    instruction: string;
    action: AssistantActionCandidate;
    scope: AssistantActionRefinementScope;
  }): Observable<AssistantActionRefinementResult> {
    return this.http
      .post<ApiResponse<AssistantActionRefinementResult>>(`${this.apiUrl}/refine`, input, {
        context: this.silentContext(),
        headers: this.householdHeaders()
      })
      .pipe(map((response) => this.requireData(response)));
  }

  refineBatch(input: {
    instruction: string;
    actions: Array<{ actionId: string; action: AssistantActionCandidate }>;
    scope: AssistantBatchRefinementScope;
  }): Observable<AssistantBatchRefinementResult> {
    return this.http
      .post<ApiResponse<AssistantBatchRefinementResult>>(`${this.apiUrl}/refine-batch`, input, {
        context: this.silentContext(),
        headers: this.householdHeaders()
      })
      .pipe(map((response) => this.requireData(response)));
  }

  private requireData<T>(response: ApiResponse<T>): T {
    if (!response?.success || response.data === undefined) {
      throw new Error('AI assistant returned an invalid response');
    }
    return response.data;
  }

  private silentContext(): HttpContext {
    return new HttpContext().set(SILENT_TOAST, true);
  }

  private householdHeaders(): HttpHeaders {
    return new HttpHeaders({
      'x-assistant-household-id': this.household.activeHouseholdId() ?? ''
    });
  }
}
