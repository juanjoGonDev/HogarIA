import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable, Subscription, catchError, exhaustMap, interval, map, of, tap } from 'rxjs';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import type { AiActiveJob, AiActiveJobsResponse } from '../../shared/models/ai-active-job.model';

const ACTIVE_JOBS_URL = '/api/ai/queue/active';
const POLL_INTERVAL_MS = 2_000;
const ACTIVE_STATUSES = new Set(['queued', 'running']);

@Injectable({ providedIn: 'root' })
export class AiActiveJobsService {
  private readonly http: HttpClient;
  readonly jobs = signal<AiActiveJob[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal(false);

  private watchers = 0;
  private pendingAiRequests = 0;
  private readGeneration = 0;
  private polling?: Subscription;

  constructor(http: HttpClient) {
    // Keep constructor injection explicit for the same testable pattern as other API services.
    this.http = http;
  }

  /** Load on first shell mount; keep a shared poll alive only while active jobs exist. */
  watch(): () => void {
    this.watchers += 1;
    if (this.watchers === 1) this.refresh().subscribe();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.watchers = Math.max(0, this.watchers - 1);
      if (this.watchers === 0) {
        this.polling?.unsubscribe();
        this.polling = undefined;
        this.readGeneration += 1;
        this.loading.set(false);
      }
    };
  }

  /** Track an AI HTTP operation so the shell can discover its job even if its first read races it. */
  trackAiRequest(): () => void {
    this.pendingAiRequests += 1;
    this.syncPolling();
    this.refresh().subscribe();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pendingAiRequests = Math.max(0, this.pendingAiRequests - 1);
      this.refresh().subscribe();
      this.syncPolling();
    };
  }

  /** Explicit refresh hook for callers that start an AI request while the shell is already open. */
  refresh(): Observable<AiActiveJob[] | null> {
    const generation = ++this.readGeneration;
    this.loading.set(true);
    return this.http
      .get<AiActiveJobsResponse>(ACTIVE_JOBS_URL, {
        context: new HttpContext().set(SILENT_TOAST, true),
        headers: { 'Cache-Control': 'no-cache' }
      })
      .pipe(
        map((response) => this.validateJobs(response)),
        tap((jobs) => {
          if (generation !== this.readGeneration) return;
          this.jobs.set(jobs);
          this.loading.set(false);
          this.loadError.set(false);
          this.syncPolling();
        }),
        catchError(() => {
          if (generation === this.readGeneration) {
            this.loading.set(false);
            this.loadError.set(true);
            this.syncPolling();
          }
          return of(null);
        })
      );
  }

  private syncPolling(): void {
    if (this.watchers === 0 || (this.jobs().length === 0 && this.pendingAiRequests === 0)) {
      this.polling?.unsubscribe();
      this.polling = undefined;
      return;
    }
    if (this.polling) return;

    this.polling = interval(POLL_INTERVAL_MS)
      .pipe(exhaustMap(() => this.refresh()))
      .subscribe();
  }

  private validateJobs(response: AiActiveJobsResponse): AiActiveJob[] {
    const jobs = response?.success === true ? response.data?.jobs : undefined;
    if (
      !Array.isArray(jobs) ||
      jobs.some(
        (job) =>
          !job ||
          typeof job.id !== 'string' ||
          !job.id.trim() ||
          typeof job.kind !== 'string' ||
          !job.kind.trim() ||
          !ACTIVE_STATUSES.has(job.status) ||
          typeof job.createdAt !== 'string' ||
          !job.createdAt.trim() ||
          (job.startedAt !== null && typeof job.startedAt !== 'string')
      )
    ) {
      throw new Error('Invalid active AI jobs response');
    }
    return jobs;
  }
}
