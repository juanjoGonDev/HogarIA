import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { ServiceWorkerUpdateService } from './service-worker-update.service';

describe('ServiceWorkerUpdateService', () => {
  let versionEvents: Subject<any>;
  let swUpdate: any;
  let reload: jasmine.Spy;

  beforeEach(() => {
    versionEvents = new Subject<any>();
    swUpdate = {
      isEnabled: true,
      versionUpdates: versionEvents.asObservable(),
      checkForUpdate: jasmine.createSpy('checkForUpdate').and.resolveTo(false),
      activateUpdate: jasmine.createSpy('activateUpdate').and.resolveTo(true)
    };
    reload = jasmine.createSpy('reload');

    TestBed.configureTestingModule({
      providers: [
        ServiceWorkerUpdateService,
        { provide: SwUpdate, useValue: swUpdate },
        {
          provide: DOCUMENT,
          useValue: { defaultView: { location: { reload } } }
        }
      ]
    });
  });

  it('checks for an update but keeps the notice hidden when the worker reports no update', async () => {
    const service = TestBed.inject(ServiceWorkerUpdateService);
    await service.checkForUpdate();
    versionEvents.next({ type: 'NO_NEW_VERSION_DETECTED', version: { hash: 'current' } });

    expect(swUpdate.checkForUpdate).toHaveBeenCalled();
    expect(service.updateAvailable()).toBeFalse();
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps the current session usable when a version check fails offline', async () => {
    const service = TestBed.inject(ServiceWorkerUpdateService);
    swUpdate.checkForUpdate.and.rejectWith(new Error('synthetic offline failure'));

    await expectAsync(service.checkForUpdate()).toBeResolvedTo(undefined);

    expect(service.updateAvailable()).toBeFalse();
    expect(reload).not.toHaveBeenCalled();
  });

  it('announces a ready version without activating or reloading it automatically', () => {
    const service = TestBed.inject(ServiceWorkerUpdateService);
    versionEvents.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old' },
      latestVersion: { hash: 'new' }
    });

    expect(service.updateAvailable()).toBeTrue();
    expect(swUpdate.activateUpdate).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('activates and reloads only after the caller explicitly accepts', async () => {
    const service = TestBed.inject(ServiceWorkerUpdateService);
    versionEvents.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old' },
      latestVersion: { hash: 'new' }
    });

    expect(swUpdate.activateUpdate).not.toHaveBeenCalled();
    await service.activateUpdateAndReload();

    expect(swUpdate.activateUpdate).toHaveBeenCalledOnceWith();
    expect(reload).toHaveBeenCalledOnceWith();
    expect(service.updateAvailable()).toBeFalse();
  });

  it('does not reload if activation fails and keeps the action available for retry', async () => {
    const service = TestBed.inject(ServiceWorkerUpdateService);
    versionEvents.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old' },
      latestVersion: { hash: 'new' }
    });
    swUpdate.activateUpdate.and.rejectWith(new Error('synthetic activation failure'));

    await expectAsync(service.activateUpdateAndReload()).toBeResolvedTo(undefined);

    expect(reload).not.toHaveBeenCalled();
    expect(service.updateAvailable()).toBeTrue();
  });

  it('keeps the update notice when the worker declines activation', async () => {
    const service = TestBed.inject(ServiceWorkerUpdateService);
    versionEvents.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old' },
      latestVersion: { hash: 'new' }
    });
    swUpdate.activateUpdate.and.resolveTo(false);

    await service.activateUpdateAndReload();

    expect(reload).not.toHaveBeenCalled();
    expect(service.updateAvailable()).toBeTrue();
    expect(service.activationFailed()).toBeTrue();
  });

  it('does not notify when service workers are disabled', () => {
    swUpdate.isEnabled = false;
    const service = TestBed.inject(ServiceWorkerUpdateService);
    versionEvents.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old' },
      latestVersion: { hash: 'new' }
    });

    expect(service.updateAvailable()).toBeFalse();
    expect(swUpdate.checkForUpdate).not.toHaveBeenCalled();
  });
});
