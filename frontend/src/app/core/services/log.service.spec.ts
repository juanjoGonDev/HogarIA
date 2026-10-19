import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { LogEntry, LogService } from './log.service';

const LOGS_API = '/api/logs';

function entry(message: string, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2026-10-01T12:00:00.000Z',
    level: 'info',
    source: 'server',
    message,
    ...overrides
  };
}

class FakeEventSource {
  onopen: ((this: unknown, ev: unknown) => void) | null = null;
  onerror: ((this: unknown, ev: unknown) => void) | null = null;
  onmessage: ((this: unknown, ev: { data: string }) => void) | null = null;
  closeCount = 0;

  addEventListener(): void {}

  close(): void {
    this.closeCount += 1;
  }

  emitOpen(): void {
    this.onopen?.call(this, new Event('open'));
  }

  emitError(): void {
    this.onerror?.call(this, new Event('error'));
  }

  emitMessage(data: string): void {
    this.onmessage?.call(this, { data });
  }
}

describe('LogService', () => {
  let service: LogService;
  let http: HttpTestingController;
  let source: FakeEventSource;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(LogService);
    http = TestBed.inject(HttpTestingController);
    source = new FakeEventSource();
    spyOn(window as any, 'EventSource').and.returnValue(source);
  });

  afterEach(() => {
    service.disconnect();
    http.verify({ ignoreCancelled: true });
  });

  it('starts with empty data and neutral filters', () => {
    expect(service.logs()).toEqual([]);
    expect(service.connected()).toBeFalse();
    expect(service.streamStatus()).toBe('closed');
    expect(service.retryIn()).toBeNull();
    expect(service.autoScroll()).toBeTrue();
    expect(service.paused()).toBeFalse();
    expect(service.sourceFilter()).toBe('all');
    expect(service.levelFilter()).toBe('all');
  });

  it('loads history oldest-first, streams valid entries, ignores malformed data, and pauses live entries', fakeAsync(() => {
    service.connect();
    http.expectOne(`${LOGS_API}?limit=500`).flush({
      data: {
        logs: [
          entry('newest', { timestamp: '2026-10-03' }),
          entry('oldest', { timestamp: '2026-10-01' })
        ]
      }
    });

    expect(service.logs().map((item) => item.message)).toEqual(['oldest', 'newest']);
    expect(service.logs().map((item) => item.id)).toEqual(['log-1', 'log-2']);
    source.emitOpen();
    expect(service.connected()).toBeTrue();
    expect(service.streamStatus()).toBe('live');

    source.emitMessage(JSON.stringify(entry('live-one')));
    source.emitMessage('{malformed');
    tick(200);
    expect(service.logs().map((item) => item.message)).toEqual(['oldest', 'newest', 'live-one']);

    service.togglePause();
    expect(service.paused()).toBeTrue();
    source.emitMessage(JSON.stringify(entry('paused')));
    tick(200);
    expect(service.logs().some((item) => item.message === 'paused')).toBeFalse();

    service.togglePause();
    expect(service.paused()).toBeFalse();
    source.emitMessage(JSON.stringify(entry('resumed')));
    tick(200);
    expect(service.logs().map((item) => item.message)).toContain('resumed');
  }));

  it('keeps trying after the history request fails and exposes the retry delay', () => {
    service.connect();
    http.expectOne(`${LOGS_API}?limit=500`).flush({}, { status: 503, statusText: 'Unavailable' });

    source.emitError();
    expect(service.streamStatus()).toBe('retrying');
    expect(service.connected()).toBeFalse();
    expect(service.retryIn()).toBe(1000);
  });

  it('disconnect closes the stream and cancels a pending live-entry flush', fakeAsync(() => {
    service.connect();
    http.expectOne(`${LOGS_API}?limit=500`).flush({ data: { logs: [] } });
    source.emitMessage(JSON.stringify(entry('pending')));

    service.disconnect();
    tick(200);

    expect(service.logs()).toEqual([]);
    expect(service.connected()).toBeFalse();
    expect(service.streamStatus()).toBe('closed');
    expect(service.retryIn()).toBeNull();
    expect(source.closeCount).toBe(1);
  }));

  it('applies source and level filters, hides connected records, and toggles preferences', () => {
    const serverError = entry('server-error', { source: 'server', level: 'error' });
    const browserError = entry('browser-error', { source: 'browser', level: 'error' });
    const serverInfo = entry('server-info', { source: 'server', level: 'info' });
    const connected = entry('connected', { type: 'connected' });

    expect(service.isVisible(connected)).toBeFalse();
    expect(service.isVisible(serverError)).toBeTrue();
    service.setSourceFilter('browser');
    expect(service.isVisible(serverError)).toBeFalse();
    expect(service.isVisible(browserError)).toBeTrue();
    service.setLevelFilter('warn');
    expect(service.isVisible(browserError)).toBeFalse();
    service.setLevelFilter('error');
    expect(service.isVisible(browserError)).toBeTrue();
    expect(service.isVisible(serverInfo)).toBeFalse();
    service.setSourceFilter('all');
    expect(service.isVisible(serverError)).toBeTrue();

    service.toggleAutoScroll();
    service.togglePause();
    expect(service.autoScroll()).toBeFalse();
    expect(service.paused()).toBeTrue();
  });

  it('combines the independent only-errors filter without replacing source or level', () => {
    const browserError = entry('browser-error', { source: 'browser', level: 'error' });
    const browserWarning = entry('browser-warning', { source: 'browser', level: 'warn' });
    const browserInfo = entry('browser-info', { source: 'browser', level: 'info' });
    const serverError = entry('server-error', { source: 'server', level: 'error' });

    expect(service.onlyErrors()).toBeFalse();
    service.setOnlyErrors(true);
    expect(service.isVisible(browserError)).toBeTrue();
    expect(service.isVisible(serverError)).toBeTrue();
    expect(service.isVisible(browserWarning)).toBeFalse();
    expect(service.isVisible(browserInfo)).toBeFalse();

    service.setSourceFilter('browser');
    service.setLevelFilter('warn');
    expect(service.isVisible(browserWarning)).toBeFalse();
    expect(service.isVisible(browserError)).toBeFalse();

    service.setOnlyErrors(false);
    expect(service.sourceFilter()).toBe('browser');
    expect(service.levelFilter()).toBe('warn');
    expect(service.isVisible(browserWarning)).toBeTrue();
    expect(service.isVisible(browserError)).toBeFalse();

    service.setLevelFilter('all');
    expect(service.isVisible(browserError)).toBeTrue();
    expect(service.isVisible(browserWarning)).toBeTrue();
    expect(service.isVisible(browserInfo)).toBeTrue();
    expect(service.isVisible(serverError)).toBeFalse();
  });

  it('preserves a stable id and caps a flushed burst at 1500 entries', fakeAsync(() => {
    service.connect();
    http.expectOne(`${LOGS_API}?limit=500`).flush({ data: { logs: [] } });
    source.emitMessage(JSON.stringify(entry('stable-id', { id: 'persisted-id' })));
    source.emitMessage(JSON.stringify(entry('generated-id')));
    tick(200);
    expect(service.logs().map((item) => item.id)).toEqual(['persisted-id', 'log-1']);

    for (let index = 0; index < 1501; index += 1) {
      source.emitMessage(JSON.stringify(entry(`burst-${index}`)));
    }
    tick(200);

    expect(service.logs()).toHaveSize(1500);
    expect(service.logs()[0].message).toBe('burst-1');
    expect(service.logs()[1499].message).toBe('burst-1500');
  }));

  it('returns the DELETE result and clears local entries only after success', () => {
    service.connect();
    http.expectOne(`${LOGS_API}?limit=500`).flush({ data: { logs: [entry('kept-until-ack')] } });
    let completed = false;

    service.clear().subscribe(() => (completed = true));
    const request = http.expectOne(LOGS_API);
    expect(request.request.method).toBe('DELETE');
    expect(service.logs().map((item) => item.message)).toEqual(['kept-until-ack']);

    request.flush({ success: true });

    expect(completed).toBeTrue();
    expect(service.logs()).toEqual([]);
  });

  it('preserves local entries and propagates a failed DELETE for the caller to handle', () => {
    service.connect();
    http.expectOne(`${LOGS_API}?limit=500`).flush({ data: { logs: [entry('preserve-on-error')] } });
    let failure: unknown;

    service.clear().subscribe({ error: (error) => (failure = error) });
    http.expectOne(LOGS_API).flush({}, { status: 503, statusText: 'Unavailable' });

    expect(failure).toBeTruthy();
    expect(service.logs().map((item) => item.message)).toEqual(['preserve-on-error']);
  });
});
