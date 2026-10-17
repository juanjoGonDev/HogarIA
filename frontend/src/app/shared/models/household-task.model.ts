export const HOUSEHOLD_TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export type HouseholdTaskPriority = (typeof HOUSEHOLD_TASK_PRIORITIES)[number];

export interface HouseholdTaskOccurrence {
  id: string;
  title: string;
  details: string | null;
  spaceId: string | null;
  scheduledDate: string;
  assignedMemberId: string | null;
  priority: HouseholdTaskPriority;
  completed: boolean;
}

export interface VersionedHouseholdTaskWeek {
  weekStart: string;
  version: number;
  tasks: HouseholdTaskOccurrence[];
}
