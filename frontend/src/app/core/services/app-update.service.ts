import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate, type VersionReadyEvent } from '@angular/service-worker';
import { filter, timer } from 'rxjs';

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Revalida versiones publicadas y recarga cuando Angular confirma una nueva shell. */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly updates = inject(SwUpdate);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private initialized = false;
  private checking = false;
  private activating = false;

  initialize(): void {
    if (this.initialized || !this.updates.isEnabled) return;
    this.initialized = true;

    this.updates.versionUpdates
      .pipe(
        filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => void this.activateAndReload());

    // The first check catches a deploy already present at boot; later checks cover an
    // already-open tab without relying on navigation or stale HTTP cache entries.
    timer(0, UPDATE_CHECK_INTERVAL_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.checkForUpdate());
  }

  private async checkForUpdate(): Promise<void> {
    if (this.checking || !this.updates.isEnabled) return;
    this.checking = true;
    try {
      await this.updates.checkForUpdate();
    } catch {
      // Offline/transient errors are retried on the next interval.
    } finally {
      this.checking = false;
    }
  }

  private async activateAndReload(): Promise<void> {
    if (this.activating || !this.updates.isEnabled) return;
    this.activating = true;
    try {
      // A false result can mean another tab already activated the manifest; reload anyway
      // so this client cannot keep running an older shell with mismatched lazy chunks.
      await this.updates.activateUpdate();
      this.document.defaultView?.location.reload();
    } catch {
      // A failed activation must not take down the running version; the next check retries.
      this.activating = false;
    }
  }
}
