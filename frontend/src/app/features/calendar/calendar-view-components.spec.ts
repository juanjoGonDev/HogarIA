import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';
import type {
  CalendarDayView,
  CalendarHouseholdTask,
  CalendarMeal,
  HouseholdEvent
} from '../../shared/models/calendar.model';
import { CalendarAgendaViewComponent } from './calendar-agenda-view.component';
import { CalendarEventComponent } from './calendar-event.component';
import { CalendarHouseholdEventsComponent } from './calendar-household-events.component';
import { CalendarHouseholdTasksComponent } from './calendar-household-tasks.component';
import { CalendarMiniMonthComponent } from './calendar-mini-month.component';
import { CalendarMonthComponent } from './calendar-month.component';
import { CalendarYearComponent } from './calendar-year.component';

function meal(id: string, overrides: Partial<CalendarMeal> = {}): CalendarMeal {
  return {
    id,
    date: '2026-10-05',
    mealType: 'lunch',
    title: 'Lentejas',
    servings: 2,
    completed: false,
    ...overrides
  };
}

function day(iso: string, overrides: Partial<CalendarDayView> = {}): CalendarDayView {
  const date = new Date(`${iso}T12:00:00`);
  const meals: CalendarMeal[] = [];
  return {
    date,
    iso,
    inCurrentMonth: true,
    isToday: false,
    meals,
    calories: 0,
    hasNutrition: false,
    slots: { breakfast: [], lunch: [], snack: [], dinner: [] },
    planned: 0,
    done: 0,
    events: [],
    tasks: [],
    ...overrides
  };
}

function event(overrides: Partial<HouseholdEvent> = {}): HouseholdEvent {
  return {
    id: 'event-1',
    title: 'Comprar ingredientes',
    kind: 'shopping',
    date: '2026-10-05',
    startTime: '10:00',
    endTime: '10:30',
    allDay: false,
    color: null,
    notes: null,
    location: null,
    source: 'manual',
    userId: 'user-1',
    authorName: null,
    editable: true,
    ...overrides
  };
}

function task(overrides: Partial<CalendarHouseholdTask> = {}): CalendarHouseholdTask {
  return {
    id: 'task-1',
    title: 'Limpiar cocina',
    date: '2026-10-05',
    time: null,
    zoneName: 'Cocina',
    assignedMemberId: 'member-1',
    assignedMemberName: 'Ana',
    completed: false,
    ...overrides
  };
}

describe('calendar view presentation components', () => {
  let i18n: jasmine.SpyObj<I18nService>;

  beforeEach(async () => {
    i18n = jasmine.createSpyObj<I18nService>('I18nService', ['t']);
    i18n.t.and.callFake((key, params) =>
      params ? `${String(key)} ${Object.values(params).join(' ')}` : String(key)
    );
    Object.defineProperty(i18n, 'changeTick', { value: signal(0) });
    await TestBed.configureTestingModule({
      imports: [CalendarHouseholdTasksComponent],
      providers: [{ provide: I18nService, useValue: i18n }]
    }).compileComponents();
  });

  it('filters the agenda to days with content and formats each weekday', () => {
    const component = new CalendarAgendaViewComponent();
    const withMeal = day('2026-10-05', { meals: [meal('meal-1')] });
    const withEvent = day('2026-10-06', { events: [event()] });
    const withTask = day('2026-10-07', { tasks: [task()] });
    const empty = day('2026-10-08');
    component.days = [withMeal, withEvent, withTask, empty];

    expect(component.visibleDays()).toEqual([withMeal, withEvent, withTask]);
    expect(component.weekday(withMeal)).toBeTruthy();
    component.days = [];
    expect(component.visibleDays()).toEqual([]);
  });

  it('shows household task assignee, zone, status and compact overflow count', () => {
    const component = TestBed.runInInjectionContext(() => new CalendarHouseholdTasksComponent());
    component.tasks = [task(), task({ id: 'task-2', completed: true })];
    component.maxVisible = 1;

    expect(component.visibleTasks().map((entry) => entry.id)).toEqual(['task-1']);
    expect(component.hiddenCount()).toBe(1);
    const label = component.description(component.tasks[1]);
    expect(label).toContain('calendar.task_zone Cocina');
    expect(label).toContain('calendar.task_assignee Ana');
    expect(label).toContain('calendar.task_completed');
  });

  it('renders the household task as a read-only accessible calendar item', () => {
    const fixture = TestBed.createComponent(CalendarHouseholdTasksComponent);
    fixture.componentRef.setInput('tasks', [task({ completed: true })]);
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('[data-test="calendar-household-task"]');
    expect(item.getAttribute('role')).toBe('listitem');
    expect(item.getAttribute('aria-label')).toContain('calendar.task_assignee Ana');
    expect(item.getAttribute('aria-label')).toContain('calendar.task_completed');
    expect(item.textContent).toContain('calendar.task_zone Cocina');
    expect(item.textContent).toContain('calendar.task_completed');
  });

  it('builds the mini-month and distinguishes today from other dates', () => {
    const component = new CalendarMiniMonthComponent();
    component.anchorDate = new Date(2026, 9, 6, 12);
    component.selectedDate = '2026-10-06';
    const dates = component.dates();

    expect(dates.length).toBeGreaterThanOrEqual(35);
    expect(dates.length % 7).toBe(0);
    expect(component.monthLabel()).toContain('octubre');
    expect(component.toIso(component.anchorDate)).toBe('2026-10-06');
    const today = new Date();
    expect(component.isToday(today)).toBeTrue();
    expect(
      component.isToday(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))
    ).toBeFalse();
  });

  it('builds year grids with leap days, absent cells and month navigation dates', () => {
    const component = new CalendarYearComponent();
    component.year = 2024;
    component.days = Array.from({ length: 29 }, (_, index) =>
      day(`2024-02-${String(index + 1).padStart(2, '0')}`)
    );

    const february = component.monthCells(1);
    expect(component.yearLabel()).toBe('2024');
    expect(component.monthLabel(1)).toContain('febrero');
    expect(component.monthStart(1)).toBe('2024-02-01');
    expect(february.length % 7).toBe(0);
    expect(february.filter((entry) => entry !== null).length).toBe(29);
    expect(february.some((entry) => entry?.iso === '2024-02-29')).toBeTrue();
    component.days = [];
    expect(component.monthCells(0).every((entry) => entry === null)).toBeTrue();
  });

  it('caches month rows, finds visible meals and selects the first available meal slot', () => {
    const component = new CalendarMonthComponent();
    const first = day('2026-10-05', {
      meals: [meal('1'), meal('2'), meal('3'), meal('4')],
      slots: { breakfast: [meal('b', { mealType: 'breakfast' })], lunch: [], snack: [], dinner: [] }
    });
    const days = [
      first,
      day('2026-10-06'),
      day('2026-10-07'),
      day('2026-10-08'),
      day('2026-10-09'),
      day('2026-10-10'),
      day('2026-10-11'),
      day('2026-10-12')
    ];
    component.days = days;
    component.maxVisible = 2;
    const rows = component.rows;

    expect(rows.map((row) => row.length)).toEqual([7, 1]);
    expect(component.rows).toBe(rows);
    expect(component.visible(first).map((entry) => entry.id)).toEqual(['1', '2']);
    expect(component.firstFreeMealType(first)).toBe('lunch');
    expect(component.fmt(1234)).toBeTruthy();
    expect(component.dayLabel(first)).toContain('2026');
    expect(component.trackByIso(0, first)).toBe(first.iso);
    expect(component.trackByRow(3)).toBe(3);

    let added: { date: string; mealType: string } | undefined;
    let opened = '';
    component.addMeal.subscribe((value) => (added = value));
    component.openDay.subscribe((value) => (opened = value));
    component.onCellClick(first);
    expect(added).toEqual({ date: first.iso, mealType: 'lunch' });
    const taskTarget = document.createElement('span');
    taskTarget.setAttribute('data-test', 'calendar-household-task');
    component.onCellClick(first, { target: taskTarget } as unknown as MouseEvent);
    expect(added).toEqual({ date: first.iso, mealType: 'lunch' });
    component.kitchen = false;
    component.onCellClick(first);
    expect(opened).toBe(first.iso);
    expect(
      component.firstFreeMealType(
        day('2026-10-13', {
          slots: {
            breakfast: [meal('b')],
            lunch: [meal('l')],
            snack: [meal('s')],
            dinner: [meal('d')]
          }
        })
      )
    ).toBe('lunch');

    component.days = [day('2026-10-14')];
    expect(component.rows).not.toBe(rows);
  });

  it('formats event labels for missing and fully detailed meal data', () => {
    const component = TestBed.runInInjectionContext(() => new CalendarEventComponent());
    expect(component.kcalLabel()).toContain('0 kcal');
    expect(component.tooltip()).toBe('');
    component.meal = meal('meal-1', {
      calories: 320,
      time: '13:00',
      completed: true
    });

    expect(component.kcalLabel()).toContain('640');
    expect(component.tooltip()).toContain('meal.lunch');
    expect(component.tooltip()).toContain('Lentejas');
    expect(component.tooltip()).toContain('13:00');
    expect(component.tooltip()).toContain('640 kcal');
    expect(component.tooltip()).toContain('calendar.hecha');
  });

  it('formats household event metadata, density and optional tooltip details', () => {
    const component = TestBed.runInInjectionContext(() => new CalendarHouseholdEventsComponent());
    const timed = event({ recurrence: 'weekly', authorName: 'Ana' });
    expect(component.metaOf(timed).icon).toBe('shopping_cart');
    expect(component.metaOf(event({ kind: 'unknown' as never })).icon).toBe('flag');
    expect(component.timeOf(timed)).toContain('10:00');
    component.dense = true;
    expect(component.timeOf(timed)).toBe('');
    const tooltip = component.tip(timed);
    expect(tooltip).toContain('Comprar ingredientes');
    expect(tooltip).toContain('10:00');
    expect(tooltip).toContain('calendar.cada_semana');
    expect(tooltip).toContain('Ana');
    expect(component.tip(event({ recurrence: 'none', authorName: null, allDay: true }))).toContain(
      'Comprar ingredientes'
    );
  });
});
