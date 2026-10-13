import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { HouseholdPlanningAutomationNoticeComponent } from './household-planning-automation-notice.component';
import {
  HouseholdPlanningAutomationConflict,
  HouseholdPlanningAutomationService,
  type HouseholdPlanningAutomationResponse
} from '../../core/services/household-planning-automation.service';
import { I18nService } from '../../core/services/i18n.service';

const CONFIGURED: HouseholdPlanningAutomationResponse = {
  enabled: true,
  mode: 'generate',
  scopes: ['tasks', 'meals'],
  weekday: 1,
  localTime: '08:30',
  timeZone: 'Europe/Madrid',
  version: 4,
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

const EMPTY: HouseholdPlanningAutomationResponse = {
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

describe('HouseholdPlanningAutomationNoticeComponent', () => {
  let fixture: ComponentFixture<HouseholdPlanningAutomationNoticeComponent>;
  let component: HouseholdPlanningAutomationNoticeComponent;
  let service: jasmine.SpyObj<HouseholdPlanningAutomationService>;
  let config: HouseholdPlanningAutomationResponse;

  beforeEach(async () => {
    config = CONFIGURED;
    service = jasmine.createSpyObj<HouseholdPlanningAutomationService>(
      'HouseholdPlanningAutomationService',
      ['load', 'save', 'snapshotFor']
    );
    service.load.and.callFake(() => of(config));
    service.snapshotFor.and.callFake(() => config);
    service.save.and.callFake((_householdId, patch) => {
      config =
        patch.enabled === true
          ? { ...CONFIGURED, version: config.version + 1 }
          : {
              ...config,
              enabled: patch.enabled ?? config.enabled,
              version: config.version + 1,
              nextRun: null,
              nextRunAt: null
            };
      return of(config);
    });

    await TestBed.configureTestingModule({
      imports: [HouseholdPlanningAutomationNoticeComponent],
      providers: [
        { provide: HouseholdPlanningAutomationService, useValue: service },
        {
          provide: I18nService,
          useValue: {
            resolved: signal<'es' | 'en'>('es'),
            changeTick: signal(0),
            t: (key: string, params?: Record<string, string>) => {
              let value =
                key === 'household.automation.notice_active'
                  ? '{dateTime} · {timeZone}'
                  : key === 'household.automation.notice_paused_schedule'
                    ? 'Se ejecutará cada {day} a las {time} · {timeZone}'
                    : key === 'household.automation.monday'
                      ? 'Lunes'
                      : key;
              for (const [name, text] of Object.entries(params ?? {})) {
                value = value.replaceAll(`{${name}}`, text);
              }
              return value;
            }
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HouseholdPlanningAutomationNoticeComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('householdId', 'synthetic-home');
    fixture.componentRef.setInput('canManage', true);
    fixture.componentRef.setInput('canActivate', true);
  });

  afterEach(() => fixture.destroy());

  it('shows the server-provided next run with its chosen time zone', () => {
    fixture.detectChanges();

    expect(service.load).toHaveBeenCalledOnceWith('synthetic-home');
    const notice = fixture.nativeElement.querySelector('[data-test="planning-automation-notice"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain('Europe/Madrid');
    expect(notice.textContent).toContain('08:30');
    expect(notice.querySelectorAll('button').length).toBe(1);
    expect(
      notice
        .querySelector('[data-test="planning-automation-toggle"] button')
        .getAttribute('aria-label')
    ).toBe('household.automation.notice_pause');
  });

  it('pauses and resumes through one toggle using the returned version and next occurrence', () => {
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '[data-test="planning-automation-toggle"] button'
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(service.save).toHaveBeenCalledOnceWith('synthetic-home', {
      expectedVersion: 4,
      enabled: false
    });
    expect(fixture.nativeElement.textContent).toContain('household.automation.notice_paused');
    expect(fixture.nativeElement.textContent).toContain('Lunes');
    expect(fixture.nativeElement.querySelectorAll('button').length).toBe(1);
    expect(
      fixture.nativeElement
        .querySelector('[data-test="planning-automation-toggle"] button')
        .getAttribute('aria-label')
    ).toBe('household.automation.notice_resume');

    (
      fixture.nativeElement.querySelector(
        '[data-test="planning-automation-toggle"] button'
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(service.save).toHaveBeenCalledTimes(2);
    expect(service.save.calls.mostRecent().args[1]).toEqual({ expectedVersion: 5, enabled: true });
    expect(fixture.nativeElement.textContent).toContain('Europe/Madrid');
    expect(fixture.nativeElement.textContent).toContain('08:30');
  });

  it('hides the persistent notice until a complete schedule has been saved', () => {
    config = EMPTY;
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-test="planning-automation-notice"]')
    ).toBeNull();
  });

  it('keeps the toggle disabled and explains the missing permission', () => {
    fixture.componentRef.setInput('canManage', false);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      '[data-test="planning-automation-toggle"] button'
    ) as HTMLButtonElement;

    expect(button.disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('household.automation.notice_permission');
    button.click();
    expect(service.save).not.toHaveBeenCalled();
  });

  it('surfaces a version conflict without retrying a potentially completed action', () => {
    const newest = { ...CONFIGURED, enabled: false, version: 5, nextRunAt: null, nextRun: null };
    service.save.and.callFake(() => {
      config = newest;
      return throwError(() => new HouseholdPlanningAutomationConflict(newest));
    });
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '[data-test="planning-automation-toggle"] button'
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(service.save).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'household.automation.version_conflict'
    );
    expect(fixture.nativeElement.querySelectorAll('button').length).toBe(1);
  });

  it('does not fabricate the next run when loading fails', () => {
    config = EMPTY;
    service.snapshotFor.and.returnValue(null);
    service.load.and.returnValue(throwError(() => new Error('offline')));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'household.automation.notice_load_error'
    );
    expect(
      fixture.nativeElement.querySelector('[data-test="planning-automation-toggle"]')
    ).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('button').length).toBe(0);
  });

  it('stays hidden without an active household', () => {
    service.snapshotFor.withArgs('').and.returnValue(null);
    fixture.componentRef.setInput('householdId', '');
    fixture.detectChanges();

    expect(service.load).not.toHaveBeenCalled();
    expect(
      fixture.nativeElement.querySelector('[data-test="planning-automation-notice"]')
    ).toBeNull();
  });

  it('does not resume a paused schedule without calendar edit permission', () => {
    config = {
      ...CONFIGURED,
      enabled: false,
      nextRun: null,
      nextRunAt: null
    };
    fixture.componentRef.setInput('canActivate', false);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      '[data-test="planning-automation-toggle"] button'
    ) as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain(
      'household.automation.notice_activate_permission'
    );
    button.click();
    expect(service.save).not.toHaveBeenCalled();
  });

  it('surfaces an unexpected toggle error without retrying the mutation', () => {
    service.save.and.returnValue(throwError(() => new Error('network timeout')));
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        '[data-test="planning-automation-toggle"] button'
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(service.save).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'household.automation.notice_toggle_error'
    );
    expect(fixture.nativeElement.querySelectorAll('button').length).toBe(1);
  });

  it('falls back to the server schedule label when its time zone cannot be formatted', () => {
    const occurrence = {
      ...CONFIGURED.nextRun!,
      timeZone: 'not-a-valid-time-zone'
    };

    expect(component.formatOccurrence(occurrence)).toContain('2026-10-19 08:30');
  });
});
