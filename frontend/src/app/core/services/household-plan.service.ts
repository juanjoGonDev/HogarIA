import { HttpClient, HttpContext, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import type {
  HouseholdPlan,
  HouseholdPlanProposal,
  VersionedHouseholdPlan
} from '../../shared/models/household-plan.model';
import { SILENT_TOAST } from '../interceptors/error.interceptor';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class HouseholdPlanService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/household/plan`;
  private readonly silentContext = new HttpContext().set(SILENT_TOAST, true);

  load(householdId: string): Observable<VersionedHouseholdPlan> {
    return this.http
      .get<ApiEnvelope<VersionedHouseholdPlan>>(this.apiUrl, {
        headers: this.householdHeaders(householdId),
        context: this.silentContext
      })
      .pipe(map((response) => response.data));
  }

  save(
    householdId: string,
    baseVersion: number,
    plan: HouseholdPlan,
    confirmOrphanedTaskIds: readonly string[] = []
  ): Observable<VersionedHouseholdPlan> {
    const body = {
      baseVersion,
      plan,
      ...(confirmOrphanedTaskIds.length ? { confirmOrphanedTaskIds } : {})
    };
    return this.http
      .put<ApiEnvelope<VersionedHouseholdPlan>>(this.apiUrl, body, {
        headers: this.householdHeaders(householdId),
        context: this.silentContext
      })
      .pipe(map((response) => response.data));
  }

  propose(input: {
    householdId: string;
    baseVersion: number;
    prompt?: string;
    attachment?: File | null;
    draftPlan?: HouseholdPlan | null;
  }): Observable<HouseholdPlanProposal> {
    const attachment = input.attachment;
    const body = attachment ? this.toFormData({ ...input, attachment }) : this.toJson(input);
    return this.http
      .post<ApiEnvelope<HouseholdPlanProposal>>(`${this.apiUrl}/proposal`, body, {
        headers: this.householdHeaders(input.householdId),
        context: this.silentContext
      })
      .pipe(map((response) => response.data));
  }

  private toJson(input: {
    baseVersion: number;
    prompt?: string;
    draftPlan?: HouseholdPlan | null;
  }): Record<string, unknown> {
    return {
      baseVersion: input.baseVersion,
      prompt: input.prompt,
      draftPlan: input.draftPlan ?? undefined
    };
  }

  private toFormData(input: {
    baseVersion: number;
    prompt?: string;
    attachment: File;
    draftPlan?: HouseholdPlan | null;
  }): FormData {
    const body = new FormData();
    body.set('baseVersion', String(input.baseVersion));
    if (input.prompt?.trim()) body.set('prompt', input.prompt.trim());
    if (input.draftPlan) body.set('draftPlan', JSON.stringify(input.draftPlan));
    body.set('image', input.attachment);
    return body;
  }

  private householdHeaders(householdId: string): HttpHeaders {
    return new HttpHeaders({ 'x-household-id': householdId });
  }
}
