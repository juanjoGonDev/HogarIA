export const HOUSEHOLD_AREA_KINDS = [
  'entrance',
  'foyer',
  'living_room',
  'dining_room',
  'kitchen',
  'pantry',
  'bedroom',
  'primary_bedroom',
  'guest_bedroom',
  'bathroom',
  'toilet',
  'laundry_room',
  'home_office',
  'studio_room',
  'library',
  'playroom',
  'gym',
  'walk_in_closet',
  'hallway',
  'staircase',
  'landing',
  'elevator',
  'storage_room',
  'basement',
  'wine_cellar',
  'attic',
  'garage',
  'parking_space',
  'utility_room',
  'workshop',
  'sunroom',
  'garden',
  'vegetable_garden',
  'plot',
  'balcony',
  'terrace',
  'patio',
  'courtyard',
  'porch',
  'veranda',
  'gallery',
  'roof_terrace',
  'solarium',
  'pool',
  'outdoor_kitchen',
  'shed',
  'greenhouse',
  'driveway',
  'outdoor_parking',
  'path',
  'pet_area',
  'sports_area',
  'common_area',
  'shared_room',
  'storage_area',
  'custom'
] as const;

export type HouseholdAreaKind = (typeof HOUSEHOLD_AREA_KINDS)[number];

export const HOUSEHOLD_DWELLING_TYPES = [
  'apartment',
  'studio',
  'detached_house',
  'semi_detached_house',
  'terraced_house',
  'townhouse',
  'duplex',
  'shared_home',
  'mobile_home',
  'other'
] as const;

export type HouseholdDwellingType = (typeof HOUSEHOLD_DWELLING_TYPES)[number];

export interface HouseholdPlanPoint {
  x: number;
  y: number;
}

export interface HouseholdPlanWall {
  id: string;
  kind: 'interior' | 'exterior';
  from: HouseholdPlanPoint;
  to: HouseholdPlanPoint;
}

export interface HouseholdPlanOpening {
  id: string;
  wallId: string;
  kind: 'door' | 'window' | 'garage_door';
  offset: number;
  width: number;
  isMainEntrance: boolean;
}

export interface HouseholdPlanSpace {
  id: string;
  kind: HouseholdAreaKind;
  label: string;
  polygon: HouseholdPlanPoint[];
  parentSpaceId: string | null;
}

export interface HouseholdPlanFloor {
  id: string;
  name: string;
  level: number;
  walls: HouseholdPlanWall[];
  openings: HouseholdPlanOpening[];
  spaces: HouseholdPlanSpace[];
}

export interface HouseholdPlan {
  schemaVersion: 1;
  dwellingType: HouseholdDwellingType;
  dwellingTypeLabel: string | null;
  summary: string;
  warnings: string[];
  floors: HouseholdPlanFloor[];
}

export interface VersionedHouseholdPlan {
  version: number;
  plan: HouseholdPlan | null;
}

export interface VersionedHouseholdPlanAssignments {
  planVersion: number;
  version: number;
  assignments: Record<string, string[]>;
}

export interface HouseholdPlanProposalDiff {
  addedSpaceIds: string[];
  modifiedSpaceIds: string[];
  removedSpaceIds: string[];
}

export interface HouseholdPlanProposal {
  baseVersion: number;
  current: HouseholdPlan | null;
  draft: HouseholdPlan | null;
  proposal: HouseholdPlan;
  diff: HouseholdPlanProposalDiff;
  orphanedTaskIds: string[];
}
