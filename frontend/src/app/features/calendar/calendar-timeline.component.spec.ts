import { SimpleChange } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  CalendarDayView,
  CalendarMeal,
  HouseholdEvent
} from '../../shared/models/calendar.model';
import { dateLocale, setDateLocale } from '../../core/time';
import { I18nService } from '../../core/services/i18n.service';
import { CalendarTimelineComponent } from './calendar-timeline.component';

let previousLocale: string;

function day(iso: string, isToday = false): CalendarDayView {
  return {
    date: new Date(`${iso}T12:00:00`),
    iso,
    inCurrentMonth: true,
    isToday,
    meals: [],
    calories: 0,
    hasNutrition: false,
    slots: { breakfast: [], lunch: [], snack: [], dinner: [] },
    planned: 0,
    done: 0,
    events: [],
    tasks: []
  };
}

describe('CalendarTimelineComponent grid geometry', () => {
  beforeEach(async () => {
    previousLocale = dateLocale();
    setDateLocale('es-ES');
    await TestBed.configureTestingModule({
      imports: [CalendarTimelineComponent],
      providers: [{ provide: I18nService, useValue: { t: (key: string) => key } }]
    })
      .overrideComponent(CalendarTimelineComponent, { set: { template: '' } })
      .compileComponents();
  });

  afterEach(() => setDateLocale(previousLocale));

  it('keeps a non-zero day column when no days have loaded yet', () => {
    const component = TestBed.createComponent(CalendarTimelineComponent).componentInstance;
    const geometry = component as unknown as {
      columns: () => string;
      gridMinWidth: () => string;
    };

    expect(geometry.columns()).toBe('60px repeat(1, minmax(48px, 1fr))');
    expect(geometry.gridMinWidth()).toBe('108px');
  });

  it('allocates the same 48px minimum track for every day in a week', () => {
    const component = TestBed.createComponent(CalendarTimelineComponent).componentInstance;
    const geometry = component as unknown as {
      columns: () => string;
      gridMinWidth: () => string;
    };
    component.days = Array.from({ length: 7 }, () => ({})) as CalendarTimelineComponent['days'];

    expect(geometry.columns()).toBe('60px repeat(7, minmax(48px, 1fr))');
    expect(geometry.gridMinWidth()).toBe('396px');
  });

  it('resets the initial position only when the visible date range changes', () => {
    const component = TestBed.createComponent(CalendarTimelineComponent).componentInstance;
    const scroller = { scrollTop: 640 } as HTMLDivElement;
    (component as unknown as { scroller: { nativeElement: HTMLDivElement } }).scroller = {
      nativeElement: scroller
    };

    const firstRange = [day('2026-10-11')];
    component.days = firstRange;
    component.ngOnChanges({ days: new SimpleChange([], firstRange, true) });
    component.ngAfterViewInit();
    expect(scroller.scrollTop).toBe(0);

    scroller.scrollTop = 640;
    const refreshedDays = [day('2026-10-11')];
    component.days = refreshedDays;
    component.ngOnChanges({ days: new SimpleChange(firstRange, refreshedDays, false) });
    expect(scroller.scrollTop).toBe(640);

    component.ngOnChanges({ kitchen: new SimpleChange(true, false, false) });
    expect(scroller.scrollTop).toBe(640);
    component.ngOnChanges({});
    expect(scroller.scrollTop).toBe(640);

    const nextRange = [day('2026-10-18')];
    component.days = nextRange;
    component.ngOnChanges({ days: new SimpleChange(refreshedDays, nextRange, false) });
    expect(scroller.scrollTop).toBe(0);
  });

  it('rebuilds meals at their written time or household anchor and separates all-day events', () => {
    const component = TestBed.createComponent(CalendarTimelineComponent).componentInstance;
    const currentDay = day('2026-10-05');
    currentDay.meals = [meal('breakfast', 'breakfast', null), meal('supper', 'dinner', '23:30')];
    currentDay.events = [
      event('appointment', '08:15', '09:00'),
      event('holiday', null, null, true)
    ];
    component.days = [currentDay];
    component.mealAnchors = { breakfast: 450, lunch: 800, snack: 1000, dinner: 1250 };
    component.ngOnChanges({ days: new SimpleChange([], [currentDay], true) });

    const api = access(component);
    const items = api.gridItems().get(currentDay.iso)!;
    expect(items.length).toBe(4);
    expect(items.find((item) => item.id === 'meal-breakfast')?.startMinutes).toBe(450);
    expect(items.find((item) => item.id === 'meal-breakfast')?.timed).toBeFalse();
    expect(items.find((item) => item.id === 'meal-supper')?.startMinutes).toBe(1410);
    expect(items.find((item) => item.id === 'meal-supper')?.timed).toBeTrue();
    expect(items.find((item) => item.id === 'event-appointment')?.endMinutes).toBe(540);
    expect(api.bandOf(currentDay).map((item) => item.id)).toEqual(['event-holiday']);
    expect(api.blocksOf(currentDay).map((block) => block.item.id)).toContain('meal-breakfast');

    component.kitchen = false;
    component.ngOnChanges({ kitchen: new SimpleChange(true, false, false) });
    expect(
      api
        .gridItems()
        .get(currentDay.iso)
        ?.map((item) => item.id)
    ).toEqual(['event-appointment', 'event-holiday']);
  });

  it('formats kcal, labels, colors, titles, time text, tips and attendee faces', () => {
    const component = TestBed.createComponent(CalendarTimelineComponent).componentInstance;
    const today = day('2026-10-05', true);
    today.calories = 1500;
    today.planned = 2;
    today.done = 1;
    component.days = [today];
    component.targetCalories = 2000;
    const api = access(component);
    const ownMeal = meal('own', 'lunch', '13:30');
    const externalEvent = event('shared', '13:00', '13:45');
    externalEvent.editable = false;
    externalEvent.userId = 'author-1';
    externalEvent.authorName = null;
    externalEvent.attendees = [{ id: 'guest-1', name: 'Invitada', avatar: null }];
    const mealItem = {
      id: 'meal-own',
      date: today.iso,
      startMinutes: 810,
      endMinutes: 900,
      timed: true,
      allDay: false,
      kind: 'meal',
      meal: ownMeal,
      mealType: 'lunch'
    } as never;
    const eventItem = {
      id: 'event-shared',
      date: today.iso,
      startMinutes: 780,
      endMinutes: 825,
      timed: true,
      allDay: true,
      kind: 'event',
      event: externalEvent
    } as never;
    const emptyItem = {
      id: 'empty',
      date: today.iso,
      startMinutes: 0,
      endMinutes: 0,
      timed: false,
      allDay: false,
      kind: 'meal'
    } as never;

    expect(api.kcalTip(today)).toContain('1500 kcal');
    expect(api.kcalTip(today)).toContain('objetivo 2000');
    expect(api.kcalTip(today)).toContain('1 de 2 hechas');
    expect(api.kcalOf(today)).toContain('/ 2000 kcal');
    expect(api.dayNumber(today)).toBe('5');
    expect(api.dayLabel(today).length).toBeGreaterThan(0);
    expect(api.colorOf(mealItem)).toBeTruthy();
    expect(api.colorOf(eventItem)).toBe(externalEvent.color ?? '#8A8F98');
    expect(api.titleOf(mealItem)).toBe('Plato lunch');
    expect(api.titleOf(eventItem)).toBe('Evento shared');
    expect(api.titleOf(emptyItem)).toBe('');
    expect(api.whenOf(mealItem)).toBe('13:30');
    expect(api.whenOf(eventItem)).toBe('13:00–13:45');
    expect(api.whenOf(emptyItem)).toBe('');
    expect(api.tipOf(eventItem)).toContain('calendar.todo_el_dia');
    expect(api.tipOf(eventItem)).toContain('calendar.con_personas');
    expect(api.tipOf(mealItem)).toContain('meal.lunch');
    expect(
      api.facesOf({
        id: 'no-event',
        kind: 'event',
        allDay: false,
        startMinutes: 0,
        endMinutes: 0
      } as never)
    ).toEqual([]);
    expect(api.facesOf(eventItem).map((face) => face.id)).toEqual(['author-1', 'guest-1']);
    externalEvent.editable = true;
    expect(api.facesOf(eventItem).map((face) => face.id)).toEqual(['guest-1']);

    component.days = [today, day('2026-10-06')];
    expect(api.kcalOf(today)).toBe('1500 kcal');
    component.targetCalories = 0;
    expect(api.kcalTip(today)).not.toContain('objetivo');
  });

  it('emits the correct actions for meal blocks, event blocks, grid clicks and all-day bands', () => {
    const component = TestBed.createComponent(CalendarTimelineComponent).componentInstance;
    const future = day('2026-10-05');
    const plannedMeal = meal('meal-1', 'lunch', null);
    const plannedEvent = event('event-1', '09:00', '10:00');
    const openedMeals: CalendarMeal[] = [];
    const openedEvents: HouseholdEvent[] = [];
    const createdMeals: unknown[] = [];
    const createdEvents: unknown[] = [];
    component.openMeal.subscribe((value) => openedMeals.push(value));
    component.editEvent.subscribe((value) => openedEvents.push(value));
    component.addMeal.subscribe((value) => createdMeals.push(value));
    component.addEvent.subscribe((value) => createdEvents.push(value));

    const api = access(component);
    api.onOpen({ kind: 'meal', meal: plannedMeal } as never);
    api.onOpen({ kind: 'event', event: plannedEvent } as never);
    api.onOpen({ kind: 'meal' } as never);
    expect(openedMeals).toEqual([plannedMeal]);
    expect(openedEvents).toEqual([plannedEvent]);

    component.mealAnchors = { breakfast: 500, lunch: 800, snack: 1000, dinner: 1200 };
    api.onAddMeal(future);
    expect(createdMeals[0]).toEqual({ date: future.iso, mealType: 'lunch', time: undefined });
    api.onBandClick(future);
    expect(createdEvents[0]).toEqual({ date: future.iso, startTime: '' });
    const taskTarget = document.createElement('span');
    taskTarget.setAttribute('data-test', 'calendar-household-task');
    api.onBandClick(future, { target: taskTarget } as unknown as MouseEvent);
    expect(createdEvents.length).toBe(1);

    api.window.set({ startMinutes: 0, endMinutes: 1440 });
    const column = {
      dataset: { date: future.iso },
      getBoundingClientRect: () => ({ top: 10 })
    };
    api.onGridClick({
      target: { closest: (selector: string) => (selector === '.tl__col' ? column : null) },
      clientY: 40
    } as never);
    expect(createdEvents[1]).toEqual({ date: future.iso, startTime: '00:30' });
    api.onGridClick({ target: { closest: () => null }, clientY: 40 } as never);
    api.onGridClick({
      target: { closest: () => ({ dataset: {}, getBoundingClientRect: () => ({ top: 0 }) }) },
      clientY: 40
    } as never);
    expect(createdEvents.length).toBe(2);
  });

  it('keeps the now indicator inside the visible window and positions correctly for today', () => {
    const component = TestBed.createComponent(CalendarTimelineComponent).componentInstance;
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const today = day(iso, true);
    component.days = [today];
    const api = access(component);
    api.window.set({ startMinutes: 0, endMinutes: 1440 });
    expect(api.nowTop()).not.toBeNull();
    api.window.set({ startMinutes: 1440, endMinutes: 1440 });
    expect(api.nowTop()).toBeNull();
    component.days = [day('2026-10-05')];
    expect(api.nowTop()).toBeNull();
    expect(component.heightPx()).toBe(0);
    expect(component.hourLabels()).toEqual([]);
  });
});

function access(component: CalendarTimelineComponent) {
  return component as unknown as {
    gridItems: () => Map<string, TimelineItemFixture[]>;
    window: WritableSignal<{ startMinutes: number; endMinutes: number }>;
    blocksOf(day: CalendarDayView): { item: TimelineItemFixture }[];
    bandOf(day: CalendarDayView): TimelineItemFixture[];
    nowTop(): number | null;
    dayLabel(day: CalendarDayView): string;
    dayNumber(day: CalendarDayView): string;
    facesOf(item: TimelineItemFixture): { id: string; name: string; who: string }[];
    kcalTip(day: CalendarDayView): string;
    kcalOf(day: CalendarDayView): string;
    colorOf(item: TimelineItemFixture): string;
    titleOf(item: TimelineItemFixture): string;
    whenOf(item: TimelineItemFixture): string;
    tipOf(item: TimelineItemFixture): string;
    onOpen(item: TimelineItemFixture): void;
    onAddMeal(day: CalendarDayView): void;
    onGridClick(event: MouseEvent): void;
    onBandClick(day: CalendarDayView, event?: MouseEvent): void;
  };
}

interface TimelineItemFixture {
  id: string;
  kind: 'meal' | 'event';
  startMinutes: number;
  endMinutes: number;
  allDay: boolean;
  timed?: boolean;
  meal?: CalendarMeal;
  mealType?: CalendarMeal['mealType'];
  event?: HouseholdEvent;
}

function meal(id: string, mealType: CalendarMeal['mealType'], time: string | null): CalendarMeal {
  return {
    id,
    date: '2026-10-05',
    mealType,
    title: `Plato ${mealType}`,
    time,
    servings: 2,
    completed: false
  };
}

function event(
  id: string,
  startTime: string | null,
  endTime: string | null,
  allDay = false
): HouseholdEvent {
  return {
    id,
    title: `Evento ${id}`,
    kind: 'other',
    date: '2026-10-05',
    startTime,
    endTime,
    allDay,
    color: null,
    notes: null,
    location: null,
    source: 'household',
    userId: 'user-1',
    authorName: 'Autor',
    editable: true
  };
}
