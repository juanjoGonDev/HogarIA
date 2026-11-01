import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { AiActiveJobsService } from './ai-active-jobs.service';
import type { AiActiveJob } from '../../shared/models/ai-active-job.model';

const ACTIVE_URL = '/api/ai/queue/active';

function job(id: string, status: AiActiveJob['status']): AiActiveJob {
  return {
    id,
    kind: 'recipe',
    status,
    createdAt: '2026-11-01T12:00:00.000Z',
    startedAt: status === 'running' ? '2026-11-01T12:00:01.000Z' : null
  };
}

function response(jobs: AiActiveJob[]) {
  return { success: true, data: { jobs } };
}

describe('AiActiveJobsService', () => {
  let service: AiActiveJobsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(AiActiveJobsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads once when first watched and polls only until the active set becomes empty', fakeAsync(() => {
    const stopWatching = service.watch();
    const initial = http.expectOne(ACTIVE_URL);
    expect(initial.request.method).toBe('GET');
    expect(initial.request.context.get(SILENT_TOAST)).toBeTrue();
    expect(initial.request.headers.get('Cache-Control')).toBe('no-cache');
    initial.flush(response([job('running-1', 'running')]));
    expect(service.jobs().map((item) => item.id)).toEqual(['running-1']);

    tick(1_999);
    http.expectNone(ACTIVE_URL);
    tick(1);
    http.expectOne(ACTIVE_URL).flush(response([job('running-1', 'running')]));

    tick(2_000);
    http.expectOne(ACTIVE_URL).flush(response([]));
    expect(service.jobs()).toEqual([]);
    tick(6_000);
    http.expectNone(ACTIVE_URL);

    stopWatching();
  }));

  it('does not poll when the initial snapshot is empty', fakeAsync(() => {
    const stopWatching = service.watch();
    http.expectOne(ACTIVE_URL).flush(response([]));
    expect(service.jobs()).toEqual([]);

    tick(10_000);

    http.expectNone(ACTIVE_URL);
    stopWatching();
  }));

  it('discovers a newly started job during an AI request and stops polling when both become idle', fakeAsync(() => {
    const stopWatching = service.watch();
    http.expectOne(ACTIVE_URL).flush(response([]));
    http.expectNone(ACTIVE_URL);

    const stopTrackingRequest = service.trackAiRequest();
    http.expectOne(ACTIVE_URL).flush(response([]));
    tick(2_000);
    http.expectOne(ACTIVE_URL).flush(response([job('running-1', 'running')]));
    expect(service.jobs()).toEqual([job('running-1', 'running')]);

    stopTrackingRequest();
    http.expectOne(ACTIVE_URL).flush(response([]));
    tick(6_000);
    http.expectNone(ACTIVE_URL);
    stopWatching();
  }));

  it('shares the initial load across shell placements and stops polling after the final watcher leaves', fakeAsync(() => {
    const stopHeader = service.watch();
    const stopSidebar = service.watch();
    http.expectOne(ACTIVE_URL).flush(response([job('queued-1', 'queued')]));
    expect(service.jobs()).toEqual([job('queued-1', 'queued')]);

    stopHeader();
    tick(2_000);
    http.expectOne(ACTIVE_URL).flush(response([job('queued-1', 'queued')]));

    stopSidebar();
    tick(4_000);
    http.expectNone(ACTIVE_URL);
  }));

  it('reloads active jobs when the shell mounts again after it was unmounted', fakeAsync(() => {
    const stopFirstMount = service.watch();
    http.expectOne(ACTIVE_URL).flush(response([job('running-1', 'running')]));
    stopFirstMount();

    const stopSecondMount = service.watch();
    http.expectOne(ACTIVE_URL).flush(response([job('running-1', 'running')]));
    expect(service.jobs()).toEqual([job('running-1', 'running')]);
    stopSecondMount();
  }));

  it('rejects malformed or failed snapshots, preserves the last safe state and exposes a retryable load error', () => {
    const stopWatching = service.watch();
    http.expectOne(ACTIVE_URL).flush(response([job('running-1', 'running')]));

    service.refresh().subscribe();
    http.expectOne(ACTIVE_URL).flush({
      success: true,
      data: { jobs: [{ ...job('x', 'queued'), status: 'failed' }] }
    });

    expect(service.jobs()).toEqual([job('running-1', 'running')]);
    expect(service.loadError()).toBeTrue();

    service.refresh().subscribe();
    http.expectOne(ACTIVE_URL).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(service.jobs()).toEqual([job('running-1', 'running')]);
    expect(service.loadError()).toBeTrue();
    stopWatching();
  });
});
