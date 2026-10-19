import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  HouseholdPlanningAutomationConflict,
  HouseholdPlanningAutomationRetryError,
  HouseholdPlanningAutomationService,
  type HouseholdPlanningAutomationLastRun,
  type HouseholdPlanningAutomationResponse
} from './household-planning-automation.service';

describe('HouseholdPlanningAutomationService', () => {
  let service: HouseholdPlanningAutomationService;
  let http: HttpTestingController;

  const config: HouseholdPlanningAutomationResponse = {
    enabled: true,
    mode: 'generate',
    scopes: ['tasks', 'meals'],
    weekday: 1,
    localTime: '08:30',
    timeZone: 'Europe/Madrid',
    version: 3,
    nextRunAt: '2026-10-19T06:30:00.000Z',
    nextRun: {
      scheduledLocalDate: '2026-10-19',
      localDate: '2026-10-19',
      localTime: '08:30',
      timeZone: 'Europe/Madrid',
      utcInstant: '2026-10-19T06:30:00.000Z',
      occurrenceKey: 'synthetic-occurrence'
    }
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(HouseholdPlanningAutomationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the active household configuration and exposes it to the persistent notice', () => {
    let result: HouseholdPlanningAutomationResponse | undefined;
    service.load('home-1').subscribe((value) => (result = value));

    const request = http.expectOne('/api/household/planning-automation');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('x-household-id')).toBe('home-1');
    request.flush({ success: true, data: config });

    expect(result).toEqual(config);
    expect(service.snapshotFor('home-1')).toEqual(config);
    expect(service.snapshotFor('home-2')).toBeNull();
  });

  it('sends the expected version with an explicit configuration patch', () => {
    let result: HouseholdPlanningAutomationResponse | undefined;
    service
      .save('home-1', {
        expectedVersion: 3,
        mode: 'repeat',
        scopes: ['tasks'],
        weekday: 5,
        localTime: '19:00',
        timeZone: 'Europe/Madrid'
      })
      .subscribe((value) => (result = value));

    const request = http.expectOne('/api/household/planning-automation');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.headers.get('x-household-id')).toBe('home-1');
    expect(request.request.body).toEqual({
      expectedVersion: 3,
      mode: 'repeat',
      scopes: ['tasks'],
      weekday: 5,
      localTime: '19:00',
      timeZone: 'Europe/Madrid'
    });
    request.flush({
      success: true,
      data: { ...config, version: 4, enabled: false, nextRunAt: null, nextRun: null }
    });

    expect(result?.version).toBe(4);
    expect(service.snapshotFor('home-1')?.version).toBe(4);
  });

  it('publishes the server snapshot on CAS conflict and does not retry the mutation', () => {
    const newerConfig = { ...config, version: 4, enabled: false, nextRunAt: null, nextRun: null };
    let receivedError: unknown;
    service.save('home-1', { expectedVersion: 2, enabled: false }).subscribe({
      error: (error: unknown) => (receivedError = error)
    });

    const request = http.expectOne('/api/household/planning-automation');
    expect(request.request.body).toEqual({ expectedVersion: 2, enabled: false });
    request.flush(
      {
        success: false,
        code: 'HOUSEHOLD_PLANNING_AUTOMATION_VERSION_CONFLICT',
        data: newerConfig
      },
      { status: 409, statusText: 'Conflict' }
    );

    expect(receivedError).toEqual(jasmine.any(HouseholdPlanningAutomationConflict));
    expect((receivedError as HouseholdPlanningAutomationConflict).snapshot).toEqual(newerConfig);
    expect(service.snapshotFor('home-1')).toEqual(newerConfig);
    http.expectNone('/api/household/planning-automation');
  });

  it('posts a fenced retry for the same occurrence and stores its sanitized run snapshot', () => {
    service.load('home-1').subscribe();
    http.expectOne('/api/household/planning-automation').flush({ success: true, data: config });
    const run = {
      occurrenceKey: 'synthetic-occurrence',
      targetWeekStart: '2026-10-19',
      status: 'in_progress' as const,
      failureCode: null,
      updatedAt: '2026-10-18T18:30:00.000Z'
    };

    let result: HouseholdPlanningAutomationLastRun | undefined;
    service
      .retry('home-1', { expectedVersion: config.version, occurrenceKey: run.occurrenceKey })
      .subscribe((value) => (result = value));

    const request = http.expectOne('/api/household/planning-automation/retry');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('x-household-id')).toBe('home-1');
    expect(request.request.body).toEqual({ expectedVersion: 3, occurrenceKey: run.occurrenceKey });
    request.flush(
      { success: true, data: { lastRun: run } },
      { status: 202, statusText: 'Accepted' }
    );

    expect(result).toEqual(run);
    expect(service.snapshotFor('home-1')?.lastRun).toEqual(run);
  });

  it('maps only allowlisted retry failure codes and never automatically retries', () => {
    let receivedError: unknown;
    service
      .retry('home-1', { expectedVersion: 3, occurrenceKey: 'synthetic-occurrence' })
      .subscribe({ error: (error: unknown) => (receivedError = error) });

    const request = http.expectOne('/api/household/planning-automation/retry');
    request.flush({ success: false, code: 'busy' }, { status: 409, statusText: 'Conflict' });

    expect(receivedError).toEqual(jasmine.any(HouseholdPlanningAutomationRetryError));
    expect((receivedError as HouseholdPlanningAutomationRetryError).code).toBe('busy');
    http.expectNone('/api/household/planning-automation/retry');
  });

  it('rejects malformed run snapshots and maps the last allowlisted retry code', () => {
    let invalidSnapshotError: unknown;
    service
      .retry('home-1', { expectedVersion: 3, occurrenceKey: 'synthetic-occurrence' })
      .subscribe({ error: (error: unknown) => (invalidSnapshotError = error) });
    http
      .expectOne('/api/household/planning-automation/retry')
      .flush({ success: true, data: { lastRun: { status: 'unknown' } } });
    expect(invalidSnapshotError).toEqual(
      jasmine.objectContaining({ message: 'INVALID_HOUSEHOLD_PLANNING_AUTOMATION_RUN_RESPONSE' })
    );

    let notFoundError: unknown;
    service
      .retry('home-1', { expectedVersion: 3, occurrenceKey: 'missing-occurrence' })
      .subscribe({ error: (error: unknown) => (notFoundError = error) });
    http
      .expectOne('/api/household/planning-automation/retry')
      .flush({ success: false, code: 'not_found' }, { status: 404, statusText: 'Not Found' });
    expect(notFoundError).toEqual(jasmine.any(HouseholdPlanningAutomationRetryError));
    expect((notFoundError as HouseholdPlanningAutomationRetryError).code).toBe('not_found');
  });

  it('rejects a malformed configuration snapshot before exposing it', () => {
    let receivedError: unknown;
    service.load('home-1').subscribe({ error: (error: unknown) => (receivedError = error) });
    http.expectOne('/api/household/planning-automation').flush({ success: true, data: null });

    expect(receivedError).toEqual(
      jasmine.objectContaining({ message: 'INVALID_HOUSEHOLD_PLANNING_AUTOMATION_RESPONSE' })
    );
    expect(service.snapshotFor('home-1')).toBeNull();
  });

  it('does not let a delayed older read replace a newer successful save', () => {
    service.load('home-1').subscribe();
    const olderRead = http.expectOne('/api/household/planning-automation');

    service.save('home-1', { expectedVersion: 2, enabled: false }).subscribe();
    const save = http.expectOne('/api/household/planning-automation');
    const paused = { ...config, version: 4, enabled: false, nextRunAt: null, nextRun: null };
    save.flush({ success: true, data: paused });
    olderRead.flush({ success: true, data: { ...config, version: 3 } });

    expect(service.snapshotFor('home-1')).toEqual(paused);
  });
});
