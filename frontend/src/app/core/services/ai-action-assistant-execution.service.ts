import { HttpClient, HttpContext, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { HouseholdPlanService } from './household-plan.service';
import { HouseholdService } from './household.service';
import { HouseholdTasksService } from './household-tasks.service';
import { HouseholdMealProposalService } from './household-meal-proposal.service';
import type { HouseholdMealProposal } from './household-meal-proposal.service';
import type { HouseholdTaskOccurrence } from '../../shared/models/household-task.model';
import type { AssistantAction } from '../../shared/models/ai-action-assistant.model';

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
}

interface ShoppingListMatch {
  id: string;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class AiActionAssistantExecutionService {
  private readonly http = inject(HttpClient);
  private readonly household = inject(HouseholdService);
  private readonly householdPlan = inject(HouseholdPlanService);
  private readonly householdTasks = inject(HouseholdTasksService);
  private readonly mealProposals = inject(HouseholdMealProposalService);
  private readonly apiUrl = environment.apiUrl;
  private readonly silentContext = new HttpContext().set(SILENT_TOAST, true);
  private readonly attemptedActionPayloads = new Map<string, string>();
  private readonly completedActionIds = new Set<string>();
  private readonly executingActionIds = new Map<string, Promise<void>>();

  /**
   * Execute a reviewed action through its domain API. The stable action ID is also sent to the
   * server's atomic idempotency ledger, so an exact retry after an uncertain response is safe.
   */
  execute(
    action: AssistantAction,
    expectedHouseholdId: string | null,
    mealProposal?: HouseholdMealProposal
  ): Promise<void> {
    if (this.household.activeHouseholdId() !== expectedHouseholdId) {
      return Promise.reject(new Error('ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED'));
    }
    const inFlight = this.executingActionIds.get(action.id);
    if (inFlight) return inFlight;
    if (this.completedActionIds.has(action.id)) {
      return Promise.reject(new Error('ASSISTANT_ACTION_ALREADY_SUCCEEDED'));
    }

    const payloadSnapshot = JSON.stringify({
      kind: action.kind,
      payload: action.payload,
      executionTarget: action.executionTarget ?? null,
      householdId: expectedHouseholdId,
      ...(action.kind === 'household.plan_meals' ? { mealProposal } : {})
    });
    const attemptedPayload = this.attemptedActionPayloads.get(action.id);
    if (attemptedPayload !== undefined && attemptedPayload !== payloadSnapshot) {
      return Promise.reject(new Error('ASSISTANT_ACTION_PAYLOAD_CHANGED_AFTER_ATTEMPT'));
    }
    this.rememberAttempt(action.id, payloadSnapshot);
    const execution = this.executeDomainAction(action, expectedHouseholdId, mealProposal)
      .then(() => {
        this.completedActionIds.add(action.id);
      })
      .finally(() => {
        this.executingActionIds.delete(action.id);
      });
    this.executingActionIds.set(action.id, execution);
    return execution;
  }

  private async executeDomainAction(
    action: AssistantAction,
    expectedHouseholdId: string | null,
    mealProposal?: HouseholdMealProposal
  ): Promise<void> {
    switch (action.kind) {
      case 'pantry.add_ingredient':
        await this.post(
          '/pantry/ingredients',
          {
            name: action.payload.name,
            category: action.payload.category,
            quantity: action.payload.quantity,
            unit: action.payload.unit,
            expirationDate: action.payload.expirationDate,
            location: action.payload.location,
            notes: action.payload.notes
          },
          expectedHouseholdId,
          action.id
        );
        return;

      case 'pantry.update_ingredient':
        await this.updatePantryIngredient(action, expectedHouseholdId);
        return;

      case 'shopping.create_list':
        await this.post(
          '/shopping/lists',
          {
            name: action.payload.name,
            store: action.payload.store
          },
          expectedHouseholdId,
          action.id
        );
        return;

      case 'shopping.update_list':
        await this.updateShoppingList(action, expectedHouseholdId);
        return;

      case 'shopping.add_item': {
        const lists = await this.get<{ data: ShoppingListMatch[] }>(
          '/shopping/lists',
          new HttpParams()
            .set('status', 'active')
            .set('q', action.payload.listName)
            .set('limit', '200'),
          expectedHouseholdId
        );
        const matches = (lists.data ?? []).filter(
          (list) => this.comparable(list.name) === this.comparable(action.payload.listName)
        );
        if (matches.length !== 1) throw new Error('ASSISTANT_SHOPPING_LIST_NOT_UNIQUE');
        await this.post(
          `/shopping/lists/${encodeURIComponent(matches[0].id)}/items`,
          {
            name: action.payload.name,
            quantity: action.payload.quantity ?? 1,
            unit: action.payload.unit,
            category: action.payload.category,
            note: null
          },
          expectedHouseholdId,
          action.id
        );
        return;
      }

      case 'household.create_task':
        await this.createHouseholdTask(action, expectedHouseholdId);
        return;

      case 'household.plan_meals': {
        if (
          !expectedHouseholdId ||
          !mealProposal ||
          mealProposal.weekStart !== action.payload.weekStart ||
          mealProposal.participants.length === 0 ||
          !mealProposal.events.some((event) => event.status === 'scheduled')
        ) {
          throw new Error('ASSISTANT_MEAL_PROPOSAL_STALE');
        }
        await firstValueFrom(
          this.mealProposals.confirmProposal(expectedHouseholdId, {
            proposalId: mealProposal.proposalId,
            weekStart: mealProposal.weekStart,
            householdMemberIds: mealProposal.participants.map(
              (participant) => participant.householdMemberId
            ),
            recipes: mealProposal.recipes,
            events: mealProposal.events
          })
        );
        return;
      }

      case 'household.update_task':
        await this.updateHouseholdTask(action, expectedHouseholdId);
        return;

      case 'calendar.create_event':
        await this.post(
          '/calendar/events',
          {
            title: action.payload.title,
            kind: action.payload.kind,
            date: action.payload.date,
            startTime: action.payload.startTime,
            endTime: action.payload.endTime,
            allDay: action.payload.allDay,
            sharedWithHousehold: action.payload.sharedWithHousehold,
            location: action.payload.location,
            notes: action.payload.notes
          },
          expectedHouseholdId,
          action.id
        );
        return;

      case 'recipes.create_draft': {
        const recipe = action.payload.recipe;
        await this.post(
          '/recipes',
          {
            name: recipe.name,
            description: recipe.description,
            difficulty: recipe.difficulty,
            cuisine: recipe.cuisine,
            mealType: [],
            totalTime: recipe.totalTime,
            prepTime: recipe.prepTime,
            cookTime: recipe.cookTime,
            restTime: recipe.restTime,
            servings: recipe.baseServings,
            calories: recipe.calories,
            ingredients: recipe.ingredients,
            utensils: recipe.utensils,
            guidance: recipe.guidance,
            instructionsByLevel: recipe.instructionsByLevel,
            tags: recipe.tags,
            nutrition: recipe.nutrition,
            storage: recipe.storage,
            author: 'ai',
            isPublic: false
          },
          expectedHouseholdId,
          action.id
        );
        return;
      }

      default:
        throw new Error('ASSISTANT_ACTION_NOT_ALLOWED');
    }
  }

  private async createHouseholdTask(
    action: Extract<AssistantAction, { kind: 'household.create_task' }>,
    householdId: string | null
  ): Promise<void> {
    if (!householdId) throw new Error('HOUSEHOLD_REQUIRED');
    const weekStart = this.mondayOf(action.payload.scheduledDate);
    const week = await firstValueFrom(this.householdTasks.load(householdId, weekStart));
    const id = `assistant-${action.id}`;
    let spaceId: string | null = null;
    let assignedMemberId: string | null = null;

    if (action.payload.spaceName) {
      const versionedPlan = await firstValueFrom(this.householdPlan.load(householdId));
      const spaces = versionedPlan.plan?.floors.flatMap((floor) => floor.spaces) ?? [];
      const matches = spaces.filter(
        (space) => this.comparable(space.label) === this.comparable(action.payload.spaceName)
      );
      if (matches.length !== 1) throw new Error('ASSISTANT_TASK_SPACE_NOT_UNIQUE');
      spaceId = matches[0].id;
    }

    if (action.payload.assignedMemberName) {
      const household = this.household.household();
      if (household?.id !== householdId) throw new Error('ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED');
      const matches = household.members.filter(
        (member) =>
          member.isActive &&
          this.comparable(member.name) === this.comparable(action.payload.assignedMemberName)
      );
      if (matches.length !== 1) throw new Error('ASSISTANT_TASK_MEMBER_NOT_UNIQUE');
      assignedMemberId = matches[0].userId;
    }

    const task: HouseholdTaskOccurrence = {
      id,
      title: action.payload.title,
      details: action.payload.details,
      scheduledDate: action.payload.scheduledDate,
      spaceId,
      assignedMemberId,
      completed: false
    };
    const existing = week.tasks.find((item) => item.id === id);
    if (existing) {
      if (this.sameTask(existing, task)) return;
      throw new Error('ASSISTANT_TASK_ID_CONFLICT');
    }

    await firstValueFrom(
      this.householdTasks.save(
        householdId,
        weekStart,
        week.version,
        [...week.tasks, task],
        action.id
      )
    );
  }

  private async updateHouseholdTask(
    action: Extract<AssistantAction, { kind: 'household.update_task' }>,
    householdId: string | null
  ): Promise<void> {
    if (!householdId) throw new Error('HOUSEHOLD_REQUIRED');
    const target = action.executionTarget;
    if (
      !target ||
      target.kind !== 'household-task' ||
      target.id !== target.snapshot.id ||
      this.comparable(target.snapshot.title) !== this.comparable(action.payload.targetTitle) ||
      target.snapshot.scheduledDate !== action.payload.targetScheduledDate
    ) {
      throw new Error('ASSISTANT_TASK_TARGET_INVALID');
    }

    const week = await firstValueFrom(this.householdTasks.load(householdId, target.weekStart));
    if (week.version !== target.version) throw new Error('ASSISTANT_TASK_STALE');
    const taskIndex = week.tasks.findIndex((task) => task.id === target.id);
    if (taskIndex < 0 || !this.sameTask(week.tasks[taskIndex], target.snapshot)) {
      throw new Error('ASSISTANT_TASK_STALE');
    }

    const changes = action.payload.changes;
    const scheduledDate = changes.scheduledDate ?? target.snapshot.scheduledDate;
    if (this.mondayOf(scheduledDate) !== target.weekStart) {
      throw new Error('ASSISTANT_TASK_CROSS_WEEK');
    }

    let spaceId = target.snapshot.spaceId;
    if (changes.spaceName) {
      const versionedPlan = await firstValueFrom(this.householdPlan.load(householdId));
      const spaces = versionedPlan.plan?.floors.flatMap((floor) => floor.spaces) ?? [];
      const matches = spaces.filter(
        (space) => this.comparable(space.label) === this.comparable(changes.spaceName)
      );
      if (matches.length !== 1) throw new Error('ASSISTANT_TASK_SPACE_NOT_UNIQUE');
      spaceId = matches[0].id;
    }

    let assignedMemberId = target.snapshot.assignedMemberId;
    if (changes.assignedMemberName) {
      const household = this.household.household();
      if (household?.id !== householdId) throw new Error('ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED');
      const matches = household.members.filter(
        (member) =>
          member.isActive &&
          this.comparable(member.name) === this.comparable(changes.assignedMemberName)
      );
      if (matches.length !== 1) throw new Error('ASSISTANT_TASK_MEMBER_NOT_UNIQUE');
      assignedMemberId = matches[0].userId;
    }

    const updated: HouseholdTaskOccurrence = {
      ...target.snapshot,
      title: changes.title ?? target.snapshot.title,
      details: changes.details ?? target.snapshot.details,
      scheduledDate,
      spaceId,
      assignedMemberId
    };
    if (this.sameTask(updated, target.snapshot)) throw new Error('ASSISTANT_TASK_NO_CHANGE');

    await firstValueFrom(
      this.householdTasks.save(
        householdId,
        target.weekStart,
        target.version,
        week.tasks.map((task, index) => (index === taskIndex ? updated : task)),
        action.id,
        { operation: 'update_task', targetId: target.id, before: target.snapshot }
      )
    );
  }

  private async updateShoppingList(
    action: Extract<AssistantAction, { kind: 'shopping.update_list' }>,
    householdId: string | null
  ): Promise<void> {
    const target = action.executionTarget;
    const { changes } = action.payload;
    if (
      !target ||
      target.kind !== 'shopping-list' ||
      !target.id ||
      target.version < 1 ||
      this.comparable(target.snapshot.name) !== this.comparable(action.payload.targetName) ||
      changes.setName !== (changes.name !== null) ||
      (!changes.setStore && changes.store !== null)
    ) {
      throw new Error('ASSISTANT_SHOPPING_LIST_TARGET_INVALID');
    }

    const requestChanges: { name?: string; store?: string | null } = {};
    if (changes.setName && changes.name !== null) requestChanges.name = changes.name;
    if (changes.setStore) requestChanges.store = changes.store;
    const hasEffectiveChange =
      ('name' in requestChanges && requestChanges.name !== target.snapshot.name) ||
      ('store' in requestChanges && requestChanges.store !== target.snapshot.store);
    if (!hasEffectiveChange) {
      throw new Error('ASSISTANT_SHOPPING_LIST_NO_CHANGE');
    }

    const response = await firstValueFrom(
      this.http.patch<ApiEnvelope<unknown>>(
        `${this.apiUrl}/shopping/lists/${encodeURIComponent(target.id)}/assistant-update`,
        {
          version: target.version,
          changes: requestChanges,
          assistantAction: {
            operation: 'update_list',
            targetId: target.id,
            before: target.snapshot
          }
        },
        {
          context: this.silentContext,
          headers: this.householdHeaders(householdId).set('x-assistant-action-id', action.id)
        }
      )
    );
    if (response?.success !== true) throw new Error('ASSISTANT_DOMAIN_WRITE_REJECTED');
  }

  private async updatePantryIngredient(
    action: Extract<AssistantAction, { kind: 'pantry.update_ingredient' }>,
    householdId: string | null
  ): Promise<void> {
    const target = action.executionTarget;
    const { changes } = action.payload;
    if (
      !target ||
      target.kind !== 'pantry-ingredient' ||
      !target.id ||
      this.comparablePantryName(target.snapshot.name) !==
        this.comparablePantryName(action.payload.targetName)
    ) {
      throw new Error('ASSISTANT_INGREDIENT_TARGET_INVALID');
    }

    const requestChanges: {
      name?: string;
      category?: string;
      quantity?: number;
      unit?: string;
      expirationDate?: string | null;
      location?: string;
      notes?: string | null;
    } = {};
    const selectedFields = [
      ['name', changes.name, changes.setName],
      ['category', changes.category, changes.setCategory],
      ['quantity', changes.quantity, changes.setQuantity],
      ['unit', changes.unit, changes.setUnit],
      ['expirationDate', changes.expirationDate, changes.setExpirationDate],
      ['location', changes.location, changes.setLocation],
      ['notes', changes.notes, changes.setNotes]
    ] as const;
    for (const [field, value, selected] of selectedFields) {
      if (selected) {
        if (value === null && field !== 'expirationDate' && field !== 'notes') {
          throw new Error('ASSISTANT_INGREDIENT_PATCH_INVALID');
        }
        Object.assign(requestChanges, { [field]: value });
      } else if (value !== null) {
        throw new Error('ASSISTANT_INGREDIENT_PATCH_INVALID');
      }
    }
    if (
      Object.entries(requestChanges).every(
        ([field, value]) => value === target.snapshot[field as keyof typeof target.snapshot]
      )
    ) {
      throw new Error('ASSISTANT_INGREDIENT_NO_CHANGE');
    }

    const response = await firstValueFrom(
      this.http.patch<ApiEnvelope<unknown>>(
        `${this.apiUrl}/pantry/ingredients/${encodeURIComponent(target.id)}/assistant-update`,
        {
          changes: requestChanges,
          assistantAction: {
            operation: 'update_ingredient',
            targetId: target.id,
            before: target.snapshot
          }
        },
        {
          context: this.silentContext,
          headers: this.householdHeaders(householdId).set('x-assistant-action-id', action.id)
        }
      )
    );
    if (response?.success !== true) throw new Error('ASSISTANT_DOMAIN_WRITE_REJECTED');
  }

  private async post(
    path: string,
    body: unknown,
    householdId: string | null,
    actionId: string
  ): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<ApiEnvelope<unknown>>(`${this.apiUrl}${path}`, body, {
        context: this.silentContext,
        headers: this.householdHeaders(householdId).set('x-assistant-action-id', actionId)
      })
    );
    if (response?.success !== true) throw new Error('ASSISTANT_DOMAIN_WRITE_REJECTED');
  }

  private get<T>(path: string, params: HttpParams, householdId: string | null): Promise<T> {
    return firstValueFrom(
      this.http.get<T>(`${this.apiUrl}${path}`, {
        params,
        context: this.silentContext,
        headers: this.assistantHouseholdHeaders(householdId)
      })
    );
  }

  private householdHeaders(householdId: string | null): HttpHeaders {
    return this.assistantHouseholdHeaders(householdId);
  }

  private assistantHouseholdHeaders(householdId: string | null): HttpHeaders {
    return new HttpHeaders({ 'x-assistant-household-id': householdId ?? '' });
  }

  private mondayOf(date: string): string {
    const value = new Date(`${date}T00:00:00.000Z`);
    const offset = (value.getUTCDay() + 6) % 7;
    value.setUTCDate(value.getUTCDate() - offset);
    return value.toISOString().slice(0, 10);
  }

  private comparable(value: string | null | undefined): string {
    return String(value ?? '')
      .normalize('NFC')
      .trim()
      .toLocaleLowerCase();
  }

  private comparablePantryName(value: string): string {
    return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private sameTask(left: HouseholdTaskOccurrence, right: HouseholdTaskOccurrence): boolean {
    return (
      left.title === right.title &&
      left.details === right.details &&
      left.scheduledDate === right.scheduledDate &&
      left.spaceId === right.spaceId &&
      left.assignedMemberId === right.assignedMemberId &&
      left.completed === right.completed
    );
  }

  private rememberAttempt(id: string, payloadSnapshot: string): void {
    if (this.attemptedActionPayloads.size >= 256 && !this.attemptedActionPayloads.has(id)) {
      const oldest = this.attemptedActionPayloads.keys().next().value;
      if (oldest) this.attemptedActionPayloads.delete(oldest);
    }
    this.attemptedActionPayloads.set(id, payloadSnapshot);
  }
}
