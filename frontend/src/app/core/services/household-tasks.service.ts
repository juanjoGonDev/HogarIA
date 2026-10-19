import { HttpClient, HttpContext, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import type {
  HouseholdTaskOccurrence,
  VersionedHouseholdTaskWeek
} from '../../shared/models/household-task.model';
import { SILENT_TOAST } from '../interceptors/error.interceptor';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class HouseholdTasksService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/household/tasks`;
  private readonly silentContext = new HttpContext().set(SILENT_TOAST, true);

  load(householdId: string, weekStart: string): Observable<VersionedHouseholdTaskWeek> {
    return this.http
      .get<ApiEnvelope<VersionedHouseholdTaskWeek>>(this.apiUrl, {
        headers: this.householdHeaders(householdId),
        params: new HttpParams().set('weekStart', weekStart),
        context: this.silentContext
      })
      .pipe(map((response) => response.data));
  }

  save(
    householdId: string,
    weekStart: string,
    baseVersion: number,
    tasks: HouseholdTaskOccurrence[],
    assistantActionId?: string,
    assistantAction?: {
      operation: 'update_task';
      targetId: string;
      before: HouseholdTaskOccurrence;
    }
  ): Observable<VersionedHouseholdTaskWeek> {
    let headers = this.householdHeaders(householdId);
    if (assistantActionId) headers = headers.set('x-assistant-action-id', assistantActionId);
    const body = {
      weekStart,
      baseVersion,
      tasks,
      ...(assistantAction ? { assistantAction } : {})
    };
    return this.http
      .put<ApiEnvelope<VersionedHouseholdTaskWeek>>(this.apiUrl, body, {
        headers,
        context: this.silentContext
      })
      .pipe(map((response) => response.data));
  }

  private householdHeaders(householdId: string): HttpHeaders {
    return new HttpHeaders({ 'x-household-id': householdId });
  }
}
