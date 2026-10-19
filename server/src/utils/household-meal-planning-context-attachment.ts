import type { MealTypeKey } from '../schemas/household-meal-planning.schema.js';
import type { AiMessagePart } from './ai-client.js';
import type {
  MealPlanningObjective,
  MealPlanningSchedule
} from './household-meal-planning.store.js';

export const HOUSEHOLD_MEAL_PLANNING_CONTEXT_FILENAME = 'meal-planning-context.json';

type EffectiveSource = 'household' | 'member';

export interface MealPlanningContextAttachmentInput {
  targetWeek: {
    startDate: string;
    endDate: string;
  };
  household: {
    objective: MealPlanningObjective | null;
    schedule: MealPlanningSchedule | null;
  };
  participants: Array<{
    alias: string;
    preferences: {
      strictAllergies: string[];
      likes: string[];
      dislikes: string[];
    };
    effectiveObjective: MealPlanningObjective & { source: EffectiveSource };
    effectiveSchedule: MealPlanningSchedule & { source: EffectiveSource };
  }>;
  requiredTurns: Array<{
    date: string;
    mealType: MealTypeKey;
    time: string;
    eligibleParticipants: string[];
  }>;
  pantry: Array<{
    name: string;
    quantity: number;
    unit: string;
    expirationDate: string | null;
  }>;
  utensils: Array<{
    name: string;
    category: string | null;
  }>;
  previousConfirmedPlan: {
    weekStart: string;
    weekEnd: string;
    events: Array<{
      date: string;
      mealType: MealTypeKey;
      time: string;
      servings: number;
      participants: string[];
      recipeName: string | null;
    }>;
  } | null;
}

export type SerializedMealPlanningContext = MealPlanningContextAttachmentInput & {
  version: 2;
};

export type MealPlanningContextFilePart = Extract<AiMessagePart, { type: 'file' }>;

export function createMealPlanningContextFilePart(
  context: MealPlanningContextAttachmentInput
): MealPlanningContextFilePart {
  const serializedContext: SerializedMealPlanningContext = {
    version: 2,
    ...context
  };
  const fileData = Buffer.from(JSON.stringify(serializedContext), 'utf8').toString('base64');

  return {
    type: 'file',
    file: {
      filename: HOUSEHOLD_MEAL_PLANNING_CONTEXT_FILENAME,
      file_data: `data:application/json;base64,${fileData}`
    }
  };
}
