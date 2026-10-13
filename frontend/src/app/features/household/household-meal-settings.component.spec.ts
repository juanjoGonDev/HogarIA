import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Subject, of, throwError } from 'rxjs';
import {
  HouseholdMealPlanningService,
  type HouseholdMealPlanningPatch,
  type HouseholdMealPlanningSettings
} from '../../core/services/household-meal-planning.service';
import { HouseholdMealSettingsComponent } from './household-meal-settings.component';

describe('HouseholdMealSettingsComponent', () => {
  let fixture: ComponentFixture<HouseholdMealSettingsComponent>;
  let api: jasmine.SpyObj<HouseholdMealPlanningService>;

  const settings = (mealTime = '14:00'): HouseholdMealPlanningSettings => ({
    household: {
      objective: { goals: ['balanced'], notes: 'Comida casera' },
      mealTypes: { breakfast: true, lunch: true, snack: false, dinner: true },
      mealTimes: { breakfast: '08:30', lunch: mealTime, snack: '17:00', dinner: '20:30' }
    },
    member: {
      goalOverrideEnabled: false,
      scheduleOverrideEnabled: false,
      personalObjective: { goals: ['variety'], notes: 'Alterna recetas' },
      personalSchedule: {
        mealTypes: { breakfast: true, lunch: true, snack: true, dinner: true },
        mealTimes: { breakfast: '09:00', lunch: '13:00', snack: '17:00', dinner: '21:00' }
      }
    },
    effective: {
      objective: { goals: ['balanced'], notes: 'Comida casera', source: 'household' },
      schedule: {
        mealTypes: { breakfast: true, lunch: true, snack: false, dinner: true },
        mealTimes: { breakfast: '08:30', lunch: mealTime, snack: '17:00', dinner: '20:30' },
        source: 'household'
      }
    }
  });

  function start(householdId = 'home-1', canEdit = false): void {
    fixture = TestBed.createComponent(HouseholdMealSettingsComponent);
    fixture.componentRef.setInput('householdId', householdId);
    fixture.componentRef.setInput('canEdit', canEdit);
    fixture.detectChanges();
  }

  function control<T extends HTMLElement>(selector: string): T {
    const found = fixture.nativeElement.querySelector(selector) as T | null;
    if (!found) throw new Error(`No se encontró ${selector}`);
    return found;
  }

  function toggle(selector: string): void {
    control<HTMLElement>(selector).click();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    api = jasmine.createSpyObj('HouseholdMealPlanningService', ['load', 'save']);
    api.load.and.returnValue(of(settings()));
    api.save.and.returnValue(of(settings()));

    await TestBed.configureTestingModule({
      imports: [CommonModule, RouterTestingModule, HouseholdMealSettingsComponent],
      providers: [{ provide: HouseholdMealPlanningService, useValue: api }]
    }).compileComponents();
  });

  it('loads settings and keeps both personal overrides off by default', () => {
    start();

    expect(api.load).toHaveBeenCalledOnceWith('home-1');
    expect(
      control<HTMLElement>('[data-test="member-goal-override"]').getAttribute('aria-checked')
    ).toBe('false');
    expect(
      control<HTMLElement>('[data-test="member-schedule-override"]').getAttribute('aria-checked')
    ).toBe('false');
    expect(control<HTMLInputElement>('[data-test="household-lunch-time"]').value).toBe('14:00');
  });

  it('lets a member edit only personal overrides and never sends household settings', () => {
    start('home-1', false);
    const commonLunch = control<HTMLButtonElement>('[data-test="household-meal-lunch"] button');
    expect(commonLunch.disabled).toBeTrue();

    toggle('[data-test="member-schedule-override"]');
    expect(control<HTMLInputElement>('[data-test="member-lunch-time"]').disabled).toBeFalse();
    toggle('[data-test="member-schedule-override"]');
    // Re-enable to verify the member-only patch keeps the home defaults out of the request.
    toggle('[data-test="member-schedule-override"]');
    control<HTMLButtonElement>('[data-test="meal-settings-save"] button').click();
    fixture.detectChanges();

    expect(api.save).toHaveBeenCalledOnceWith('home-1', {
      member: {
        scheduleOverrideEnabled: true,
        schedule: {
          mealTypes: { breakfast: true, lunch: true, snack: true, dinner: true },
          mealTimes: { breakfast: '09:00', lunch: '13:00', snack: '17:00', dinner: '21:00' }
        }
      }
    } satisfies HouseholdMealPlanningPatch);
  });

  it('patches only changed common fields when the member has home-settings permission', () => {
    start('home-1', true);
    toggle('[data-test="household-meal-lunch"] button');
    control<HTMLInputElement>('[data-test="household-lunch-time"]').value = '15:00';
    control<HTMLInputElement>('[data-test="household-lunch-time"]').dispatchEvent(
      new Event('input', { bubbles: true })
    );
    fixture.detectChanges();
    control<HTMLButtonElement>('[data-test="meal-settings-save"] button').click();
    fixture.detectChanges();

    expect(api.save).toHaveBeenCalledOnceWith('home-1', {
      household: { mealTypes: { lunch: false }, mealTimes: { lunch: '15:00' } }
    } satisfies HouseholdMealPlanningPatch);
  });

  it('saves personal meal and time changes under member scope only', () => {
    start('home-1', false);
    toggle('[data-test="member-schedule-override"]');
    toggle('[data-test="member-meal-snack"] button');
    const dinnerTime = control<HTMLInputElement>('[data-test="member-dinner-time"]');
    dinnerTime.value = '22:00';
    dinnerTime.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    control<HTMLButtonElement>('[data-test="meal-settings-save"] button').click();
    fixture.detectChanges();

    expect(api.save).toHaveBeenCalledOnceWith('home-1', {
      member: {
        scheduleOverrideEnabled: true,
        schedule: {
          mealTypes: { breakfast: true, lunch: true, snack: false, dinner: true },
          mealTimes: { breakfast: '09:00', lunch: '13:00', snack: '17:00', dinner: '22:00' }
        }
      }
    } satisfies HouseholdMealPlanningPatch);
  });

  it('saves home objective changes only for an editor and keeps at least one goal selected', () => {
    start('home-1', true);
    toggle('[data-test="household-goal-weight-loss"] button');
    expect(
      control<HTMLElement>('[data-test="household-goal-balanced"] button').getAttribute(
        'aria-checked'
      )
    ).toBe('false');
    control<HTMLButtonElement>('[data-test="meal-settings-save"] button').click();
    fixture.detectChanges();

    expect(api.save).toHaveBeenCalledOnceWith('home-1', {
      household: { objective: { goals: ['weight-loss'] } }
    } satisfies HouseholdMealPlanningPatch);
  });

  it('sends only the changed household note instead of overwriting the current goal', () => {
    start('home-1', true);
    const notes = control<HTMLTextAreaElement>('[data-test="household-objective-notes"]');
    notes.value = 'Más legumbres';
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    control<HTMLButtonElement>('[data-test="meal-settings-save"] button').click();
    fixture.detectChanges();

    expect(api.save).toHaveBeenCalledOnceWith('home-1', {
      household: { objective: { notes: 'Más legumbres' } }
    } satisfies HouseholdMealPlanningPatch);
  });

  it('marks invalid times and blocks an invalid partial update', () => {
    start('home-1', true);
    const lunchTime = control<HTMLInputElement>('[data-test="household-lunch-time"]');
    lunchTime.value = '';
    lunchTime.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    expect(lunchTime.getAttribute('aria-invalid')).toBe('true');
    expect(
      control<HTMLButtonElement>('[data-test="meal-settings-save"] button').disabled
    ).toBeTrue();
    expect(api.save).not.toHaveBeenCalled();
  });

  it('shows a household-context conflict separately from an ordinary save failure', () => {
    api.save.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { code: 'HOUSEHOLD_CONTEXT_CHANGED' }
          })
      )
    );
    start();
    toggle('[data-test="member-goal-override"]');
    control<HTMLButtonElement>('[data-test="meal-settings-save"] button').click();
    fixture.detectChanges();

    expect(control<HTMLElement>('[role="alert"]').textContent).toContain('hogar activo cambió');
  });

  it('shows recoverable load and save errors', () => {
    api.load.and.returnValues(
      throwError(() => new Error('offline')),
      of(settings())
    );
    start();
    expect(control<HTMLElement>('[role="alert"]').textContent).toContain('No se pudo');

    control<HTMLButtonElement>('[data-test="meal-settings-retry"] button').click();
    fixture.detectChanges();
    expect(control<HTMLElement>('[data-test="meal-settings-content"]')).toBeTruthy();

    api.save.and.returnValue(throwError(() => new Error('offline')));
    toggle('[data-test="member-goal-override"]');
    control<HTMLButtonElement>('[data-test="meal-settings-save"] button').click();
    fixture.detectChanges();
    expect(control<HTMLElement>('[role="alert"]').textContent).toContain('No se pudo');
  });

  it('ignores a load response from the previously selected home', () => {
    const oldRequest = new Subject<HouseholdMealPlanningSettings>();
    api.load.and.callFake((id: string) => (id === 'old-home' ? oldRequest : of(settings('16:00'))));
    start('old-home');

    fixture.componentRef.setInput('householdId', 'new-home');
    fixture.detectChanges();
    oldRequest.next(settings('11:00'));
    oldRequest.complete();
    fixture.detectChanges();

    expect(control<HTMLInputElement>('[data-test="household-lunch-time"]').value).toBe('16:00');
  });

  it('does not let a delayed save from an old home overwrite the newly selected home', () => {
    const pendingSave = new Subject<HouseholdMealPlanningSettings>();
    api.save.and.returnValue(pendingSave);
    api.load.and.callFake((id: string) => of(settings(id === 'home-2' ? '16:00' : '14:00')));
    start();

    toggle('[data-test="member-goal-override"]');
    control<HTMLButtonElement>('[data-test="meal-settings-save"] button').click();
    fixture.detectChanges();
    fixture.componentRef.setInput('householdId', 'home-2');
    fixture.detectChanges();
    pendingSave.next(settings('11:00'));
    pendingSave.complete();
    fixture.detectChanges();

    expect(control<HTMLInputElement>('[data-test="household-lunch-time"]').value).toBe('16:00');
  });

  it('uses labeled keyboard-operable shared controls with touch-sized targets', () => {
    start('home-1', true);
    const goalOverride = control<HTMLElement>('[data-test="member-goal-override"]');
    expect(goalOverride.getAttribute('role')).toBe('switch');
    expect(goalOverride.getAttribute('aria-labelledby')).toBeTruthy();
    expect(goalOverride.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    expect(goalOverride.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    goalOverride.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    );
    fixture.detectChanges();
    expect(goalOverride.getAttribute('aria-checked')).toBe('true');

    const checkbox = control<HTMLElement>('[data-test="household-meal-lunch"] button');
    expect(checkbox.getAttribute('role')).toBe('checkbox');
    expect(checkbox.getAttribute('aria-label') ?? checkbox.textContent).toContain('Almuerzo');
    expect(checkbox.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    const timeInput = control<HTMLInputElement>('[data-test="household-lunch-time"]');
    expect(timeInput.labels?.length).toBe(1);
    expect(timeInput.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });
});
