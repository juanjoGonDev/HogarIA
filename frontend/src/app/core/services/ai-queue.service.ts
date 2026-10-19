import { Injectable, Signal, WritableSignal, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import {
  Observable,
  Subscription,
  catchError,
  exhaustMap,
  finalize,
  interval,
  map,
  of,
  startWith,
  switchMap,
  tap
} from 'rxjs';
import {
  AiQueueJob,
  AiQueueJobStatus,
  AiQueueSnapshot,
  AiQueueSnapshotResponse,
  AiQueueState
} from '../../shared/models/ai-queue.model';
import { SILENT_TOAST } from '../interceptors/error.interceptor';

const POLL_INTERVAL_MS = 2_000;
const JOB_STATUSES = new Set<AiQueueJobStatus>(['queued', 'running', 'failed']);

interface QueueEntry {
  state: WritableSignal<AiQueueState>;
  readonlyState: Signal<AiQueueState>;
  watchers: number;
  readGeneration: number;
  polling?: Subscription;
}

@Injectable({ providedIn: 'root' })
export class AiQueueService {
  private readonly apiUrl = '/api/ai/configs';
  private readonly queues = new Map<string, QueueEntry>();

  constructor(private readonly http: HttpClient) {}

  stateFor(configId: string): Signal<AiQueueState> {
    return this.entryFor(configId).readonlyState;
  }

  /** Start polling while at least one queue panel for this config is mounted. */
  watch(configId: string): () => void {
    const entry = this.entryFor(configId);
    entry.watchers += 1;

    if (entry.watchers === 1) {
      entry.polling = interval(POLL_INTERVAL_MS)
        .pipe(
          startWith(0),
          exhaustMap(() => this.fetchSnapshot(configId))
        )
        .subscribe();
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.watchers = Math.max(0, entry.watchers - 1);
      if (entry.watchers === 0) {
        entry.polling?.unsubscribe();
        entry.polling = undefined;
        entry.readGeneration += 1;
        entry.state.update((current) => ({ ...current, loading: false }));
      }
    };
  }

  refreshQueue(configId: string): Observable<AiQueueSnapshot | null> {
    return this.fetchSnapshot(configId);
  }

  reorder(configId: string, jobIds: string[]): Observable<boolean> {
    const jobs = this.stateFor(configId)().snapshot?.jobs ?? [];
    const queuedIds = jobs
      .filter((job) => job.status === 'queued')
      .sort((a, b) => a.queueOrder - b.queueOrder)
      .map((job) => job.id);
    const validOrder =
      jobIds.length === queuedIds.length &&
      new Set(jobIds).size === jobIds.length &&
      jobIds.every((id) => queuedIds.includes(id));

    if (!validOrder) return this.rejectAction(configId);
    return this.mutate(
      configId,
      this.http.patch<unknown>(
        `${this.queueUrl(configId)}/order`,
        { jobIds },
        {
          context: this.silentContext()
        }
      )
    );
  }

  cancel(configId: string, jobId: string): Observable<boolean> {
    const job = this.findJob(configId, jobId);
    if (!job || (job.status !== 'queued' && job.status !== 'running')) {
      return this.rejectAction(configId);
    }
    return this.mutate(
      configId,
      this.http.post<unknown>(
        `${this.queueUrl(configId)}/${encodeURIComponent(jobId)}/cancel`,
        {},
        {
          context: this.silentContext()
        }
      )
    );
  }

  retry(configId: string, jobId: string): Observable<boolean> {
    const job = this.findJob(configId, jobId);
    if (!job || job.status !== 'failed' || job.retryable !== true) {
      return this.rejectAction(configId);
    }
    return this.mutate(
      configId,
      this.http.post<unknown>(
        `${this.queueUrl(configId)}/${encodeURIComponent(jobId)}/retry`,
        {},
        {
          context: this.silentContext()
        }
      )
    );
  }

  private queueUrl(configId: string): string {
    return `${this.apiUrl}/${encodeURIComponent(configId)}/queue`;
  }

  private silentContext(): HttpContext {
    return new HttpContext().set(SILENT_TOAST, true);
  }

  private fetchSnapshot(configId: string): Observable<AiQueueSnapshot | null> {
    const entry = this.entryFor(configId);
    const generation = ++entry.readGeneration;
    entry.state.update((current) => ({ ...current, loading: true }));

    return this.http
      .get<AiQueueSnapshotResponse>(this.queueUrl(configId), { context: this.silentContext() })
      .pipe(
        map((response) => this.validateSnapshot(response?.data, configId)),
        tap((snapshot) => {
          if (generation !== entry.readGeneration) return;
          entry.state.update((current) => ({
            ...current,
            snapshot,
            loading: false,
            loadError: false,
            actionError: false
          }));
        }),
        catchError(() => {
          if (generation === entry.readGeneration) {
            entry.state.update((current) => ({ ...current, loading: false, loadError: true }));
          }
          return of(null);
        })
      );
  }

  private mutate(configId: string, request: Observable<unknown>): Observable<boolean> {
    const entry = this.entryFor(configId);
    if (entry.state().mutating) return this.rejectAction(configId);

    entry.state.update((current) => ({ ...current, mutating: true, actionError: false }));
    return request.pipe(
      switchMap(() => this.fetchSnapshot(configId).pipe(map(() => true))),
      catchError(() =>
        this.fetchSnapshot(configId).pipe(
          tap(() => entry.state.update((current) => ({ ...current, actionError: true }))),
          map(() => false)
        )
      ),
      finalize(() => entry.state.update((current) => ({ ...current, mutating: false })))
    );
  }

  private rejectAction(configId: string): Observable<boolean> {
    this.entryFor(configId).state.update((current) => ({ ...current, actionError: true }));
    return of(false);
  }

  private findJob(configId: string, jobId: string): AiQueueJob | undefined {
    return this.stateFor(configId)().snapshot?.jobs.find((job) => job.id === jobId);
  }

  private validateSnapshot(value: AiQueueSnapshot | undefined, configId: string): AiQueueSnapshot {
    if (
      !value ||
      value.configId !== configId ||
      !Array.isArray(value.jobs) ||
      value.jobs.some(
        (job) =>
          !job ||
          typeof job.id !== 'string' ||
          job.configId !== configId ||
          !JOB_STATUSES.has(job.status) ||
          !Number.isFinite(job.queueOrder)
      )
    ) {
      throw new Error('Invalid AI queue response');
    }
    // Missing flags from an older backend must not expose a retry which cannot work.
    return {
      ...value,
      jobs: value.jobs.map((job) => ({ ...job, retryable: job.retryable === true }))
    };
  }

  private entryFor(configId: string): QueueEntry {
    const existing = this.queues.get(configId);
    if (existing) return existing;

    const state = signal<AiQueueState>({
      snapshot: null,
      loading: false,
      loadError: false,
      mutating: false,
      actionError: false
    });
    const entry: QueueEntry = {
      state,
      readonlyState: state.asReadonly(),
      watchers: 0,
      readGeneration: 0
    };
    this.queues.set(configId, entry);
    return entry;
  }
}
