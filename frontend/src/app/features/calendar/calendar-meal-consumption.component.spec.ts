import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { HouseholdMealConsumptionService } from '../../core/services/household-meal-consumption.service';
import { I18nService } from '../../core/services/i18n.service';
import type { CalendarMeal } from '../../shared/models/calendar.model';
import type { MealConsumptionRecord } from '../../core/services/household-meal-consumption.service';
import { CalendarMealConsumptionComponent } from './calendar-meal-consumption.component';

const meal: CalendarMeal = {
  id: 'shared-meal-1',
  date: '2026-10-13',
  mealType: 'dinner',
  title: 'Lentejas',
  servings: 4,
  completed: false,
  isShared: true,
  participantIds: ['user-1']
};

const unrecorded: MealConsumptionRecord = {
  mealId: meal.id,
  status: 'unrecorded',
  servings: null,
  version: 0,
  warnings: []
};

describe('CalendarMealConsumptionComponent', () => {
  let fixture: ComponentFixture<CalendarMealConsumptionComponent>;
  let service: jasmine.SpyObj<HouseholdMealConsumptionService>;

  beforeEach(async () => {
    service = jasmine.createSpyObj<HouseholdMealConsumptionService>(
      'HouseholdMealConsumptionService',
      ['load', 'save']
    );
    service.load.and.returnValue(of(unrecorded));
    service.save.and.returnValue(
      of({ ...unrecorded, status: 'realized', servings: 2, version: 1 })
    );
    await TestBed.configureTestingModule({
      imports: [CalendarMealConsumptionComponent],
      providers: [
        { provide: HouseholdMealConsumptionService, useValue: service },
        {
          provide: I18nService,
          useValue: { t: (key: string) => key, changeTick: () => 0 }
        }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(CalendarMealConsumptionComponent);
    fixture.componentRef.setInput('meal', meal);
    fixture.componentRef.setInput('householdId', 'home-1');
    fixture.detectChanges();
  });

  it('loads current status/version before enabling a save, and labels the actual servings field', () => {
    expect(service.load).toHaveBeenCalledOnceWith(meal.id, 'home-1');
    expect(
      fixture.nativeElement.querySelector('[data-test="meal-consumption-loading"]')
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-test="meal-consumption-form"]')
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('label[for="meal-consumption-servings"]')?.textContent
    ).toContain('calendar.consumption.servings');
    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-test="meal-consumption-save"]'
        ) as HTMLButtonElement
      ).disabled
    ).toBeTrue();
  });

  it('sends a positive actual serving count with the loaded version', () => {
    const input = fixture.nativeElement.querySelector(
      '#meal-consumption-servings'
    ) as HTMLInputElement;
    input.value = '2';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('[data-test="meal-consumption-form"]')
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(service.save).toHaveBeenCalledOnceWith(meal.id, 'home-1', {
      status: 'realized',
      servings: 2,
      expectedVersion: 0
    });
  });

  it('records a skipped meal with zero servings and the current version', () => {
    const notRealized = fixture.nativeElement.querySelector(
      'input[value="not_realized"]'
    ) as HTMLInputElement;
    notRealized.click();
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('[data-test="meal-consumption-form"]')
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(service.save).toHaveBeenCalledOnceWith(meal.id, 'home-1', {
      status: 'not_realized',
      servings: 0,
      expectedVersion: 0
    });
  });

  it('keeps the form unavailable during a load failure and exposes an explicit retry', () => {
    const pending = new Subject<MealConsumptionRecord>();
    service.load.and.returnValues(
      throwError(() => ({ status: 503 })),
      pending
    );
    fixture.componentRef.setInput('meal', { ...meal, id: 'shared-meal-2' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-test="meal-consumption-form"]')).toBeNull();

    (
      fixture.nativeElement.querySelector(
        '[data-test="meal-consumption-retry"]'
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(service.load).toHaveBeenCalledTimes(3);
    pending.next({ ...unrecorded, mealId: 'shared-meal-2' });
    pending.complete();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-test="meal-consumption-form"]')
    ).not.toBeNull();
  });

  it('does not retry a stale version automatically and requires reloading before another save', () => {
    service.save.and.returnValue(
      throwError(() => ({ status: 409, error: { code: 'MEAL_CONSUMPTION_VERSION_CONFLICT' } }))
    );
    fixture.componentInstance.servings = 2;
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('[data-test="meal-consumption-form"]')
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(service.save).toHaveBeenCalledTimes(1);
    expect(
      fixture.nativeElement.querySelector('[data-test="meal-consumption-conflict"]')
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-test="meal-consumption-reload"]')
    ).not.toBeNull();
  });

  it('offers only the not-realized recovery when the recipe snapshot is unavailable', async () => {
    service.save.and.returnValue(
      throwError(() => ({ status: 409, error: { code: 'RECIPE_SNAPSHOT_UNAVAILABLE' } }))
    );
    fixture.componentInstance.servings = 2;
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('[data-test="meal-consumption-form"]')
      .dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.canReverseAfterRecipeChange).toBeTrue();
    expect(fixture.componentInstance.status).toBe('realized');
    const realized = fixture.nativeElement.querySelector(
      '[data-test="meal-consumption-status-realized"]'
    ) as HTMLInputElement;
    const notRealized = fixture.nativeElement.querySelector(
      '[data-test="meal-consumption-status-not-realized"]'
    ) as HTMLInputElement;
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-test="meal-consumption-form"]')
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-test="meal-consumption-retry"]')).toBeNull();
    expect(realized.disabled).toBeTrue();
    expect(realized.checked).toBeTrue();
    expect(notRealized.checked).toBeFalse();
    expect(
      (
        fixture.nativeElement.querySelector(
          '[data-test="meal-consumption-save"]'
        ) as HTMLButtonElement
      ).disabled
    ).toBeTrue();

    service.save.and.returnValue(
      of({ ...unrecorded, status: 'not_realized', servings: 0, version: 1 })
    );
    notRealized.click();
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('[data-test="meal-consumption-form"]')
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(service.save).toHaveBeenCalledTimes(2);
    expect(service.save.calls.mostRecent().args).toEqual([
      meal.id,
      'home-1',
      { status: 'not_realized', servings: 0, expectedVersion: 0 }
    ]);
    expect(realized.disabled).toBeFalse();
  });
});
