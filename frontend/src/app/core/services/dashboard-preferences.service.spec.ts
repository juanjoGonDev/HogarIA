import { TestBed } from '@angular/core/testing';
import { DashboardPreferencesService } from './dashboard-preferences.service';
import { StorageService } from './storage.service';

describe('DashboardPreferencesService', () => {
  const storageKey = 'hogar:v1:dashboard-expiry-horizon-days';

  beforeEach(() => {
    localStorage.removeItem(storageKey);
    TestBed.configureTestingModule({ providers: [DashboardPreferencesService, StorageService] });
  });

  afterEach(() => localStorage.removeItem(storageKey));

  it('defaults to the current three-day expiry warning and persists valid changes', () => {
    const service = TestBed.inject(DashboardPreferencesService);
    expect(service.expiryHorizonDays()).toBe(3);

    expect(service.setExpiryHorizonDays(5)).toBeTrue();
    expect(service.expiryHorizonDays()).toBe(5);
    expect(JSON.parse(localStorage.getItem(storageKey) ?? 'null')).toBe(5);
  });

  it('loads valid stored values and rejects invalid persisted settings', () => {
    localStorage.setItem(storageKey, JSON.stringify(12));
    expect(TestBed.inject(DashboardPreferencesService).expiryHorizonDays()).toBe(12);

    TestBed.resetTestingModule();
    localStorage.setItem(storageKey, JSON.stringify(31));
    TestBed.configureTestingModule({ providers: [DashboardPreferencesService, StorageService] });
    expect(TestBed.inject(DashboardPreferencesService).expiryHorizonDays()).toBe(3);
  });

  it('rejects out-of-range or non-integral updates without changing persisted state', () => {
    const service = TestBed.inject(DashboardPreferencesService);
    expect(service.setExpiryHorizonDays(0)).toBeFalse();
    expect(service.setExpiryHorizonDays(31)).toBeFalse();
    expect(service.setExpiryHorizonDays(4.5)).toBeFalse();
    expect(service.setExpiryHorizonDays('5')).toBeFalse();
    expect(service.expiryHorizonDays()).toBe(3);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});
