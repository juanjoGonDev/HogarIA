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
