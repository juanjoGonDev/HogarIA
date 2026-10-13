import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';
import type { CalendarDayView, CalendarMeal } from '../../shared/models/calendar.model';
import { CalendarTimelineComponent } from './calendar-timeline.component';

describe('CalendarTimelineComponent shared meal access', () => {
  let fixture: ComponentFixture<CalendarTimelineComponent>;
  let component: CalendarTimelineComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CalendarTimelineComponent],
      providers: [
        {
          provide: I18nService,
          useValue: { t: (key: string) => key, changeTick: signal(0) }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CalendarTimelineComponent);
    component = fixture.componentInstance;
  });

  it('renders a nonparticipant shared meal as a read-only event, not a clickable block', () => {
    const sharedMeal: CalendarMeal = {
      id: 'shared-meal-other-member',
      date: '2026-10-05',
      mealType: 'lunch',
      title: 'Lentejas compartidas',
      time: '13:00',
      servings: 1,
      completed: false,
      isShared: true,
      participantIds: ['user-2'],
      canRecordConsumption: false
    };
    const day: CalendarDayView = {
      date: new Date('2026-10-05T12:00:00'),
      iso: '2026-10-05',
      inCurrentMonth: true,
      isToday: false,
      meals: [sharedMeal],
      calories: 0,
      hasNutrition: false,
      slots: { breakfast: [], lunch: [sharedMeal], snack: [], dinner: [] },
      planned: 1,
      done: 0,
      events: [],
      tasks: []
    };
    fixture.componentRef.setInput('days', [day]);
    fixture.detectChanges();

    const block = fixture.nativeElement.querySelector('[data-test="timeline-block-meal"]');
    expect(block).not.toBeNull();
    expect(block.tagName.toLowerCase()).toBe('div');
    expect(block.textContent).toContain('Lentejas compartidas');
    expect(
      fixture.nativeElement.querySelector('button[data-test="timeline-block-meal"]')
    ).toBeNull();
  });
});
