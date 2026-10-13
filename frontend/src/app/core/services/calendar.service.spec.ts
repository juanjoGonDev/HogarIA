import { HttpRequest } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import type { NutritionalGoals } from '../../shared/models/calendar.model';
import { HouseholdService } from './household.service';
import { I18nService } from './i18n.service';
import { CalendarService } from './calendar.service';

const RANGE_A = { start: '2026-10-01', end: '2026-10-01' };
const RANGE_B = { start: '2026-10-02', end: '2026-10-02' };

const rangeRequest =
  (range: typeof RANGE_A) =>
  (request: HttpRequest<unknown>): boolean =>
    request.url === '/api/calendar/range' &&
    request.params.get('startDate') === range.start &&
    request.params.get('endDate') === range.end;

const eventRequest =
  (range: typeof RANGE_A) =>
  (request: HttpRequest<unknown>): boolean =>
    request.url === '/api/calendar/events' &&
    request.params.get('from') === range.start &&
    request.params.get('to') === range.end;

function rangeResponse(date: string, title: string, calories: number) {
  return {
    data: {
      startDate: date,
      endDate: date,
      goals: { type: 'balanced' as const, dailyCalories: calories, restrictions: [] },
      meals: [
        {
          id: `meal-${date}`,
          date,
          meal_type: 'lunch' as const,
          recipe_id: null,
          recipe_name: null,
          recipe_calories: null,
          custom_meal: title,
          time: '12:00',
          servings: 2,
          notes: null,
          completed: false
        }
      ]
    }
  };
}

function householdEvent(id: string, date: string, title: string) {
  return {
    id,
    date,
    title,
    kind: 'home' as const,
    startTime: null,
    endTime: null,
    allDay: true,
    color: null,
    notes: null,
    location: null,
    source: 'user',
    userId: 'synthetic-user',
    authorName: 'Synthetic User',
    editable: true
  };
}

describe('CalendarService visible range concurrency', () => {
  let service: CalendarService;
  let http: HttpTestingController;
  let contextRevision: ReturnType<typeof signal<number>>;
  let activeHouseholdId: ReturnType<typeof signal<string | null>>;
  let switchingHousehold: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    contextRevision = signal(0);
    activeHouseholdId = signal<string | null>('home-a');
    switchingHousehold = signal(false);
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        CalendarService,
        { provide: I18nService, useValue: { t: () => 'load failed' } },
        {
          provide: HouseholdService,
          useValue: { contextRevision, activeHouseholdId, switchingHousehold }
        }
      ]
    });
    service = TestBed.inject(CalendarService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('clears old household calendar data and ignores pending old-home responses after switching', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    service.loadHouseholdEvents(RANGE_A.start, RANGE_A.end);
    const oldRange = http.expectOne(rangeRequest(RANGE_A));
    const oldEvents = http.expectOne(eventRequest(RANGE_A));

    contextRevision.set(1);
    switchingHousehold.set(true);
    TestBed.flushEffects();

    expect(service.meals()).toEqual([]);
    expect(service.goals()).toBeNull();
    expect(service.householdEvents()).toEqual([]);
    expect(service.isLoading()).toBeFalse();
    expect(service.eventsLoading()).toBeFalse();

    activeHouseholdId.set('home-b');
    switchingHousehold.set(false);
    TestBed.flushEffects();

    const rangeRequests = http.match(rangeRequest(RANGE_A));
    const eventRequests = http.match(eventRequest(RANGE_A));
    expect(rangeRequests.length).toBe(1);
    expect(eventRequests.length).toBe(1);

    oldRange.flush(rangeResponse(RANGE_A.start, 'Old home meal', 1700));
    oldEvents.flush({ data: [householdEvent('event-old', RANGE_A.start, 'Old home event')] });
    expect(service.meals()).toEqual([]);
    expect(service.householdEvents()).toEqual([]);

    rangeRequests[0].flush(rangeResponse(RANGE_A.start, 'New home meal', 2200));
    eventRequests[0].flush({
      data: [householdEvent('event-new', RANGE_A.start, 'New home event')]
    });
    expect(service.meals().map((meal) => meal.title)).toEqual(['New home meal']);
    expect(service.householdEvents().map((event) => event.title)).toEqual(['New home event']);
  });

  it('ignores an older successful meal range while the latest visible range is pending', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    const older = http.expectOne(rangeRequest(RANGE_A));
    service.loadRange(RANGE_B.start, RANGE_B.end);
    const latest = http.expectOne(rangeRequest(RANGE_B));

    older.flush(rangeResponse(RANGE_A.start, 'Older meal', 1700));

    expect(service.isLoading()).toBeTrue();
    expect(service.range()).toBeNull();
    expect(service.meals()).toEqual([]);
    expect(service.goals()).toBeNull();
    latest.flush(rangeResponse(RANGE_B.start, 'Latest meal', 2100));

    expect(service.range()).toEqual(RANGE_B);
    expect(service.meals().map((meal) => meal.title)).toEqual(['Latest meal']);
    expect(service.targetCalories()).toBe(2100);
    expect(service.isLoading()).toBeFalse();
  });

  it('reads a planning week without replacing the currently visible calendar', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Visible meal', 1700));

    let meals: unknown[] | undefined;
    service.getMealsForRange('2026-10-05', '2026-10-11').subscribe((result) => (meals = result));
    const request = http.expectOne((candidate) =>
      rangeRequest({ start: '2026-10-05', end: '2026-10-11' })(candidate)
    );
    expect(request.request.method).toBe('GET');
    request.flush(rangeResponse('2026-10-05', 'Planning-only meal', 1900));

    expect((meals as Array<{ title: string }>).map((meal) => meal.title)).toEqual([
      'Planning-only meal'
    ]);
    expect(service.meals().map((meal) => meal.title)).toEqual(['Visible meal']);
    http.expectNone(rangeRequest(RANGE_A));
  });

  it('ignores an older meal-range failure without changing loading, error, or deduplication', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    const older = http.expectOne(rangeRequest(RANGE_A));
    service.loadRange(RANGE_B.start, RANGE_B.end);
    const latest = http.expectOne(rangeRequest(RANGE_B));

    older.flush({}, { status: 503, statusText: 'Unavailable' });

    expect(service.isLoading()).toBeTrue();
    expect(service.error()).toBeNull();
    service.loadRange(RANGE_B.start, RANGE_B.end);
    http.expectNone(rangeRequest(RANGE_B));
    latest.flush(rangeResponse(RANGE_B.start, 'Latest meal', 2100));

    expect(service.range()).toEqual(RANGE_B);
    expect(service.meals().map((meal) => meal.title)).toEqual(['Latest meal']);
    expect(service.error()).toBeNull();
    expect(service.isLoading()).toBeFalse();
  });

  it('keeps loaded meal data after the current request fails and permits retry', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Saved meal', 1800));

    service.loadRange(RANGE_B.start, RANGE_B.end);
    const failedRange = http.expectOne(rangeRequest(RANGE_B));
    expect(failedRange.request.context.get(SILENT_TOAST)).toBeTrue();
    failedRange.flush({}, { status: 503, statusText: 'Unavailable' });

    expect(service.range()).toEqual(RANGE_A);
    expect(service.meals().map((meal) => meal.title)).toEqual(['Saved meal']);
    expect(service.targetCalories()).toBe(1800);
    expect(service.error()).toBe('load failed');
    expect(service.isLoading()).toBeFalse();

    service.loadRange(RANGE_B.start, RANGE_B.end);
    http
      .expectOne(rangeRequest(RANGE_B))
      .flush(rangeResponse(RANGE_B.start, 'Recovered meal', 2200));

    expect(service.range()).toEqual(RANGE_B);
    expect(service.meals().map((meal) => meal.title)).toEqual(['Recovered meal']);
    expect(service.error()).toBeNull();
    expect(service.isLoading()).toBeFalse();
  });

  it('keeps only the latest forced meal refresh for the same range', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Initial meal', 1800));

    service.loadRange(RANGE_A.start, RANGE_A.end, true);
    const olderRefresh = http.expectOne(rangeRequest(RANGE_A));
    service.loadRange(RANGE_A.start, RANGE_A.end, true);
    const latestRefresh = http.expectOne(rangeRequest(RANGE_A));

    latestRefresh.flush(rangeResponse(RANGE_A.start, 'Latest refresh', 2300));
    olderRefresh.flush(rangeResponse(RANGE_A.start, 'Stale refresh', 1600));

    expect(service.meals().map((meal) => meal.title)).toEqual(['Latest refresh']);
    expect(service.targetCalories()).toBe(2300);
    expect(service.isLoading()).toBeFalse();
  });

  it('ignores an older successful household-event range', () => {
    service.loadHouseholdEvents(RANGE_A.start, RANGE_A.end);
    const older = http.expectOne(eventRequest(RANGE_A));
    service.loadHouseholdEvents(RANGE_B.start, RANGE_B.end);
    const latest = http.expectOne(eventRequest(RANGE_B));

    latest.flush({ data: [householdEvent('event-latest', RANGE_B.start, 'Latest event')] });
    older.flush({ data: [householdEvent('event-old', RANGE_A.start, 'Older event')] });

    expect(service.householdEvents().map((event) => event.title)).toEqual(['Latest event']);
    expect(service.eventsError()).toBeNull();
    expect(service.eventsLoading()).toBeFalse();
  });

  it('ignores an older household-event failure without releasing the latest request', () => {
    service.loadHouseholdEvents(RANGE_A.start, RANGE_A.end);
    const older = http.expectOne(eventRequest(RANGE_A));
    service.loadHouseholdEvents(RANGE_B.start, RANGE_B.end);
    const latest = http.expectOne(eventRequest(RANGE_B));

    older.flush({}, { status: 503, statusText: 'Unavailable' });

    expect(service.eventsLoading()).toBeTrue();
    expect(service.eventsError()).toBeNull();
    service.loadHouseholdEvents(RANGE_B.start, RANGE_B.end);
    http.expectNone(eventRequest(RANGE_B));
    latest.flush({ data: [householdEvent('event-latest', RANGE_B.start, 'Latest event')] });

    expect(service.householdEvents().map((event) => event.title)).toEqual(['Latest event']);
    expect(service.eventsError()).toBeNull();
    expect(service.eventsLoading()).toBeFalse();
  });

  it('reports a current household-event failure and allows retrying the same window', () => {
    service.loadHouseholdEvents(RANGE_A.start, RANGE_A.end);
    http.expectOne(eventRequest(RANGE_A)).flush({}, { status: 503, statusText: 'Unavailable' });

    expect(service.eventsError()).toBe('load failed');
    expect(service.eventsLoading()).toBeFalse();

    service.loadHouseholdEvents(RANGE_A.start, RANGE_A.end);
    http.expectOne(eventRequest(RANGE_A)).flush({
      data: [householdEvent('event-recovered', RANGE_A.start, 'Recovered event')]
    });

    expect(service.householdEvents().map((event) => event.title)).toEqual(['Recovered event']);
    expect(service.eventsError()).toBeNull();
    expect(service.eventsLoading()).toBeFalse();
  });

  it('keeps only the latest forced household-event refresh for the same range', () => {
    service.loadHouseholdEvents(RANGE_A.start, RANGE_A.end);
    http
      .expectOne(eventRequest(RANGE_A))
      .flush({ data: [householdEvent('event-initial', RANGE_A.start, 'Initial event')] });

    service.loadHouseholdEvents(RANGE_A.start, RANGE_A.end, true);
    const olderRefresh = http.expectOne(eventRequest(RANGE_A));
    service.loadHouseholdEvents(RANGE_A.start, RANGE_A.end, true);
    const latestRefresh = http.expectOne(eventRequest(RANGE_A));

    latestRefresh.flush({ data: [householdEvent('event-latest', RANGE_A.start, 'Latest event')] });
    olderRefresh.flush({ data: [householdEvent('event-old', RANGE_A.start, 'Stale event')] });

    expect(service.householdEvents().map((event) => event.title)).toEqual(['Latest event']);
    expect(service.eventsLoading()).toBeFalse();
  });

  it('does not treat a failed household-event mutation as a success', async () => {
    const existing = householdEvent('event-existing', RANGE_A.start, 'Evento conservado');
    service.householdEvents.set([existing]);
    service.loadRange(RANGE_A.start, RANGE_A.end);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Comida', 1800));

    const removal = service.removeHouseholdEvent(existing.id);
    http
      .expectOne(`/api/calendar/events/${existing.id}`)
      .flush({}, { status: 503, statusText: 'Unavailable' });
    expect(await removal).toBeFalse();
    expect(service.householdEvents()).toEqual([existing]);
    http.expectNone(eventRequest(RANGE_A));

    const skipping = service.skipHouseholdOccurrence(existing.id, RANGE_A.start);
    http
      .expectOne(`/api/calendar/events/${existing.id}/occurrences/${RANGE_A.start}`)
      .flush({}, { status: 503, statusText: 'Unavailable' });
    expect(await skipping).toBeFalse();
    http.expectNone(eventRequest(RANGE_A));

    const leaving = service.leaveHouseholdEvent(existing.id);
    http
      .expectOne(`/api/calendar/events/${existing.id}/attendees/me`)
      .flush({}, { status: 503, statusText: 'Unavailable' });
    expect(await leaving).toBeFalse();
    expect(service.householdEvents()).toEqual([existing]);
    http.expectNone(eventRequest(RANGE_A));
  });

  it('maps complete and fallback meal fields from a visible range', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    http.expectOne(rangeRequest(RANGE_A)).flush({
      data: {
        startDate: RANGE_A.start,
        endDate: RANGE_A.end,
        goals: null,
        meals: [
          {
            id: 'recipe-meal',
            date: RANGE_A.start,
            meal_type: 'lunch',
            recipe_id: 'recipe-1',
            recipe_name: '  Arroz con verduras  ',
            recipe_calories: 430,
            custom_meal: 'Ignored title',
            time: '13:30',
            servings: null,
            notes: '  Nota  ',
            completed: 1
          },
          {
            id: 'blank-meal',
            date: RANGE_A.start,
            meal_type: 'dinner',
            recipe_id: null,
            recipe_name: '  ',
            recipe_calories: null,
            custom_meal: '  ',
            time: null,
            servings: null,
            notes: null,
            completed: false
          },
          {
            id: 'shared-meal',
            date: RANGE_A.start,
            meal_type: 'dinner',
            recipe_id: 'recipe-shared',
            recipe_name: '  Guiso compartido  ',
            recipe_calories: 500,
            custom_meal: null,
            time: '20:00',
            servings: 4,
            notes: null,
            completed: false,
            isShared: true,
            participantIds: ['user-1', 'user-2']
          }
        ]
      }
    });

    expect(service.meals()).toEqual([
      jasmine.objectContaining({
        id: 'recipe-meal',
        title: 'Arroz con verduras',
        recipeId: 'recipe-1',
        calories: 430,
        servings: 1,
        notes: '  Nota  ',
        completed: true
      }),
      jasmine.objectContaining({
        id: 'blank-meal',
        title: 'Comida',
        recipeId: null,
        calories: null,
        servings: 1,
        completed: false
      }),
      jasmine.objectContaining({
        id: 'shared-meal',
        title: 'Guiso compartido',
        isShared: true,
        participantIds: ['user-1', 'user-2']
      })
    ]);
    expect(service.mealsByDate().get(RANGE_A.start)?.length).toBe(3);
  });

  it('reads an auxiliary meal range silently without replacing the visible data', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Visible', 1800));

    let result: unknown;
    service.getMealsForRange('2026-10-05', '2026-10-11').subscribe((meals) => (result = meals));
    const request = http.expectOne((candidate) =>
      rangeRequest({ start: '2026-10-05', end: '2026-10-11' })(candidate)
    );
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush(rangeResponse('2026-10-05', 'Auxiliary', 1900));

    expect((result as Array<{ title: string }>).map((meal) => meal.title)).toEqual(['Auxiliary']);
    expect(service.meals().map((meal) => meal.title)).toEqual(['Visible']);
  });

  it('adds and updates a meal, refreshing only after each successful write', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Existing', 1800));

    const addResults: unknown[] = [];
    service
      .addMeal({
        date: RANGE_A.start,
        mealType: 'dinner',
        customMeal: 'Arroz al horno',
        servings: 2
      })
      .subscribe((result) => addResults.push(result));
    const create = http.expectOne('/api/calendar/meals');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({
      date: RANGE_A.start,
      mealType: 'dinner',
      customMeal: 'Arroz al horno',
      servings: 2
    });
    create.flush({ success: true });
    expect(addResults).toEqual([{ success: true }]);
    http
      .expectOne(rangeRequest(RANGE_A))
      .flush(rangeResponse(RANGE_A.start, 'Arroz al horno', 1800));

    const updateResults: unknown[] = [];
    service
      .updateMeal('meal-existing', { servings: 4 })
      .subscribe((result) => updateResults.push(result));
    const update = http.expectOne('/api/calendar/meals/meal-existing');
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({ servings: 4 });
    update.flush({ success: true });
    expect(updateResults).toEqual([{ success: true }]);
    http
      .expectOne(rangeRequest(RANGE_A))
      .flush(rangeResponse(RANGE_A.start, 'Arroz al horno', 1800));
  });

  it('returns null after a rejected meal create or update and does not refresh', () => {
    const addResults: unknown[] = [];
    service
      .addMeal({ date: RANGE_A.start, mealType: 'lunch', customMeal: 'No guardado' })
      .subscribe((result) => addResults.push(result));
    http.expectOne('/api/calendar/meals').flush({}, { status: 503, statusText: 'Unavailable' });
    expect(addResults).toEqual([null]);

    const updateResults: unknown[] = [];
    service
      .updateMeal('meal-missing', { servings: 3 })
      .subscribe((result) => updateResults.push(result));
    http
      .expectOne('/api/calendar/meals/meal-missing')
      .flush({}, { status: 404, statusText: 'Not Found' });
    expect(updateResults).toEqual([null]);
    http.expectNone(rangeRequest(RANGE_A));
  });

  it('rolls back a rejected completion patch, permits retry and repeated toggles without duplicating meals', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Cena', 1800));
    const meal = service.meals()[0];

    service.toggleComplete(meal);
    expect(service.meals()[0].completed).toBeTrue();
    const firstPatch = http.expectOne(`/api/calendar/meals/${meal.id}`);
    expect(firstPatch.request.body).toEqual({ completed: true });
    firstPatch.flush({ success: true });

    service.toggleComplete(service.meals()[0]);
    expect(service.meals()[0].completed).toBeFalse();
    const rejectedPatch = http.expectOne(`/api/calendar/meals/${meal.id}`);
    expect(rejectedPatch.request.body).toEqual({ completed: false });
    rejectedPatch.flush({}, { status: 503, statusText: 'Unavailable' });
    expect(service.meals()[0].completed).toBeTrue();

    service.toggleComplete(service.meals()[0]);
    expect(service.meals()[0].completed).toBeFalse();
    const retriedPatch = http.expectOne(`/api/calendar/meals/${meal.id}`);
    expect(retriedPatch.request.body).toEqual({ completed: false });
    retriedPatch.flush({ success: true });

    service.toggleComplete(service.meals()[0]);
    expect(service.meals()[0].completed).toBeTrue();
    const repeatedPatch = http.expectOne(`/api/calendar/meals/${meal.id}`);
    expect(repeatedPatch.request.body).toEqual({ completed: true });
    repeatedPatch.flush({ success: true });
    expect(service.meals()).toHaveSize(1);
    expect(service.meals()[0].id).toBe(meal.id);
  });

  it('generates an AI plan and preserves the legacy dashboard calendar APIs', () => {
    const plan = {
      startDate: RANGE_A.start,
      endDate: RANGE_A.end,
      goals: { types: ['balanced'], customInstructions: '' }
    };
    let generated: unknown;
    service.generateWithAi(plan).subscribe((result) => (generated = result));
    const generate = http.expectOne('/api/ai/plan-week');
    expect(generate.request.method).toBe('POST');
    expect(generate.request.body).toEqual(plan);
    generate.flush({ data: { days: [{ date: RANGE_A.start }] } });
    expect(generated).toEqual({ days: [{ date: RANGE_A.start }] });

    let legacyLoaded: unknown;
    service.loadCalendar();
    http.expectOne('/api/calendar').flush({ data: { id: 'legacy-calendar' } });
    legacyLoaded = service.calendar();
    expect(legacyLoaded).toEqual({ id: 'legacy-calendar' });

    let created: unknown;
    service
      .createCalendar(RANGE_A.start, { restrictions: [] })
      .subscribe((result) => (created = result));
    const create = http.expectOne('/api/calendar');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ weekStart: RANGE_A.start, goals: { restrictions: [] } });
    create.flush({ data: { id: 'created-calendar' } });
    expect(created).toEqual({ id: 'created-calendar' });
    expect(service.calendar()?.id).toBe('created-calendar');
  });

  it('filters and orders visible household events and toggles kind filters', () => {
    const allDay = householdEvent('event-all-day', RANGE_A.start, 'Todo el día');
    const late = {
      ...householdEvent('event-late', RANGE_A.start, 'Tarde'),
      kind: 'appointment' as const,
      allDay: false,
      startTime: '18:00'
    };
    const early = {
      ...householdEvent('event-early', RANGE_A.start, 'Mañana'),
      kind: 'appointment' as const,
      allDay: false,
      startTime: '09:00'
    };
    const otherDay = householdEvent('event-other-day', RANGE_B.start, 'Otro día');
    const shopping = {
      ...householdEvent('event-shopping', RANGE_A.start, 'Compra'),
      kind: 'shopping' as const,
      allDay: false,
      startTime: '20:00'
    };
    service.householdEvents.set([late, otherDay, shopping, early, allDay]);

    expect(service.visibleEventsOn(RANGE_A.start).map((event) => event.id)).toEqual([
      allDay.id,
      early.id,
      late.id,
      shopping.id
    ]);
    service.toggleKind('home');
    expect(service.visibleEventsOn(RANGE_A.start).map((event) => event.id)).toEqual([
      early.id,
      late.id,
      shopping.id
    ]);
    service.toggleKind('home');
    expect(service.visibleEventsOn(RANGE_A.start).map((event) => event.id)).toContain(allDay.id);
  });

  it('creates, updates, and reports household event saves', async () => {
    const createdEvent = householdEvent('event-created', RANGE_A.start, 'Evento nuevo');
    const create = service.saveHouseholdEvent({ title: createdEvent.title });
    expect(service.creatingEvent()).toBeTrue();
    const createRequest = http.expectOne('/api/calendar/events');
    expect(createRequest.request.method).toBe('POST');
    createRequest.flush({ data: createdEvent });
    expect(await create).toEqual(createdEvent);
    expect(service.householdEvents()).toEqual([createdEvent]);
    expect(service.creatingEvent()).toBeFalse();

    const updatedEvent = { ...createdEvent, title: 'Evento editado' };
    const update = service.saveHouseholdEvent({ title: updatedEvent.title }, createdEvent.id);
    const updateRequest = http.expectOne(`/api/calendar/events/${createdEvent.id}`);
    expect(updateRequest.request.method).toBe('PATCH');
    updateRequest.flush({ data: updatedEvent });
    expect(await update).toEqual(updatedEvent);
    expect(service.householdEvents()).toEqual([updatedEvent]);

    const denied = service.saveHouseholdEvent({ title: 'Sin permiso' });
    http.expectOne('/api/calendar/events').flush({}, { status: 403, statusText: 'Forbidden' });
    expect(await denied).toBeNull();
    expect(service.eventsError()).toBe('load failed');
    expect(service.creatingEvent()).toBeFalse();

    const invalid = service.saveHouseholdEvent({ title: 'Fecha inválida' });
    http.expectOne('/api/calendar/events').flush({}, { status: 400, statusText: 'Bad Request' });
    expect(await invalid).toBeNull();
    expect(service.eventsError()).toBe('load failed');
  });

  it('refreshes household events only after successful occurrence or attendee mutations', async () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Cena', 1800));
    const existing = householdEvent('event-existing', RANGE_A.start, 'Evento');
    service.householdEvents.set([existing]);

    const removal = service.removeHouseholdEvent(existing.id);
    http.expectOne(`/api/calendar/events/${existing.id}`).flush({ success: true });
    expect(await removal).toBeTrue();
    expect(service.householdEvents()).toEqual([]);

    const skipping = service.skipHouseholdOccurrence(existing.id, RANGE_A.start);
    http
      .expectOne(`/api/calendar/events/${existing.id}/occurrences/${RANGE_A.start}`)
      .flush({ success: true });
    expect(await skipping).toBeTrue();
    http.expectOne(eventRequest(RANGE_A)).flush({ data: [existing] });

    const leaving = service.leaveHouseholdEvent(existing.id);
    http.expectOne(`/api/calendar/events/${existing.id}/attendees/me`).flush({ success: true });
    expect(await leaving).toBeTrue();
    http.expectOne(eventRequest(RANGE_A)).flush({ data: [] });
    expect(service.householdEvents()).toEqual([]);
    expect(service.eventsError()).toBeNull();
  });

  it('returns false and restores the meal after a failed delete without a duplicate global toast', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Saved meal', 1800));

    const results: boolean[] = [];
    service.deleteMeal(`meal-${RANGE_A.start}`).subscribe((result) => results.push(result));

    const deletion = http.expectOne((request) =>
      request.url.endsWith(`/calendar/meals/meal-${RANGE_A.start}`)
    );
    expect(deletion.request.method).toBe('DELETE');
    expect(deletion.request.context.get(SILENT_TOAST)).toBeTrue();
    deletion.flush({}, { status: 503, statusText: 'Unavailable' });

    expect(results).toEqual([false]);
    expect(service.meals()).toEqual([]);

    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Saved meal', 1800));
    expect(service.meals().map((meal) => meal.title)).toEqual(['Saved meal']);
  });

  it('returns true and refreshes the range after a successful delete', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    const existingRange = rangeResponse(RANGE_A.start, 'Saved meal', 1800);
    http.expectOne(rangeRequest(RANGE_A)).flush(existingRange);

    const results: boolean[] = [];
    service.deleteMeal(`meal-${RANGE_A.start}`).subscribe((result) => results.push(result));

    const deletion = http.expectOne((request) =>
      request.url.endsWith(`/calendar/meals/meal-${RANGE_A.start}`)
    );
    expect(deletion.request.method).toBe('DELETE');
    expect(deletion.request.context.get(SILENT_TOAST)).toBeTrue();
    deletion.flush({ success: true });

    expect(results).toEqual([true]);
    const refreshedRange = { ...existingRange, data: { ...existingRange.data, meals: [] } };
    http.expectOne(rangeRequest(RANGE_A)).flush(refreshedRange);
    expect(service.meals()).toEqual([]);
  });

  it('applies a batch replacement once and refreshes only after server confirmation', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Saved meal', 1800));

    const results: boolean[] = [];
    service
      .replaceSelectedMeals([
        { id: 'meal-first', customMeal: 'Avena' },
        { id: 'meal-second', customMeal: 'Pescado' }
      ])
      .subscribe((applied) => results.push(applied));

    const patch = http.expectOne('/api/calendar/meals/bulk/replace-selected');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({
      replacements: [
        { id: 'meal-first', customMeal: 'Avena' },
        { id: 'meal-second', customMeal: 'Pescado' }
      ]
    });
    expect(results).toEqual([]);
    http.expectNone(rangeRequest(RANGE_A));

    patch.flush({ success: true, data: [] });

    expect(results).toEqual([true]);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Avena', 1800));
    expect(service.meals().map((meal) => meal.title)).toEqual(['Avena']);
  });

  it('keeps the prior calendar and reports failure when batch replacement is rejected', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Saved meal', 1800));

    const results: boolean[] = [];
    service
      .replaceSelectedMeals([{ id: 'meal-first', customMeal: 'Avena' }])
      .subscribe((applied) => results.push(applied));
    http
      .expectOne('/api/calendar/meals/bulk/replace-selected')
      .flush({ code: 'MEAL_NOT_FOUND' }, { status: 404, statusText: 'Not Found' });

    expect(results).toEqual([false]);
    expect(service.meals().map((meal) => meal.title)).toEqual(['Saved meal']);
    http.expectNone(rangeRequest(RANGE_A));
  });

  it('keeps goal updates pending until PATCH succeeds and then refreshes the visible week', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Lunch', 1800));

    const goals: NutritionalGoals = {
      types: ['weight-loss', 'custom'],
      customInstructions: 'Más verdura',
      dailyCalories: 1750,
      restrictions: []
    };
    const results: unknown[] = [];
    service.updateGoals(goals, '2026-10-05').subscribe((result) => results.push(result));

    const patch = http.expectOne('/api/calendar/goals');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ ...goals, weekStart: '2026-10-05' });
    expect(patch.request.context.get(SILENT_TOAST)).toBeTrue();
    expect(results).toEqual([]);
    http.expectNone(rangeRequest(RANGE_A));

    patch.flush({ success: true });

    expect(results).toEqual([{ success: true }]);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Lunch', 1750));
    expect(service.targetCalories()).toBe(1750);
  });

  it('propagates a failed goal PATCH without refreshing as if it had saved', () => {
    service.loadRange(RANGE_A.start, RANGE_A.end);
    http.expectOne(rangeRequest(RANGE_A)).flush(rangeResponse(RANGE_A.start, 'Lunch', 1800));

    let failure: unknown;
    service.updateGoals({ restrictions: [] }, '2026-10-05').subscribe({
      error: (error) => (failure = error)
    });
    const patch = http.expectOne('/api/calendar/goals');
    patch.flush({ message: 'Unavailable' }, { status: 503, statusText: 'Unavailable' });

    expect(failure).toBeTruthy();
    http.expectNone(rangeRequest(RANGE_A));
    expect(service.targetCalories()).toBe(1800);
  });
});
