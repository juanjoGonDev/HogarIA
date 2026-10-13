import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';
import type { CalendarMeal } from '../../shared/models/calendar.model';
import { CalendarEventComponent } from './calendar-event.component';

describe('CalendarEventComponent shared meal access', () => {
  let fixture: ComponentFixture<CalendarEventComponent>;
  let component: CalendarEventComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CalendarEventComponent],
      providers: [
        {
          provide: I18nService,
          useValue: { t: (key: string) => key, changeTick: signal(0) }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CalendarEventComponent);
    component = fixture.componentInstance;
  });

  it("shows another member's plan as read-only and exposes the record action to participants", () => {
    const sharedMeal: CalendarMeal = {
      id: 'shared-meal-other-member',
      date: '2026-10-05',
      mealType: 'dinner',
      title: 'Lentejas compartidas',
      servings: 1,
      completed: false,
      isShared: true,
      participantIds: ['user-2'],
      canRecordConsumption: false
    };
    component.meal = sharedMeal;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Lentejas compartidas');
    expect(fixture.nativeElement.querySelector('button.cal-event__open')).toBeNull();

    component.meal = { ...sharedMeal, canRecordConsumption: true };
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button.cal-event__open')).not.toBeNull();
  });

  it('keeps a missing meal safe and renders a normal meal with its actions', () => {
    fixture.detectChanges();

    expect(component.canOpenMeal()).toBe(true);
    expect(component.tooltip()).toBe('');
    expect(component.kcalLabel()).toContain('0 kcal');

    const meal: CalendarMeal = {
      id: 'private-dinner',
      date: '2026-10-05',
      mealType: 'dinner',
      title: 'Lentejas caseras',
      time: '19:30',
      servings: 2,
      calories: 320,
      completed: true
    };
    component.meal = meal;
    fixture.detectChanges();

    expect(component.tooltip()).toContain('Lentejas caseras');
    expect(component.tooltip()).toContain('19:30');
    expect(component.tooltip()).toContain('640 kcal');
    expect(component.tooltip()).toContain('calendar.hecha');

    const open = spyOn(component.open, 'emit');
    const toggle = spyOn(component.toggle, 'emit');
    const remove = spyOn(component.remove, 'emit');
    const clickButton = (selector: string) => {
      const button = fixture.nativeElement.querySelector(selector) as HTMLButtonElement | null;
      button?.click();
    };
    clickButton('button.cal-event__open');
    clickButton('button[aria-label="calendar.unmark_done"]');
    clickButton('button[aria-label="calendar.quitar_comida"]');
    expect(open).toHaveBeenCalled();
    expect(toggle).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  it('keeps month-row events compact and omits their actions and calories', () => {
    component.mode = 'row';
    component.meal = {
      id: 'month-row',
      date: '2026-10-05',
      mealType: 'lunch',
      title: 'Ensalada',
      calories: 250,
      servings: 1,
      completed: false
    };
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('button.cal-event__open')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.cal-event__kcal')).toBeNull();
    expect(fixture.nativeElement.querySelector('.cal-event__actions')).toBeNull();
    expect(component.tooltip()).toContain('250 kcal');
  });
});
