import { HttpClient, HttpContext, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SILENT_TOAST } from '../interceptors/error.interceptor';

export type HouseholdPlanningAutomationMode = 'generate' | 'repeat';
export type HouseholdPlanningAutomationScope = 'tasks' | 'meals';
export type HouseholdPlanningAutomationRunStatus =
  'in_progress' | 'review_required' | 'completed' | 'cancelled' | 'skipped';

export type HouseholdPlanningAutomationRetryFailureCode =
  | 'busy'
  | 'already_completed'
  | 'review_required'
  | 'cancelled'
  | 'stale_config'
  | 'authorization_invalid'
  | 'not_authorized'
  | 'skipped'
  | 'not_retryable'
  | 'not_found';

export interface HouseholdPlanningAutomationLastRun {
  occurrenceKey: string;
  targetWeekStart: string;
  status: HouseholdPlanningAutomationRunStatus;
  failureCode: string | null;
  updatedAt: string;
}

export interface HouseholdPlanningAutomationOccurrence {
  scheduledLocalDate: string;
  localDate: string;
  localTime: string;
  timeZone: string;
  utcInstant: string;
  occurrenceKey: string;
}

export interface HouseholdPlanningAutomationResponse {
  enabled: boolean;
  mode: HouseholdPlanningAutomationMode | null;
  scopes: HouseholdPlanningAutomationScope[];
  weekday: number | null;
  localTime: string | null;
  timeZone: string | null;
  version: number;
  nextRunAt: string | null;
  nextRun: HouseholdPlanningAutomationOccurrence | null;
  lastRun?: HouseholdPlanningAutomationLastRun | null;
}

export interface HouseholdPlanningAutomationPatch {
  expectedVersion: number;
  enabled?: boolean;
  mode?: HouseholdPlanningAutomationMode | null;
  scopes?: HouseholdPlanningAutomationScope[];
  weekday?: number | null;
  localTime?: string | null;
  timeZone?: string | null;
}

export interface HouseholdPlanningAutomationRetryPatch {
  expectedVersion: number;
  occurrenceKey: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
}

export class HouseholdPlanningAutomationConflict extends Error {
  constructor(readonly snapshot: HouseholdPlanningAutomationResponse) {
    super('HOUSEHOLD_PLANNING_AUTOMATION_VERSION_CONFLICT');
    this.name = 'HouseholdPlanningAutomationConflict';
  }
}

export class HouseholdPlanningAutomationRetryError extends Error {
  constructor(readonly code: HouseholdPlanningAutomationRetryFailureCode) {
    super(code);
    this.name = 'HouseholdPlanningAutomationRetryError';
  }
}

@Injectable({ providedIn: 'root' })
export class HouseholdPlanningAutomationService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/household/planning-automation`;
  private readonly retryUrl = `${this.apiUrl}/retry`;
  private readonly silentContext = new HttpContext().set(SILENT_TOAST, true);
  private readonly snapshots = signal<ReadonlyMap<string, HouseholdPlanningAutomationResponse>>(
    new Map()
  );

  load(householdId: string): Observable<HouseholdPlanningAutomationResponse> {
    return this.http
      .get<ApiEnvelope<HouseholdPlanningAutomationResponse>>(this.apiUrl, {
        headers: this.householdHeaders(householdId),
        context: this.silentContext
      })
      .pipe(
        map((response) => requireAutomationResponse(response?.data)),
        tap((response) => this.publish(householdId, response))
      );
  }

  save(
    householdId: string,
    patch: HouseholdPlanningAutomationPatch
  ): Observable<HouseholdPlanningAutomationResponse> {
    return this.http
      .patch<ApiEnvelope<HouseholdPlanningAutomationResponse>>(this.apiUrl, patch, {
        headers: this.householdHeaders(householdId),
        context: this.silentContext
      })
      .pipe(
        map((response) => requireAutomationResponse(response?.data)),
        tap((response) => this.publish(householdId, response)),
        catchError((error: unknown) => {
          const conflict = readVersionConflict(error);
          if (conflict) {
            this.publish(householdId, conflict);
            return throwError(() => new HouseholdPlanningAutomationConflict(conflict));
          }
          return throwError(() => error);
        })
      );
  }

  retry(
    householdId: string,
    patch: HouseholdPlanningAutomationRetryPatch
  ): Observable<HouseholdPlanningAutomationLastRun> {
    return this.http
      .post<ApiEnvelope<{ lastRun?: unknown }>>(this.retryUrl, patch, {
        headers: this.householdHeaders(householdId),
        context: this.silentContext
      })
      .pipe(
        map((response) => requireLastRun(response?.data?.lastRun)),
        tap((lastRun) => {
          const current = this.snapshotFor(householdId);
          if (current) this.publish(householdId, { ...current, lastRun });
        }),
        catchError((error: unknown) => {
          const retryError = readRetryError(error);
          return retryError ? throwError(() => retryError) : throwError(() => error);
        })
      );
  }

  snapshotFor(householdId: string): HouseholdPlanningAutomationResponse | null {
    return this.snapshots().get(householdId) ?? null;
  }

  private publish(householdId: string, response: HouseholdPlanningAutomationResponse): void {
    const current = this.snapshots().get(householdId);
    // Delayed GETs can arrive after a successful PATCH. The server version is monotonic, so an older
    // read must not restore the stale state in the persistent play/pause notice.
    if (current && current.version > response.version) return;
    const updated = new Map(this.snapshots());
    updated.set(householdId, response);
    this.snapshots.set(updated);
  }

  private householdHeaders(householdId: string): HttpHeaders {
    return new HttpHeaders({ 'x-household-id': householdId });
  }
}

function requireAutomationResponse(value: unknown): HouseholdPlanningAutomationResponse {
  if (!isAutomationResponse(value)) {
    throw new Error('INVALID_HOUSEHOLD_PLANNING_AUTOMATION_RESPONSE');
  }
  return value;
}

function readVersionConflict(error: unknown): HouseholdPlanningAutomationResponse | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) return null;
  const body = error.error as { code?: unknown; data?: unknown } | null;
  if (body?.code !== 'HOUSEHOLD_PLANNING_AUTOMATION_VERSION_CONFLICT') return null;
  return isAutomationResponse(body.data) ? body.data : null;
}

function requireLastRun(value: unknown): HouseholdPlanningAutomationLastRun {
  if (!isLastRun(value)) throw new Error('INVALID_HOUSEHOLD_PLANNING_AUTOMATION_RUN_RESPONSE');
  return value;
}

function readRetryError(error: unknown): HouseholdPlanningAutomationRetryError | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const body = error.error as { code?: unknown } | null;
  const code = body?.code;
  if (
    code === 'busy' ||
    code === 'already_completed' ||
    code === 'review_required' ||
    code === 'cancelled' ||
    code === 'stale_config' ||
    code === 'authorization_invalid' ||
    code === 'not_authorized' ||
    code === 'skipped' ||
    code === 'not_retryable' ||
    code === 'not_found'
  ) {
    return new HouseholdPlanningAutomationRetryError(code);
  }
  return null;
}

function isAutomationResponse(value: unknown): value is HouseholdPlanningAutomationResponse {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<HouseholdPlanningAutomationResponse>;
  return (
    typeof state.enabled === 'boolean' &&
    (state.mode === null || state.mode === 'generate' || state.mode === 'repeat') &&
    Array.isArray(state.scopes) &&
    state.scopes.every((scope) => scope === 'tasks' || scope === 'meals') &&
    (state.weekday === null ||
      (typeof state.weekday === 'number' &&
        Number.isInteger(state.weekday) &&
        state.weekday >= 1 &&
        state.weekday <= 7)) &&
    (state.localTime === null ||
      (typeof state.localTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(state.localTime))) &&
    (state.timeZone === null || typeof state.timeZone === 'string') &&
    Number.isSafeInteger(state.version) &&
    (state.nextRunAt === null || typeof state.nextRunAt === 'string') &&
    (state.nextRun === null ||
      (typeof state.nextRun === 'object' &&
        typeof state.nextRun.utcInstant === 'string' &&
        typeof state.nextRun.localDate === 'string' &&
        typeof state.nextRun.localTime === 'string' &&
        typeof state.nextRun.timeZone === 'string')) &&
    (state.lastRun === undefined || state.lastRun === null || isLastRun(state.lastRun))
  );
}

function isLastRun(value: unknown): value is HouseholdPlanningAutomationLastRun {
  if (!value || typeof value !== 'object') return false;
  const run = value as Partial<HouseholdPlanningAutomationLastRun>;
  return (
    typeof run.occurrenceKey === 'string' &&
    typeof run.targetWeekStart === 'string' &&
    (run.status === 'in_progress' ||
      run.status === 'review_required' ||
      run.status === 'completed' ||
      run.status === 'cancelled' ||
      run.status === 'skipped') &&
    (run.failureCode === null || typeof run.failureCode === 'string') &&
    typeof run.updatedAt === 'string' &&
    Number.isFinite(Date.parse(run.updatedAt))
  );
}
