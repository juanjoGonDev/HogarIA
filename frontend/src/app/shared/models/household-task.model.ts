export interface HouseholdTaskOccurrence {
  id: string;
  title: string;
  details: string | null;
  spaceId: string | null;
  scheduledDate: string;
  assignedMemberId: string | null;
  completed: boolean;
}

export interface VersionedHouseholdTaskWeek {
  weekStart: string;
  version: number;
  tasks: HouseholdTaskOccurrence[];
}
