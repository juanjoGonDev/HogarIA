import { Injectable, inject, signal } from '@angular/core';
import { StorageService } from './storage.service';
import {
  DEFAULT_EXPIRY_HORIZON_DAYS,
  isExpiryHorizonDays
} from '../../features/dashboard/dashboard-expiry.util';

const EXPIRY_HORIZON_STORAGE_KEY = 'dashboard-expiry-horizon-days';

@Injectable({ providedIn: 'root' })
export class DashboardPreferencesService {
  private readonly storage = inject(StorageService);
  readonly expiryHorizonDays = signal(this.readExpiryHorizon());

  setExpiryHorizonDays(value: unknown): boolean {
    if (!isExpiryHorizonDays(value)) return false;
    this.expiryHorizonDays.set(value);
    this.storage.set(EXPIRY_HORIZON_STORAGE_KEY, value);
    return true;
  }

  private readExpiryHorizon(): number {
    const stored = this.storage.get<unknown>(EXPIRY_HORIZON_STORAGE_KEY);
    return isExpiryHorizonDays(stored) ? stored : DEFAULT_EXPIRY_HORIZON_DAYS;
  }
}
