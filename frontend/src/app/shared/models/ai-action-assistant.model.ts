import type { AIRecipeResponse } from './ai-config.model';

export type AssistantActionDomain = 'pantry' | 'shopping' | 'household' | 'calendar' | 'recipes';
export type AssistantActionStatus = 'pending' | 'succeeded' | 'failed' | 'blocked';

interface AssistantActionBase<
  TKind extends string,
  TDomain extends AssistantActionDomain,
  TActionType extends string,
  TPayload
> {
  id: string;
  kind: TKind;
  domain: TDomain;
  actionType: TActionType;
  title: string;
  summary: string;
  payload: TPayload;
  dependsOn: string[];
  warnings: string[];
  selected: boolean;
  status: AssistantActionStatus;
  manualFields?: string[];
  executionTarget?: AssistantTaskUpdateExecutionTarget;
}

export interface PantryIngredientPayload {
  name: string;
  quantity: number;
  unit: 'g' | 'kg' | 'ml' | 'l' | 'cup' | 'tbsp' | 'tsp' | 'unit' | 'bunch' | 'slice' | 'piece';
  category: string;
  expirationDate: string | null;
  location: 'fridge' | 'freezer' | 'pantry' | 'counter';
  notes: string | null;
}

export interface ShoppingListPayload {
  name: string;
  store: string | null;
}

export interface ShoppingItemPayload {
  listName: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
}

export interface HouseholdTaskPayload {
  title: string;
  details: string | null;
  scheduledDate: string;
  spaceName: string | null;
  assignedMemberName: string | null;
}

export interface HouseholdMealPlanPayload {
  weekStart: string;
  instructions: string;
}

export interface HouseholdTaskUpdatePayload {
  targetTitle: string;
  targetScheduledDate: string;
  changes: {
    title: string | null;
    details: string | null;
    scheduledDate: string | null;
    spaceName: string | null;
    assignedMemberName: string | null;
  };
}

export interface AssistantTaskUpdateExecutionTarget {
  kind: 'household-task';
  id: string;
  weekStart: string;
  version: number;
  snapshot: {
    id: string;
    title: string;
    details: string | null;
    spaceId: string | null;
    scheduledDate: string;
    assignedMemberId: string | null;
    completed: boolean;
  };
}

export interface CalendarEventPayload {
  title: string;
  kind: 'appointment' | 'home' | 'shopping' | 'personal' | 'other';
  date: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  sharedWithHousehold: boolean;
  location: string | null;
  notes: string | null;
}

export interface AssistantActionCandidateBase<TKind extends string, TPayload> {
  kind: TKind;
  title: string;
  summary: string;
  payload: TPayload;
  dependsOn: number[];
  warnings: string[];
}

export type AssistantActionCandidate =
  | AssistantActionCandidateBase<'pantry.add_ingredient', PantryIngredientPayload>
  | AssistantActionCandidateBase<'shopping.create_list', ShoppingListPayload>
  | AssistantActionCandidateBase<'shopping.add_item', ShoppingItemPayload>
  | AssistantActionCandidateBase<'household.plan_meals', HouseholdMealPlanPayload>
  | AssistantActionCandidateBase<'household.create_task', HouseholdTaskPayload>
  | AssistantActionCandidateBase<'household.update_task', HouseholdTaskUpdatePayload>
  | AssistantActionCandidateBase<'calendar.create_event', CalendarEventPayload>
  | AssistantActionCandidateBase<'recipes.create_draft', { recipe: AIRecipeResponse }>;

export type AssistantAction =
  | (AssistantActionBase<
      'pantry.add_ingredient',
      'pantry',
      'add_ingredient',
      PantryIngredientPayload
    > & { dependsOn: string[] })
  | (AssistantActionBase<'shopping.create_list', 'shopping', 'create_list', ShoppingListPayload> & {
      dependsOn: string[];
    })
  | (AssistantActionBase<'shopping.add_item', 'shopping', 'add_item', ShoppingItemPayload> & {
      dependsOn: string[];
    })
  | (AssistantActionBase<
      'household.plan_meals',
      'household',
      'plan_meals',
      HouseholdMealPlanPayload
    > & { dependsOn: string[] })
  | (AssistantActionBase<
      'household.create_task',
      'household',
      'create_task',
      HouseholdTaskPayload
    > & {
      dependsOn: string[];
    })
  | (AssistantActionBase<
      'household.update_task',
      'household',
      'update_task',
      HouseholdTaskUpdatePayload
    > & {
      dependsOn: string[];
      executionTarget: AssistantTaskUpdateExecutionTarget;
    })
  | (AssistantActionBase<
      'calendar.create_event',
      'calendar',
      'create_event',
      CalendarEventPayload
    > & {
      dependsOn: string[];
    })
  | (AssistantActionBase<
      'recipes.create_draft',
      'recipes',
      'create_draft',
      { recipe: AIRecipeResponse }
    > & { dependsOn: string[] });

export interface AssistantActionPlan {
  id: string;
  summary: string;
  actions: AssistantAction[];
  questions: string[];
}

export interface AssistantActionRefinementResult {
  actionId: string;
  summary: string;
  replacement: AssistantActionCandidate | null;
  questions: string[];
}

export interface AssistantBatchRefinementResult {
  summary: string;
  replacements: Array<{ actionId: string; replacement: AssistantActionCandidate }>;
  questions: string[];
}

export type AssistantActionRefinementScope =
  { kind: 'action' } | { kind: 'field'; path: Array<string | number> };

export type AssistantBatchRefinementScope =
  | { kind: 'batch' }
  | {
      kind: 'group';
      domain: AssistantActionDomain;
    };

export type AssistantRouteHint =
  'dashboard' | 'pantry' | 'shopping' | 'calendar' | 'recipes' | 'household';
