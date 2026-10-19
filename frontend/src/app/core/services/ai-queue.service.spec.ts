import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { AiQueueService } from './ai-queue.service';
import type { AiQueueJob, AiQueueSnapshot } from '../../shared/models/ai-queue.model';

const CONFIG_ID = 'provider-a';
const BASE_URL = `/api/ai/configs/${CONFIG_ID}/queue`;

function job(
  id: string,
  status: AiQueueJob['status'],
  queueOrder: number,
  configId = CONFIG_ID
): AiQueueJob {
  return {
    id,
    configId,
    kind: 'recipe',
    status,
    attempts: status === 'failed' ? 3 : 0,
    maxAttempts: 3,
    error: status === 'failed' ? 'Provider unavailable' : null,
    retryable: status === 'failed',
    createdAt: '2026-10-01T12:00:00.000Z',
    queueOrder
  };
}

function snapshot(jobs: AiQueueJob[], configId = CONFIG_ID): AiQueueSnapshot {
  return { configId, jobs };
}

describe('AiQueueService', () => {
  let service: AiQueueService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(AiQueueService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads an isolated provider queue immediately, polls while watched, and cleans up', fakeAsync(() => {
    const stopWatching = service.watch(CONFIG_ID);
    const initial = http.expectOne(BASE_URL);
    expect(initial.request.context.get(SILENT_TOAST)).toBeTrue();
    initial.flush({ data: snapshot([job('queued-1', 'queued', 0)]) });
    expect(service.stateFor(CONFIG_ID)().snapshot?.jobs[0].id).toBe('queued-1');
    expect(service.stateFor('provider-b')().snapshot).toBeNull();

    tick(1_999);
    http.expectNone(BASE_URL);
    tick(1);
    http.expectOne(BASE_URL).flush({ data: snapshot([job('queued-1', 'queued', 0)]) });

    stopWatching();
    stopWatching();
    tick(4_000);
    http.expectNone(BASE_URL);
    expect(service.stateFor(CONFIG_ID)().loading).toBeFalse();
  }));

  it('keeps the previous snapshot and exposes a refresh error without leaking transport errors', () => {
    const stopWatching = service.watch(CONFIG_ID);
    http.expectOne(BASE_URL).flush({ data: snapshot([job('queued-1', 'queued', 0)]) });

    service.refreshQueue(CONFIG_ID).subscribe();
    http.expectOne(BASE_URL).flush({}, { status: 503, statusText: 'Unavailable' });

    expect(service.stateFor(CONFIG_ID)().snapshot?.jobs[0].id).toBe('queued-1');
    expect(service.stateFor(CONFIG_ID)().loadError).toBeTrue();
    expect(service.stateFor(CONFIG_ID)().loading).toBeFalse();
    stopWatching();
  });

  it('rejects a response belonging to a different provider', () => {
    const stopWatching = service.watch(CONFIG_ID);
    http
      .expectOne(BASE_URL)
      .flush({ data: snapshot([job('other-job', 'queued', 0, 'provider-b')]) });

    expect(service.stateFor(CONFIG_ID)().snapshot).toBeNull();
    expect(service.stateFor(CONFIG_ID)().loadError).toBeTrue();
    stopWatching();
  });

  it('fails closed when a backend snapshot omits retryable', () => {
    const stopWatching = service.watch(CONFIG_ID);
    const oldJob = job('failed-old', 'failed', 0) as Omit<AiQueueJob, 'retryable'> & {
      retryable?: boolean;
    };
    delete oldJob.retryable;
    http.expectOne(BASE_URL).flush({ data: snapshot([oldJob as AiQueueJob]) });

    expect(service.stateFor(CONFIG_ID)().snapshot?.jobs[0].retryable).toBeFalse();
    let retryResult: boolean | undefined;
    service.retry(CONFIG_ID, 'failed-old').subscribe((value) => (retryResult = value));
    expect(retryResult).toBeFalse();
    http.expectNone(`${BASE_URL}/failed-old/retry`);
    stopWatching();
  });

  it('persists exactly the queued IDs in the requested order, then reloads the snapshot', () => {
    const stopWatching = service.watch(CONFIG_ID);
    http.expectOne(BASE_URL).flush({
      data: snapshot([
        job('queued-1', 'queued', 0),
        job('queued-2', 'queued', 1),
        job('running', 'running', 0)
      ])
    });

    let result: boolean | undefined;
    service.reorder(CONFIG_ID, ['queued-2', 'queued-1']).subscribe((value) => (result = value));
    const request = http.expectOne(`${BASE_URL}/order`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ jobIds: ['queued-2', 'queued-1'] });
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush({ success: true });
    http.expectOne(BASE_URL).flush({
      data: snapshot([
        job('queued-2', 'queued', 0),
        job('queued-1', 'queued', 1),
        job('running', 'running', 0)
      ])
    });

    expect(result).toBeTrue();
    expect(service.stateFor(CONFIG_ID)().snapshot?.jobs[0].id).toBe('queued-2');
    expect(service.stateFor(CONFIG_ID)().mutating).toBeFalse();
    stopWatching();
  });

  it('rejects duplicate or non-queued IDs rather than sending an invalid reorder', () => {
    const stopWatching = service.watch(CONFIG_ID);
    http
      .expectOne(BASE_URL)
      .flush({ data: snapshot([job('queued-1', 'queued', 0), job('running', 'running', 1)]) });

    let result: boolean | undefined;
    service.reorder(CONFIG_ID, ['queued-1', 'queued-1']).subscribe((value) => (result = value));

    expect(result).toBeFalse();
    expect(service.stateFor(CONFIG_ID)().actionError).toBeTrue();
    http.expectNone(`${BASE_URL}/order`);
    stopWatching();
  });

  it('cancels only queued/running jobs and refreshes after an accepted cancellation', () => {
    const stopWatching = service.watch(CONFIG_ID);
    http
      .expectOne(BASE_URL)
      .flush({ data: snapshot([job('running-1', 'running', 0), job('failed-1', 'failed', 1)]) });

    let invalidResult: boolean | undefined;
    service.cancel(CONFIG_ID, 'failed-1').subscribe((value) => (invalidResult = value));
    expect(invalidResult).toBeFalse();
    http.expectNone(`${BASE_URL}/failed-1/cancel`);

    let result: boolean | undefined;
    service.cancel(CONFIG_ID, 'running-1').subscribe((value) => (result = value));
    const cancel = http.expectOne(`${BASE_URL}/running-1/cancel`);
    expect(cancel.request.method).toBe('POST');
    cancel.flush({ success: true });
    http.expectOne(BASE_URL).flush({ data: snapshot([job('failed-1', 'failed', 0)]) });
    expect(result).toBeTrue();
    expect(service.stateFor(CONFIG_ID)().snapshot?.jobs).toHaveSize(1);
    stopWatching();
  });

  it('retries only terminal failures and reloads the provider queue', () => {
    const stopWatching = service.watch(CONFIG_ID);
    http
      .expectOne(BASE_URL)
      .flush({ data: snapshot([job('failed-1', 'failed', 0), job('queued-1', 'queued', 1)]) });

    let invalidResult: boolean | undefined;
    service.retry(CONFIG_ID, 'queued-1').subscribe((value) => (invalidResult = value));
    expect(invalidResult).toBeFalse();
    http.expectNone(`${BASE_URL}/queued-1/retry`);

    let result: boolean | undefined;
    service.retry(CONFIG_ID, 'failed-1').subscribe((value) => (result = value));
    const retry = http.expectOne(`${BASE_URL}/failed-1/retry`);
    expect(retry.request.method).toBe('POST');
    retry.flush({ success: true });
    http.expectOne(BASE_URL).flush({ data: snapshot([job('failed-1', 'queued', 0)]) });
    expect(result).toBeTrue();
    expect(service.stateFor(CONFIG_ID)().actionError).toBeFalse();
    stopWatching();
  });

  it('refreshes after 409 mutation races and preserves the failure notice after reconciliation', () => {
    const stopWatching = service.watch(CONFIG_ID);
    http.expectOne(BASE_URL).flush({ data: snapshot([job('queued-1', 'queued', 0)]) });

    let result: boolean | undefined;
    service.cancel(CONFIG_ID, 'queued-1').subscribe((value) => (result = value));
    http
      .expectOne(`${BASE_URL}/queued-1/cancel`)
      .flush({}, { status: 409, statusText: 'Conflict' });
    http.expectOne(BASE_URL).flush({ data: snapshot([job('queued-1', 'running', 0)]) });

    expect(result).toBeFalse();
    expect(service.stateFor(CONFIG_ID)().snapshot?.jobs[0].status).toBe('running');
    expect(service.stateFor(CONFIG_ID)().actionError).toBeTrue();
    expect(service.stateFor(CONFIG_ID)().mutating).toBeFalse();
    stopWatching();
  });

  it('refreshes after failed reorder and retry operations as well', () => {
    const stopWatching = service.watch(CONFIG_ID);
    http.expectOne(BASE_URL).flush({
      data: snapshot([
        job('queued-1', 'queued', 0),
        job('queued-2', 'queued', 1),
        job('failed-1', 'failed', 2)
      ])
    });

    let reorderResult: boolean | undefined;
    service
      .reorder(CONFIG_ID, ['queued-2', 'queued-1'])
      .subscribe((value) => (reorderResult = value));
    http.expectOne(`${BASE_URL}/order`).flush({}, { status: 409, statusText: 'Conflict' });
    http.expectOne(BASE_URL).flush({
      data: snapshot([
        job('queued-1', 'running', 0),
        job('queued-2', 'queued', 1),
        job('failed-1', 'failed', 2)
      ])
    });
    expect(reorderResult).toBeFalse();
    expect(service.stateFor(CONFIG_ID)().snapshot?.jobs[0].status).toBe('running');

    let retryResult: boolean | undefined;
    service.retry(CONFIG_ID, 'failed-1').subscribe((value) => (retryResult = value));
    http.expectOne(`${BASE_URL}/failed-1/retry`).flush({}, { status: 409, statusText: 'Conflict' });
    http.expectOne(BASE_URL).flush({
      data: snapshot([
        job('queued-1', 'running', 0),
        job('queued-2', 'queued', 1),
        job('failed-1', 'queued', 2)
      ])
    });
    expect(retryResult).toBeFalse();
    expect(
      service
        .stateFor(CONFIG_ID)()
        .snapshot?.jobs.find((item) => item.id === 'failed-1')?.status
    ).toBe('queued');
    expect(service.stateFor(CONFIG_ID)().actionError).toBeTrue();
    stopWatching();
  });
});
