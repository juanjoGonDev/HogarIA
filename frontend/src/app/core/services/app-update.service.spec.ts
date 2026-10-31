import { DOCUMENT } from '@angular/common';
import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AppUpdateService } from './app-update.service';

describe('AppUpdateService', () => {
  let service: AppUpdateService;
  let events: Subject<VersionEvent>;
  let enabled: boolean;
  let checkForUpdate: jasmine.Spy;
  let activateUpdate: jasmine.Spy;
  let reload: jasmine.Spy;

  beforeEach(() => {
    events = new Subject<VersionEvent>();
    enabled = true;
    checkForUpdate = jasmine.createSpy('checkForUpdate').and.resolveTo(false);
    // A false result is possible when another tab already activated the manifest; this
    // tab still must reload to get out of the old shell.
    activateUpdate = jasmine.createSpy('activateUpdate').and.resolveTo(false);
    reload = jasmine.createSpy('reload');

    const updates = {
      get isEnabled() {
        return enabled;
      },
      versionUpdates: events.asObservable(),
      checkForUpdate,
      activateUpdate
    } as unknown as SwUpdate;
    const documentStub = {
      defaultView: { location: { reload } }
    } as unknown as Document;

    TestBed.configureTestingModule({
      providers: [
        AppUpdateService,
        { provide: SwUpdate, useValue: updates },
        { provide: DOCUMENT, useValue: documentStub }
      ]
    });
    service = TestBed.inject(AppUpdateService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    events.complete();
  });

  it('checks immediately and reloads after a new version is ready', fakeAsync(() => {
    service.initialize();
    tick(0);
    flushMicrotasks();
    expect(checkForUpdate).toHaveBeenCalledTimes(1);

    events.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old-version' },
      latestVersion: { hash: 'new-version' }
    });
    flushMicrotasks();

    expect(activateUpdate).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  }));

  it('does not check, activate, or reload when service workers are disabled', fakeAsync(() => {
    enabled = false;
    service.initialize();
    tick(10 * 60 * 1000);
    events.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old-version' },
      latestVersion: { hash: 'new-version' }
    });
    flushMicrotasks();

    expect(checkForUpdate).not.toHaveBeenCalled();
    expect(activateUpdate).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  }));

  it('retries after a transient update-check error without reloading the running version', fakeAsync(() => {
    checkForUpdate.and.rejectWith(new Error('offline'));
    service.initialize();
    tick(0);
    flushMicrotasks();

    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  }));
});
