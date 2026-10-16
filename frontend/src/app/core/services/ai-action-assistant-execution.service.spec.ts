import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HouseholdService } from './household.service';
import type { AssistantAction } from '../../shared/models/ai-action-assistant.model';
import type { HouseholdMealProposal } from './household-meal-proposal.service';
import { AiActionAssistantExecutionService } from './ai-action-assistant-execution.service';

describe('AiActionAssistantExecutionService', () => {
  let service: AiActionAssistantExecutionService;
  let http: HttpTestingController;
  let householdContext: {
    activeHouseholdId: ReturnType<typeof signal<string | null>>;
    household: ReturnType<typeof signal<null>>;
  };

  beforeEach(() => {
    householdContext = {
      activeHouseholdId: signal<string | null>(null),
      household: signal<null>(null)
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: HouseholdService, useValue: householdContext }
      ]
    });
    service = TestBed.inject(AiActionAssistantExecutionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('persists pantry ingredients only through the validated domain API after execution is requested', async () => {
    const action = pantryAction();
    const execution = service.execute(action, null);
    const request = http.expectOne('/api/pantry/ingredients');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      name: 'Lentejas',
      category: 'legumes',
      quantity: 500,
      unit: 'g',
      expirationDate: null,
      location: 'pantry',
      notes: null
    });
    expect(request.request.headers.get('x-assistant-action-id')).toBe(action.id);
    request.flush(
      { success: true, data: { id: 'ingredient-1' } },
      { status: 201, statusText: 'Created' }
    );
    await expectAsync(execution).toBeResolvedTo(undefined);
    await expectAsync(service.execute(action, null)).toBeRejectedWithError(
      'ASSISTANT_ACTION_ALREADY_SUCCEEDED'
    );
    http.expectNone('/api/pantry/ingredients');
  });

  it('allows an exact retry after an uncertain failure and rejects changed payloads', async () => {
    const action = pantryAction();
    const firstAttempt = service.execute(action, null);
    const firstRequest = http.expectOne('/api/pantry/ingredients');
    firstRequest.flush(
      { success: false, code: 'WRITE_RESULT_UNKNOWN' },
      { status: 500, statusText: 'Server Error' }
    );
    await expectAsync(firstAttempt).toBeRejected();

    const changed = {
      ...action,
      payload: { ...action.payload, quantity: 700 }
    } as AssistantAction;
    await expectAsync(service.execute(changed, null)).toBeRejectedWithError(
      'ASSISTANT_ACTION_PAYLOAD_CHANGED_AFTER_ATTEMPT'
    );
    http.expectNone('/api/pantry/ingredients');

    const retry = service.execute(action, null);
    const retryRequest = http.expectOne('/api/pantry/ingredients');
    expect(retryRequest.request.headers.get('x-assistant-action-id')).toBe(action.id);
    retryRequest.flush({ success: true, idempotent: true });
    await expectAsync(retry).toBeResolvedTo(undefined);
  });

  it('creates only a private calendar event and never sends attendee IDs', async () => {
    const action = {
      ...actionBase('calendar.create_event', 'calendar', 'create_event'),
      payload: {
        title: 'Cita',
        kind: 'appointment',
        date: '2026-10-20',
        startTime: '09:00',
        endTime: '09:30',
        allDay: false,
        sharedWithHousehold: false,
        location: null,
        notes: null
      }
    } as AssistantAction;
    const execution = service.execute(action, null);
    const request = http.expectOne('/api/calendar/events');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(
      jasmine.objectContaining({
        title: 'Cita',
        kind: 'appointment',
        date: '2026-10-20',
        sharedWithHousehold: false
      })
    );
    expect(request.request.body.attendeeIds).toBeUndefined();
    request.flush(
      { success: true, data: { id: 'event-1' } },
      { status: 201, statusText: 'Created' }
    );
    await expectAsync(execution).toBeResolvedTo(undefined);
  });

  it('sends a reviewed calendar edit with its server target and complete preimage', async () => {
    householdContext.activeHouseholdId.set('home-a');
    const before = {
      title: 'Dentista',
      kind: 'appointment',
      date: '2026-10-20',
      startTime: '09:00',
      endTime: '09:30',
      allDay: false,
      color: '#60a5fa',
      notes: 'Llevar tarjeta',
      location: 'Calle Mayor',
      recurrence: 'none',
      recurrenceRule: null,
      exceptions: '[]',
      source: 'user'
    };
    const action = {
      ...actionBase('calendar.update_event', 'calendar', 'update_event'),
      kind: 'calendar.update_event',
      payload: {
        targetTitle: before.title,
        targetDate: before.date,
        targetStartTime: before.startTime,
        changes: { date: '2026-10-21', allDay: true, notes: null }
      },
      executionTarget: {
        kind: 'calendar-event',
        id: 'event-1',
        householdId: 'home-a',
        updatedAt: '2026-10-16 10:00:00',
        snapshot: before
      }
    } as AssistantAction;

    const execution = service.execute(action, 'home-a');
    const request = http.expectOne('/api/calendar/events/event-1/assistant-update');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({
      changes: { date: '2026-10-21', allDay: true, notes: null },
      assistantAction: {
        operation: 'update_event',
        targetId: 'event-1',
        householdId: 'home-a',
        before: { ...before, householdId: 'home-a', updatedAt: '2026-10-16 10:00:00' }
      }
    });
    expect(request.request.headers.get('x-assistant-action-id')).toBe(action.id);
    expect(request.request.headers.get('x-assistant-household-id')).toBe('home-a');
    expect(request.request.body.attendeeIds).toBeUndefined();
    request.flush({ success: true, data: { id: 'event-1' } });
    await expectAsync(execution).toBeResolvedTo(undefined);
  });

  it('rejects a calendar approval if the selected household changed after proposal', async () => {
    householdContext.activeHouseholdId.set('home-b');
    const action = calendarUpdateAction();

    await expectAsync(service.execute(action, 'home-a')).toBeRejectedWithError(
      'ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED'
    );
    http.expectNone('/api/calendar/events/event-1/assistant-update');
  });

  it('rejects mismatched calendar targets, scopes, and non-editable fields before HTTP', async () => {
    householdContext.activeHouseholdId.set('home-a');
    const invalidCases = [
      (action: any) => (action.executionTarget = undefined),
      (action: any) => (action.executionTarget.kind = 'other'),
      (action: any) => (action.executionTarget.id = ''),
      (action: any) => (action.executionTarget.householdId = 'home-b'),
      (action: any) => (action.executionTarget.snapshot.source = 'meal'),
      (action: any) => (action.executionTarget.snapshot.recurrence = 'weekly'),
      (action: any) => (action.payload.targetTitle = 'Otro evento'),
      (action: any) => (action.payload.targetDate = '2026-10-21'),
      (action: any) => (action.payload.targetStartTime = '10:00'),
      (action: any) => (action.payload.changes = {}),
      (action: any) => (action.payload.changes = { recurrence: 'weekly' })
    ];

    for (const [index, mutate] of invalidCases.entries()) {
      const action = structuredClone(calendarUpdateAction()) as any;
      action.id = `calendar-invalid-target-${index}`;
      mutate(action);
      await expectAsync(service.execute(action, 'home-a')).toBeRejectedWithError(
        'ASSISTANT_CALENDAR_EVENT_TARGET_INVALID'
      );
    }

    http.expectNone('/api/calendar/events/event-1/assistant-update');
  });

  it('rejects invalid calendar patches and no-op edits before HTTP', async () => {
    householdContext.activeHouseholdId.set('home-a');
    const invalidPatches: Array<Record<string, unknown>> = [
      { startTime: null, endTime: null },
      { startTime: '25:00' },
      { endTime: '25:00' },
      { startTime: '12:00', endTime: '11:00' },
      { title: '   ' },
      { title: 'x'.repeat(121) },
      { date: '2026-02-30' },
      { kind: 'meal' },
      { notes: 4 },
      { notes: 'x'.repeat(501) },
      { location: 4 },
      { location: 'x'.repeat(121) }
    ];

    for (const [index, changes] of invalidPatches.entries()) {
      const action = calendarUpdateAction(changes);
      action.id = `calendar-invalid-patch-${index}`;
      await expectAsync(service.execute(action, 'home-a')).toBeRejectedWithError(
        'ASSISTANT_CALENDAR_EVENT_PATCH_INVALID'
      );
    }

    const noOp = calendarUpdateAction({ startTime: '09:00' });
    noOp.id = 'calendar-update-no-op';
    await expectAsync(service.execute(noOp, 'home-a')).toBeRejectedWithError(
      'ASSISTANT_CALENDAR_EVENT_NO_CHANGE'
    );
    http.expectNone('/api/calendar/events/event-1/assistant-update');
  });

  it('preserves existing end time when clearing only start time and rejects failed domain response', async () => {
    householdContext.activeHouseholdId.set('home-a');
    const action = calendarUpdateAction({ startTime: null });
    action.id = 'calendar-update-clear-start';
    const execution = service.execute(action, 'home-a');
    const request = http.expectOne('/api/calendar/events/event-1/assistant-update');
    expect(request.request.body.changes).toEqual({ startTime: null });
    expect(request.request.body.assistantAction.before).toEqual(
      jasmine.objectContaining({
        startTime: '09:00',
        endTime: '09:30',
        updatedAt: '2026-10-16 10:00:00'
      })
    );
    request.flush({ success: false });
    await expectAsync(execution).toBeRejectedWithError('ASSISTANT_DOMAIN_WRITE_REJECTED');
  });

  it('updates one resolved household task using a fresh week snapshot and preserves other tasks', async () => {
    householdContext.activeHouseholdId.set('home-a');
    const before = {
      id: 'task-1',
      title: 'Bajar reciclaje',
      details: null,
      spaceId: null,
      scheduledDate: '2026-10-05',
      assignedMemberId: null,
      completed: false
    };
    const other = { ...before, id: 'task-2', title: 'Regar plantas', scheduledDate: '2026-10-06' };
    const action = {
      ...actionBase('household.update_task', 'household', 'update_task'),
      kind: 'household.update_task',
      payload: {
        targetTitle: before.title,
        targetScheduledDate: before.scheduledDate,
        changes: {
          title: null,
          details: 'Separar vidrio también',
          scheduledDate: null,
          spaceName: null,
          assignedMemberName: null
        }
      },
      executionTarget: {
        kind: 'household-task' as const,
        id: before.id,
        weekStart: '2026-10-05',
        version: 4,
        snapshot: before
      }
    } as AssistantAction;
    const execution = service.execute(action, 'home-a');
    const read = http.expectOne(
      (request) =>
        request.method === 'GET' &&
        request.url === '/api/household/tasks' &&
        request.params.get('weekStart') === '2026-10-05'
    );
    read.flush({
      success: true,
      data: { weekStart: '2026-10-05', version: 4, tasks: [before, other] }
    });
    await Promise.resolve();

    const save = http.expectOne(
      (request) => request.method === 'PUT' && request.url.includes('/household/tasks')
    );
    expect(save.request.method).toBe('PUT');
    expect(save.request.body).toEqual({
      weekStart: '2026-10-05',
      baseVersion: 4,
      tasks: [{ ...before, details: 'Separar vidrio también' }, other],
      assistantAction: { operation: 'update_task', targetId: 'task-1', before }
    });
    expect(save.request.headers.get('x-assistant-action-id')).toBe(action.id);
    expect(save.request.headers.get('x-household-id')).toBe('home-a');
    save.flush({ success: true, data: { weekStart: '2026-10-05', version: 5, tasks: [] } });
    await expectAsync(execution).toBeResolvedTo(undefined);
  });

  it('sends a reviewed shopping-list edit with its server target, version, and preimage', async () => {
    householdContext.activeHouseholdId.set('home-a');
    const action = {
      ...actionBase('shopping.update_list', 'shopping', 'update_list'),
      kind: 'shopping.update_list',
      payload: {
        targetName: 'Compra semanal',
        changes: { name: 'Compra del sábado', setName: true, store: null, setStore: true }
      },
      executionTarget: {
        kind: 'shopping-list',
        id: 'list-1',
        version: 3,
        snapshot: { name: 'Compra semanal', store: 'Lidl' }
      }
    } as AssistantAction;

    const execution = service.execute(action, 'home-a');
    const request = http.expectOne('/api/shopping/lists/list-1/assistant-update');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({
      version: 3,
      changes: { name: 'Compra del sábado', store: null },
      assistantAction: {
        operation: 'update_list',
        targetId: 'list-1',
        before: { name: 'Compra semanal', store: 'Lidl' }
      }
    });
    expect(request.request.headers.get('x-assistant-action-id')).toBe(action.id);
    expect(request.request.headers.get('x-assistant-household-id')).toBe('home-a');
    request.flush({ success: true, data: { idempotent: false } });
    await expectAsync(execution).toBeResolvedTo(undefined);
  });

  it('sends only selected pantry changes with the server preimage and action id', async () => {
    householdContext.activeHouseholdId.set('home-a');
    const action = {
      ...actionBase('pantry.update_ingredient', 'pantry', 'update_ingredient'),
      kind: 'pantry.update_ingredient',
      payload: {
        targetName: '  Yogur   natural  ',
        changes: {
          name: 'Yogur griego',
          setName: true,
          category: null,
          setCategory: false,
          quantity: 0,
          setQuantity: true,
          unit: null,
          setUnit: false,
          expirationDate: null,
          setExpirationDate: true,
          location: null,
          setLocation: false,
          notes: null,
          setNotes: true
        }
      },
      executionTarget: {
        kind: 'pantry-ingredient',
        id: 'ingredient-1',
        snapshot: {
          name: 'Yogur natural',
          category: 'dairy',
          quantity: 2,
          unit: 'unit',
          expirationDate: '2026-10-20',
          location: 'fridge',
          notes: 'Desayuno',
          updatedAt: '2026-10-16 10:00:00'
        }
      }
    } as AssistantAction;

    const execution = service.execute(action, 'home-a');
    const request = http.expectOne('/api/pantry/ingredients/ingredient-1/assistant-update');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({
      changes: {
        name: 'Yogur griego',
        quantity: 0,
        expirationDate: null,
        notes: null
      },
      assistantAction: {
        operation: 'update_ingredient',
        targetId: 'ingredient-1',
        before: action.executionTarget!.snapshot
      }
    });
    expect(request.request.headers.get('x-assistant-action-id')).toBe(action.id);
    expect(request.request.headers.get('x-assistant-household-id')).toBe('home-a');
    request.flush({ success: true, data: { id: 'ingredient-1' } });
    await expectAsync(execution).toBeResolvedTo(undefined);
  });

  it('blocks stale and cross-week task updates before sending a write', async () => {
    householdContext.activeHouseholdId.set('home-a');
    const before = {
      id: 'task-1',
      title: 'Bajar reciclaje',
      details: null,
      spaceId: null,
      scheduledDate: '2026-10-05',
      assignedMemberId: null,
      completed: false
    };
    const action = {
      ...actionBase('household.update_task', 'household', 'update_task'),
      kind: 'household.update_task',
      payload: {
        targetTitle: before.title,
        targetScheduledDate: before.scheduledDate,
        changes: {
          title: null,
          details: null,
          scheduledDate: '2026-10-12',
          spaceName: null,
          assignedMemberName: null
        }
      },
      executionTarget: {
        kind: 'household-task' as const,
        id: before.id,
        weekStart: '2026-10-05',
        version: 4,
        snapshot: before
      }
    } as AssistantAction;
    const execution = service.execute(action, 'home-a');
    const read = http.expectOne(
      (request) => request.url === '/api/household/tasks' && request.method === 'GET'
    );
    read.flush({ success: true, data: { weekStart: '2026-10-05', version: 5, tasks: [before] } });
    await expectAsync(execution).toBeRejectedWithError('ASSISTANT_TASK_STALE');
    http.expectNone((request) => request.method === 'PUT');
  });

  it('confirms only the reviewed meal draft through the existing idempotent meal API', async () => {
    householdContext.activeHouseholdId.set('home-a');
    const action = {
      ...actionBase('household.plan_meals', 'household', 'plan_meals'),
      kind: 'household.plan_meals',
      payload: { weekStart: '2026-10-05', instructions: 'Comidas sencillas.' }
    } as AssistantAction;
    const proposal: HouseholdMealProposal = {
      proposalId: 'meal-proposal-1',
      weekStart: '2026-10-05',
      participants: [{ alias: 'P1', householdMemberId: 'membership-1' }],
      recipes: [],
      events: [
        {
          id: 'event-1',
          date: '2026-10-05',
          mealType: 'lunch',
          time: '13:00',
          recipeAlias: 'R1',
          participantAliases: ['P1'],
          participantIds: ['user-1'],
          servings: 2,
          objectiveSummary: 'Comida equilibrada.',
          status: 'scheduled',
          reason: null
        }
      ]
    };
    const execution = service.execute(action, 'home-a', proposal);
    const request = http.expectOne('/api/household/meal-planning/confirm');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('x-household-id')).toBe('home-a');
    expect(request.request.body).toEqual({
      proposalId: proposal.proposalId,
      weekStart: proposal.weekStart,
      householdMemberIds: ['membership-1'],
      recipes: proposal.recipes,
      events: proposal.events
    });
    request.flush({ success: true, data: { proposalId: proposal.proposalId, idempotent: false } });
    await expectAsync(execution).toBeResolvedTo(undefined);
    http.expectNone('/api/household/meal-planning/shopping-preview');
  });

  it('rejects a changed meal proposal after an uncertain confirmation attempt', async () => {
    householdContext.activeHouseholdId.set('home-a');
    const action = {
      ...actionBase('household.plan_meals', 'household', 'plan_meals'),
      kind: 'household.plan_meals',
      payload: { weekStart: '2026-10-05', instructions: 'Comidas sencillas.' }
    } as AssistantAction;
    const proposal: HouseholdMealProposal = {
      proposalId: 'meal-proposal-2',
      weekStart: '2026-10-05',
      participants: [{ alias: 'P1', householdMemberId: 'membership-1' }],
      recipes: [],
      events: [
        {
          id: 'event-1',
          date: '2026-10-05',
          mealType: 'lunch',
          time: '13:00',
          recipeAlias: 'R1',
          participantAliases: ['P1'],
          participantIds: ['user-1'],
          servings: 2,
          objectiveSummary: 'Comida equilibrada.',
          status: 'scheduled',
          reason: null
        }
      ]
    };
    const firstAttempt = service.execute(action, 'home-a', proposal);
    http
      .expectOne('/api/household/meal-planning/confirm')
      .flush({ success: false }, { status: 500, statusText: 'Server Error' });
    await expectAsync(firstAttempt).toBeRejected();

    const changedProposal = {
      ...proposal,
      proposalId: 'meal-proposal-3',
      events: proposal.events.map((event) => ({ ...event, servings: 3 }))
    };
    await expectAsync(service.execute(action, 'home-a', changedProposal)).toBeRejectedWithError(
      'ASSISTANT_ACTION_PAYLOAD_CHANGED_AFTER_ATTEMPT'
    );
    http.expectNone('/api/household/meal-planning/confirm');
  });

  it('rejects non-allowlisted action kinds without sending a request', async () => {
    await expectAsync(
      service.execute({ kind: 'system.execute', id: 'x' } as never, null)
    ).toBeRejected();
    http.expectNone(() => true);
  });

  it('sends a reviewed recipe edit only to the dedicated preimage endpoint', async () => {
    const before = {
      name: 'Lentejas',
      servings: 2,
      ingredients: [
        {
          ingredientId: null,
          name: 'Cebolla',
          quantity: 100,
          unit: 'g',
          preparation: null,
          isOptional: false,
          substitutes: [],
          notes: null
        },
        {
          ingredientId: null,
          name: 'Lentejas',
          quantity: 200,
          unit: 'g',
          preparation: null,
          isOptional: false,
          substitutes: [],
          notes: null
        }
      ],
      steps: [
        {
          stepNumber: 1,
          instruction: 'Sofríe la cebolla.',
          duration: null,
          temperature: null,
          timerRequired: false,
          timerDuration: null,
          tips: null,
          warning: null,
          image: null,
          illustration: null
        }
      ]
    };
    const action = {
      ...actionBase('recipes.update_content', 'recipes', 'update_content'),
      payload: {
        targetName: 'Lentejas',
        changes: {
          servings: null,
          ingredients: [{ operation: 'update', targetName: 'Cebolla', changes: { quantity: 75 } }],
          instructions: []
        }
      },
      executionTarget: { kind: 'recipe', id: 'recipe-1', snapshot: before }
    } as unknown as Extract<AssistantAction, { kind: 'recipes.update_content' }>;

    const execution = service.execute(action, null);
    const request = http.expectOne('/api/recipes/recipe-1/assistant-update');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.headers.get('x-assistant-action-id')).toBe(action.id);
    expect(request.request.body).toEqual({
      changes: action.payload.changes,
      assistantAction: {
        operation: 'update_recipe_content',
        targetId: 'recipe-1',
        before
      }
    });
    request.flush({
      success: true,
      data: {
        id: 'recipe-1',
        name: 'Lentejas',
        servings: 2,
        ingredients: before.ingredients,
        steps: before.steps
      }
    });
    await expectAsync(execution).toBeResolvedTo(undefined);
    http.expectNone('/api/recipes/recipe-1');
  });
});

function actionBase<K extends AssistantAction['kind']>(
  kind: K,
  domain: AssistantAction['domain'],
  actionType: string
): AssistantAction {
  return {
    id: '123e4567-e89b-42d3-a456-426614174000',
    kind,
    domain,
    actionType,
    title: 'Acción',
    summary: 'Resumen',
    dependsOn: [],
    warnings: [],
    selected: true,
    status: 'pending',
    payload: {} as never
  } as AssistantAction;
}

function calendarUpdateAction(
  changes: Record<string, unknown> = { date: '2026-10-21' }
): AssistantAction {
  const snapshot = {
    title: 'Dentista',
    kind: 'appointment',
    date: '2026-10-20',
    startTime: '09:00',
    endTime: '09:30',
    allDay: false,
    color: '#60a5fa',
    notes: 'Llevar tarjeta',
    location: 'Calle Mayor',
    recurrence: 'none',
    recurrenceRule: null,
    exceptions: '[]',
    source: 'user'
  };
  return {
    ...actionBase('calendar.update_event', 'calendar', 'update_event'),
    kind: 'calendar.update_event',
    payload: {
      targetTitle: snapshot.title,
      targetDate: snapshot.date,
      targetStartTime: snapshot.startTime,
      changes
    },
    executionTarget: {
      kind: 'calendar-event',
      id: 'event-1',
      householdId: 'home-a',
      updatedAt: '2026-10-16 10:00:00',
      snapshot
    }
  } as AssistantAction;
}

function pantryAction(): AssistantAction {
  return {
    ...actionBase('pantry.add_ingredient', 'pantry', 'add_ingredient'),
    kind: 'pantry.add_ingredient',
    payload: {
      name: 'Lentejas',
      category: 'legumes',
      quantity: 500,
      unit: 'g',
      expirationDate: null,
      location: 'pantry',
      notes: null
    }
  } as AssistantAction;
}
