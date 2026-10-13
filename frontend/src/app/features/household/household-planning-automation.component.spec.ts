import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { HouseholdPlanningAutomationComponent } from './household-planning-automation.component';
import {
  HouseholdPlanningAutomationConflict,
  HouseholdPlanningAutomationService,
  type HouseholdPlanningAutomationResponse
} from '../../core/services/household-planning-automation.service';
import { I18nService } from '../../core/services/i18n.service';

const DEFAULT_CONFIG: HouseholdPlanningAutomationResponse = {
  enabled: false,
  mode: null,
  scopes: [],
  weekday: null,
  localTime: null,
  timeZone: null,
  version: 0,
  nextRunAt: null,
  nextRun: null
};

describe('HouseholdPlanningAutomationComponent', () => {
  let fixture: ComponentFixture<HouseholdPlanningAutomationComponent>;
  let component: HouseholdPlanningAutomationComponent;
  let service: jasmine.SpyObj<HouseholdPlanningAutomationService>;
  let savedConfig: HouseholdPlanningAutomationResponse;

  beforeEach(async () => {
    savedConfig = DEFAULT_CONFIG;
    service = jasmine.createSpyObj<HouseholdPlanningAutomationService>(
      'HouseholdPlanningAutomationService',
      ['load', 'save', 'retry', 'snapshotFor']
    );
    service.load.and.callFake(() => {
      savedConfig = { ...savedConfig };
      return of(savedConfig);
    });
    service.save.and.callFake((_householdId, patch) => {
      savedConfig = {
        ...savedConfig,
        ...patch,
        enabled: patch.enabled ?? savedConfig.enabled,
        scopes: patch.scopes ?? savedConfig.scopes,
        version: savedConfig.version + 1,
        nextRun: savedConfig.enabled ? savedConfig.nextRun : null,
        nextRunAt: savedConfig.enabled ? savedConfig.nextRunAt : null
      } as HouseholdPlanningAutomationResponse;
      return of(savedConfig);
    });
    service.retry.and.callFake(() => {
      savedConfig = {
        ...savedConfig,
        lastRun: {
          ...(savedConfig.lastRun ?? {
            occurrenceKey: 'synthetic-occurrence',
            targetWeekStart: '2026-10-19',
            status: 'review_required' as const,
            failureCode: 'private-provider-detail',
            updatedAt: '2026-10-18T18:30:00.000Z'
          }),
          status: 'in_progress',
          failureCode: null
        }
      };
      return of(savedConfig.lastRun!);
    });
    service.snapshotFor.and.callFake(() => savedConfig);

    await TestBed.configureTestingModule({
      imports: [HouseholdPlanningAutomationComponent],
      providers: [
        { provide: HouseholdPlanningAutomationService, useValue: service },
        {
          provide: I18nService,
          useValue: {
            resolved: signal<'es' | 'en'>('es'),
            changeTick: signal(0),
            t: (key: string) => key
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HouseholdPlanningAutomationComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('householdId', 'synthetic-home');
    fixture.componentRef.setInput('canEdit', true);
  });

  afterEach(() => fixture.destroy());

  it('loads an empty schedule and requires an explicit mode, scope, weekday, time, and IANA zone', () => {
    fixture.detectChanges();

    expect(service.load).toHaveBeenCalledOnceWith('synthetic-home');
    expect(component.response).toEqual(DEFAULT_CONFIG);
    expect(component.canSave).toBeFalse();
    expect(
      fixture.nativeElement.querySelector('[data-test="planning-automation-save"] button').disabled
    ).toBeTrue();
  });

  it('keeps an unselected scope absent when the user clears it', () => {
    fixture.detectChanges();
    component.setScope('tasks', false);

    expect(component.draft.scopes).toEqual([]);
    expect(component.canSave).toBeFalse();
  });

  it('uses the shared accessible picker for the explicit weekday choice', () => {
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector(
      '[data-test="planning-automation-weekday"] .picker__trigger'
    ) as HTMLButtonElement;
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    trigger.click();
    fixture.detectChanges();

    const options = fixture.nativeElement.querySelectorAll(
      '[role="option"]'
    ) as NodeListOf<HTMLElement>;
    const monday = Array.from(options).find((option) =>
      option.textContent?.includes('household.automation.monday')
    );
    expect(monday).toBeDefined();
    if (!monday) return;
    monday.click();
    fixture.detectChanges();

    expect(component.draft.weekday).toBe(1);
    expect(trigger.textContent).toContain('household.automation.monday');
  });

  it('saves configuration with expectedVersion without silently activating it', () => {
    savedConfig = { ...DEFAULT_CONFIG, version: 6 };
    service.load.and.returnValue(of(savedConfig));
    fixture.detectChanges();

    component.setMode('generate');
    component.setScope('tasks', true);
    component.setScope('meals', true);
    component.setWeekday('1');
    component.setLocalTime('20:30');
    component.setTimeZone('Europe/Madrid');
    fixture.detectChanges();

    expect(component.canSave).toBeTrue();
    const saveButton = fixture.nativeElement.querySelector(
      '[data-test="planning-automation-save"] button'
    ) as HTMLButtonElement;
    expect(saveButton.disabled).toBeFalse();
    spyOn(component, 'save').and.callThrough();
    saveButton.click();
    expect(component.save).toHaveBeenCalledTimes(1);
    fixture.detectChanges();

    expect(service.save).toHaveBeenCalledOnceWith('synthetic-home', {
      expectedVersion: 6,
      mode: 'generate',
      scopes: ['tasks', 'meals'],
      weekday: 1,
      localTime: '20:30',
      timeZone: 'Europe/Madrid'
    });
    expect(savedConfig.enabled).toBeFalse();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain(
      'household.automation.saved'
    );
  });

  it('distinguishes recognized permission failures from other save errors', () => {
    savedConfig = {
      ...DEFAULT_CONFIG,
      mode: 'generate',
      scopes: ['tasks'],
      weekday: 1,
      localTime: '20:30',
      timeZone: 'Europe/Madrid'
    };
    service.load.and.returnValue(of(savedConfig));
    fixture.detectChanges();
    component.setMode('repeat');

    for (const code of ['HOUSEHOLD_SETTINGS_REQUIRED', 'HOUSEHOLD_CALENDAR_EDIT_REQUIRED']) {
      service.save.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 403, error: { code } }))
      );

      component.save();

      expect(component.errorKey).toBe('household.automation.permission_error');
    }

    service.save.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    component.save();
    expect(component.errorKey).toBe('household.automation.save_error');

    service.save.and.returnValue(throwError(() => new Error('synthetic network failure')));
    component.save();
    expect(component.errorKey).toBe('household.automation.save_error');
  });

  it('uses a newer shared-service version after the persistent notice toggles activation', () => {
    savedConfig = {
      ...DEFAULT_CONFIG,
      mode: 'generate',
      scopes: ['tasks'],
      weekday: 1,
      localTime: '20:30',
      timeZone: 'Europe/Madrid',
      version: 1
    };
    service.load.and.returnValue(of(savedConfig));
    fixture.detectChanges();

    savedConfig = { ...savedConfig, version: 3 };
    service.snapshotFor.and.returnValue(savedConfig);
    component.setMode('repeat');
    component.setScope('tasks', false);
    component.setScope('meals', true);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        '[data-test="planning-automation-save"] button'
      ) as HTMLButtonElement
    ).click();

    expect(service.save).toHaveBeenCalledOnceWith('synthetic-home', {
      expectedVersion: 3,
      mode: 'repeat',
      scopes: ['meals'],
      weekday: 1,
      localTime: '20:30',
      timeZone: 'Europe/Madrid'
    });
  });

  it('rejects invalid time zones locally and keeps the validation error accessible', () => {
    fixture.detectChanges();
    component.setMode('repeat');
    component.setScope('tasks', true);
    component.setWeekday('4');
    component.setLocalTime('18:45');
    component.setTimeZone('+02:00');
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        '[data-test="planning-automation-save"] button'
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(service.save).not.toHaveBeenCalled();
    expect(
      fixture.nativeElement
        .querySelector('[data-test="planning-automation-validation"]')
        ?.getAttribute('role')
    ).toBe('alert');
    expect(
      fixture.nativeElement
        .querySelector('[data-test="planning-automation-time-zone"]')
        .getAttribute('aria-invalid')
    ).toBe('true');
  });

  it('does not overwrite a changed version after a CAS conflict until the user reloads it', () => {
    const latest = {
      ...DEFAULT_CONFIG,
      mode: 'repeat' as const,
      scopes: ['meals'] as const,
      weekday: 6,
      localTime: '09:15',
      timeZone: 'Europe/London',
      version: 9
    } as HouseholdPlanningAutomationResponse;
    service.snapshotFor.and.returnValue(latest);
    fixture.detectChanges();
    component.setMode('generate');
    component.setScope('tasks', true);
    component.setWeekday('2');
    component.setLocalTime('11:00');
    component.setTimeZone('Europe/Madrid');
    service.save.and.returnValue(throwError(() => new HouseholdPlanningAutomationConflict(latest)));
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '[data-test="planning-automation-save"] button'
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(component.versionConflict).toBeTrue();
    expect(component.canSave).toBeFalse();
    expect(
      fixture.nativeElement.querySelector('[data-test="planning-automation-reload-current"]')
    ).not.toBeNull();
    expect(component.draft.mode).toBe('generate');

    (
      fixture.nativeElement.querySelector(
        '[data-test="planning-automation-reload-current"] button'
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(component.versionConflict).toBeFalse();
    expect(component.response?.version).toBe(9);
    expect(component.draft.mode).toBe('repeat');
    expect(component.draft.timeZone).toBe('Europe/London');
  });

  it('keeps the schedule visible but read-only without household settings permission', () => {
    savedConfig = {
      ...DEFAULT_CONFIG,
      mode: 'generate',
      scopes: ['tasks'],
      weekday: 1,
      localTime: '20:00',
      timeZone: 'Europe/Madrid'
    };
    service.load.and.returnValue(of(savedConfig));
    fixture.componentRef.setInput('canEdit', false);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-test="planning-automation-settings"] fieldset')
        .disabled
    ).toBeTrue();
    expect(component.canSave).toBeFalse();
    expect(service.save).not.toHaveBeenCalled();
  });

  it('shows sanitized last-run metadata and retries only the review-required occurrence', () => {
    savedConfig = {
      ...DEFAULT_CONFIG,
      version: 12,
      lastRun: {
        occurrenceKey: 'synthetic-occurrence',
        targetWeekStart: '2026-10-19',
        status: 'review_required',
        failureCode: 'private-provider-detail',
        updatedAt: '2026-10-18T18:30:00.000Z'
      }
    };
    service.load.and.callFake(() => of(savedConfig));
    fixture.detectChanges();

    const lastRun = fixture.nativeElement.querySelector(
      '[data-test="planning-automation-last-run"]'
    ) as HTMLElement;
    expect(lastRun.textContent).toContain('2026-10-19');
    expect(lastRun.textContent).toContain('household.automation.run_status_review_required');
    expect(lastRun.textContent).not.toContain('private-provider-detail');
    expect(lastRun.querySelector('[data-test="planning-automation-review-retry"]')).not.toBeNull();

    (
      lastRun.querySelector(
        '[data-test="planning-automation-review-retry"] button'
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(service.retry).toHaveBeenCalledOnceWith('synthetic-home', {
      expectedVersion: 12,
      occurrenceKey: 'synthetic-occurrence'
    });
    expect(service.load).toHaveBeenCalledTimes(2);
    expect(
      fixture.nativeElement.querySelector('[data-test="planning-automation-review-retry"]')
    ).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('household.automation.retry_accepted');
  });

  it('does not offer retry for completed runs or when a fresh status is needed after an ambiguous result', () => {
    savedConfig = {
      ...DEFAULT_CONFIG,
      lastRun: {
        occurrenceKey: 'synthetic-occurrence',
        targetWeekStart: '2026-10-19',
        status: 'completed',
        failureCode: null,
        updatedAt: '2026-10-18T18:30:00.000Z'
      }
    };
    service.load.and.returnValue(of(savedConfig));
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-test="planning-automation-review-retry"]')
    ).toBeNull();

    const reviewConfig = {
      ...savedConfig,
      lastRun: { ...savedConfig.lastRun!, status: 'review_required' as const }
    };
    service.load.and.returnValues(
      of(reviewConfig),
      throwError(() => new Error('timeout')),
      of(savedConfig)
    );
    service.retry.and.returnValue(throwError(() => new Error('timeout')));
    component.load();
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '[data-test="planning-automation-review-retry"] button'
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(component.retryNeedsRefresh).toBeTrue();
    expect(service.retry).toHaveBeenCalledTimes(1);
    expect(
      fixture.nativeElement.querySelector('[data-test="planning-automation-refresh-run"]')
    ).not.toBeNull();
    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-test="planning-automation-review-retry"] button'
        ) as HTMLButtonElement
      ).disabled
    ).toBeTrue();

    (
      fixture.nativeElement.querySelector(
        '[data-test="planning-automation-refresh-run"] button'
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(component.retryNeedsRefresh).toBeFalse();
    expect(
      fixture.nativeElement.querySelector('[data-test="planning-automation-review-retry"]')
    ).toBeNull();
  });
});
