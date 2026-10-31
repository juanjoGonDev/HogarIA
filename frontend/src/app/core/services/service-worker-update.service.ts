import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';
import { EMPTY, from, switchMap, timer } from 'rxjs';
import { catchError } from 'rxjs/operators';

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class ServiceWorkerUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly updateAvailable = signal(false);
  readonly activationFailed = signal(false);

  constructor() {
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event.type === 'VERSION_READY') this.updateAvailable.set(true);
    });

    timer(0, UPDATE_CHECK_INTERVAL_MS)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap(() => from(this.checkForUpdate()).pipe(catchError(() => EMPTY)))
      )
      .subscribe();
  }

  async checkForUpdate(): Promise<void> {
    if (!this.swUpdate.isEnabled) return;

    try {
      await this.swUpdate.checkForUpdate();
    } catch {
      // A failed/offline check should not interrupt the current application session.
    }
  }

  async activateUpdateAndReload(): Promise<void> {
    if (!this.updateAvailable()) return;

    try {
      const activated = await this.swUpdate.activateUpdate();
      if (!activated) {
        this.activationFailed.set(true);
        return;
      }

      this.activationFailed.set(false);
      this.updateAvailable.set(false);
      this.document.defaultView?.location.reload();
    } catch {
      // Keep the notice visible so the user can retry; never reload an unactivated shell.
      this.activationFailed.set(true);
    }
  }
}
