import type { AIRecipeResponse } from './ai-config.model';
import type { RecipeStep } from './recipe.model';
import type { HouseholdTaskPriority } from './household-task.model';

export type AssistantRecipeInstructionLevel = 'legacy' | 'basic' | 'intermediate' | 'expert';

export interface AssistantRecipeIngredient {
  ingredientId?: string | null;
  name: string;
  quantity: number;
  unit: 'g' | 'kg' | 'ml' | 'l' | 'cup' | 'tbsp' | 'tsp' | 'unit' | 'bunch' | 'slice' | 'piece';
  preparation?: string | null;
  isOptional?: boolean;
  substitutes?: string[];
  notes?: string | null;
}

export interface AssistantRecipeContentSnapshot {
  name: string;
  servings: number;
  ingredients: AssistantRecipeIngredient[];
  steps:
    | RecipeStep[]
    | {
        basic: RecipeStep[];
        intermediate: RecipeStep[];
        expert: RecipeStep[];
      };
}

export type AssistantRecipeIngredientChange =
  | {
      operation: 'add';
      ingredient: {
        name: string;
        quantity: number;
        unit: AssistantRecipeIngredient['unit'];
        preparation: string | null;
        isOptional: boolean;
        substitutes: string[];
        notes: string | null;
      };
    }
  | {
      operation: 'update';
      targetName: string;
      changes: Partial<Omit<AssistantRecipeIngredient, 'ingredientId'>>;
    }
  | { operation: 'remove'; targetName: string };

export interface AssistantRecipeInstructionChange {
  level: AssistantRecipeInstructionLevel;
  stepNumber: number;
  instruction: string;
}

export interface AssistantRecipeContentChanges {
  servings: number | null;
  ingredients: AssistantRecipeIngredientChange[];
  instructions: AssistantRecipeInstructionChange[];
}

export interface AssistantRecipeUpdatePayload {
  targetName: string;
  changes: AssistantRecipeContentChanges;
}

export interface AssistantRecipeUpdateExecutionTarget {
  kind: 'recipe';
  id: string;
  snapshot: AssistantRecipeContentSnapshot;
}

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
  executionTarget?:
    | AssistantTaskUpdateExecutionTarget
    | AssistantShoppingListUpdateExecutionTarget
    | AssistantShoppingItemUpdateExecutionTarget
    | AssistantPantryIngredientUpdateExecutionTarget
    | AssistantCalendarEventUpdateExecutionTarget
    | AssistantRecipeUpdateExecutionTarget;
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

export interface ShoppingListUpdatePayload {
  targetName: string;
  changes: {
    name: string | null;
    setName: boolean;
    store: string | null;
    setStore: boolean;
  };
}

export interface ShoppingItemUpdatePayload {
  listName: string;
  targetName: string;
  matchUnit: boolean;
  targetUnit: string | null;
  changes: {
    name: string | null;
    setName: boolean;
    quantity: number | null;
    setQuantity: boolean;
    unit: string | null;
    setUnit: boolean;
    category: string | null;
    setCategory: boolean;
  };
}

export interface PantryIngredientUpdatePayload {
  targetName: string;
  changes: {
    name: string | null;
    setName: boolean;
    category: string | null;
    setCategory: boolean;
    quantity: number | null;
    setQuantity: boolean;
    unit: PantryIngredientPayload['unit'] | null;
    setUnit: boolean;
    expirationDate: string | null;
    setExpirationDate: boolean;
    location: PantryIngredientPayload['location'] | null;
    setLocation: boolean;
    notes: string | null;
    setNotes: boolean;
  };
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
  priority: HouseholdTaskPriority;
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
    priority: HouseholdTaskPriority | null;
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
    priority: HouseholdTaskPriority;
    completed: boolean;
  };
}

export interface AssistantShoppingListUpdateExecutionTarget {
  kind: 'shopping-list';
  id: string;
  version: number;
  snapshot: { name: string; store: string | null };
}

export interface AssistantShoppingItemUpdateExecutionTarget {
  kind: 'shopping-item';
  id: string;
  listId: string;
  version: number;
  snapshot: {
    listName: string;
    name: string;
    productKey: string;
    quantity: number;
    unit: string | null;
    category: string | null;
    checked: boolean;
    deletedAt: string | null;
    updatedAt: string | null;
  };
}

export interface AssistantPantryIngredientUpdateExecutionTarget {
  kind: 'pantry-ingredient';
  id: string;
  snapshot: {
    name: string;
    category: string;
    quantity: number;
    unit: string;
    expirationDate: string | null;
    location: string | null;
    notes: string | null;
    updatedAt: string | null;
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

export interface CalendarEventUpdatePayload {
  targetTitle: string;
  targetDate: string;
  targetStartTime: string | null;
  changes: {
    title?: string;
    kind?: CalendarEventPayload['kind'];
    date?: string;
    startTime?: string | null;
    endTime?: string | null;
    allDay?: boolean;
    location?: string | null;
    notes?: string | null;
  };
}

export interface AssistantCalendarEventUpdateExecutionTarget {
  kind: 'calendar-event';
  id: string;
  householdId: string | null;
  updatedAt: string | null;
  snapshot: {
    title: string;
    kind: CalendarEventPayload['kind'];
    date: string;
    startTime: string | null;
    endTime: string | null;
    allDay: boolean;
    color: string | null;
    notes: string | null;
    location: string | null;
    recurrence: string;
    recurrenceRule: string | null;
    exceptions: string;
    source: string;
  };
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
  | AssistantActionCandidateBase<'pantry.update_ingredient', PantryIngredientUpdatePayload>
  | AssistantActionCandidateBase<'shopping.create_list', ShoppingListPayload>
  | AssistantActionCandidateBase<'shopping.update_list', ShoppingListUpdatePayload>
  | AssistantActionCandidateBase<'shopping.update_item', ShoppingItemUpdatePayload>
  | AssistantActionCandidateBase<'shopping.add_item', ShoppingItemPayload>
  | AssistantActionCandidateBase<'household.plan_meals', HouseholdMealPlanPayload>
  | AssistantActionCandidateBase<'household.create_task', HouseholdTaskPayload>
  | AssistantActionCandidateBase<'household.update_task', HouseholdTaskUpdatePayload>
  | AssistantActionCandidateBase<'calendar.create_event', CalendarEventPayload>
  | AssistantActionCandidateBase<'calendar.update_event', CalendarEventUpdatePayload>
  | AssistantActionCandidateBase<'recipes.update_content', AssistantRecipeUpdatePayload>
  | AssistantActionCandidateBase<'recipes.create_draft', { recipe: AIRecipeResponse }>;

export type AssistantAction =
  | (AssistantActionBase<
      'pantry.add_ingredient',
      'pantry',
      'add_ingredient',
      PantryIngredientPayload
    > & { dependsOn: string[] })
  | (AssistantActionBase<
      'pantry.update_ingredient',
      'pantry',
      'update_ingredient',
      PantryIngredientUpdatePayload
    > & {
      dependsOn: string[];
      executionTarget: AssistantPantryIngredientUpdateExecutionTarget;
    })
  | (AssistantActionBase<'shopping.create_list', 'shopping', 'create_list', ShoppingListPayload> & {
      dependsOn: string[];
    })
  | (AssistantActionBase<
      'shopping.update_list',
      'shopping',
      'update_list',
      ShoppingListUpdatePayload
    > & {
      dependsOn: string[];
      executionTarget: AssistantShoppingListUpdateExecutionTarget;
    })
  | (AssistantActionBase<
      'shopping.update_item',
      'shopping',
      'update_item',
      ShoppingItemUpdatePayload
    > & {
      dependsOn: string[];
      executionTarget: AssistantShoppingItemUpdateExecutionTarget;
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
    > & { dependsOn: string[] })
  | (AssistantActionBase<
      'calendar.update_event',
      'calendar',
      'update_event',
      CalendarEventUpdatePayload
    > & {
      dependsOn: string[];
      executionTarget: AssistantCalendarEventUpdateExecutionTarget;
    })
  | (AssistantActionBase<
      'recipes.update_content',
      'recipes',
      'update_content',
      AssistantRecipeUpdatePayload
    > & {
      dependsOn: string[];
      executionTarget: AssistantRecipeUpdateExecutionTarget;
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
