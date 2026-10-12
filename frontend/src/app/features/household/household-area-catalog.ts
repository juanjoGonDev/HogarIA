import { householdEn, householdEs } from '../../core/i18n/dict/household';
import type { HouseholdAreaKind } from '../../shared/models/household-plan.model';

const interior = [
  { kind: 'entrance', labelKey: 'household.area_entrance' },
  { kind: 'foyer', labelKey: 'household.area_foyer' },
  { kind: 'living_room', labelKey: 'household.area_living_room' },
  { kind: 'dining_room', labelKey: 'household.area_dining_room' },
  { kind: 'kitchen', labelKey: 'household.area_kitchen' },
  { kind: 'pantry', labelKey: 'household.area_pantry' },
  { kind: 'bedroom', labelKey: 'household.area_bedroom' },
  { kind: 'primary_bedroom', labelKey: 'household.area_primary_bedroom' },
  { kind: 'guest_bedroom', labelKey: 'household.area_guest_bedroom' },
  { kind: 'bathroom', labelKey: 'household.area_bathroom' },
  { kind: 'toilet', labelKey: 'household.area_toilet' },
  { kind: 'laundry_room', labelKey: 'household.area_laundry_room' },
  { kind: 'home_office', labelKey: 'household.area_home_office' },
  { kind: 'studio_room', labelKey: 'household.area_studio_room' },
  { kind: 'library', labelKey: 'household.area_library' },
  { kind: 'playroom', labelKey: 'household.area_playroom' },
  { kind: 'gym', labelKey: 'household.area_gym' },
  { kind: 'walk_in_closet', labelKey: 'household.area_walk_in_closet' },
  { kind: 'hallway', labelKey: 'household.area_hallway' },
  { kind: 'staircase', labelKey: 'household.area_staircase' },
  { kind: 'landing', labelKey: 'household.area_landing' },
  { kind: 'elevator', labelKey: 'household.area_elevator' },
  { kind: 'storage_room', labelKey: 'household.area_storage_room' },
  { kind: 'basement', labelKey: 'household.area_basement' },
  { kind: 'wine_cellar', labelKey: 'household.area_wine_cellar' },
  { kind: 'attic', labelKey: 'household.area_attic' },
  { kind: 'garage', labelKey: 'household.area_garage' },
  { kind: 'parking_space', labelKey: 'household.area_parking_space' },
  { kind: 'utility_room', labelKey: 'household.area_utility_room' },
  { kind: 'workshop', labelKey: 'household.area_workshop' },
  { kind: 'sunroom', labelKey: 'household.area_sunroom' }
] as const;

const exterior = [
  { kind: 'garden', labelKey: 'household.area_garden' },
  { kind: 'vegetable_garden', labelKey: 'household.area_vegetable_garden' },
  { kind: 'plot', labelKey: 'household.area_plot' },
  { kind: 'balcony', labelKey: 'household.area_balcony' },
  { kind: 'terrace', labelKey: 'household.area_terrace' },
  { kind: 'patio', labelKey: 'household.area_patio' },
  { kind: 'courtyard', labelKey: 'household.area_courtyard' },
  { kind: 'porch', labelKey: 'household.area_porch' },
  { kind: 'veranda', labelKey: 'household.area_veranda' },
  { kind: 'gallery', labelKey: 'household.area_gallery' },
  { kind: 'roof_terrace', labelKey: 'household.area_roof_terrace' },
  { kind: 'solarium', labelKey: 'household.area_solarium' },
  { kind: 'pool', labelKey: 'household.area_pool' },
  { kind: 'outdoor_kitchen', labelKey: 'household.area_outdoor_kitchen' },
  { kind: 'shed', labelKey: 'household.area_shed' },
  { kind: 'greenhouse', labelKey: 'household.area_greenhouse' },
  { kind: 'driveway', labelKey: 'household.area_driveway' },
  { kind: 'outdoor_parking', labelKey: 'household.area_outdoor_parking' },
  { kind: 'path', labelKey: 'household.area_path' },
  { kind: 'pet_area', labelKey: 'household.area_pet_area' },
  { kind: 'sports_area', labelKey: 'household.area_sports_area' }
] as const;

const shared = [
  { kind: 'common_area', labelKey: 'household.area_common_area' },
  { kind: 'shared_room', labelKey: 'household.area_shared_room' },
  { kind: 'storage_area', labelKey: 'household.area_storage_area' },
  { kind: 'custom', labelKey: 'household.area_custom' }
] as const;

export const HOUSEHOLD_AREA_CATALOG = { interior, exterior, shared } as const;
export type HouseholdAreaGroup = keyof typeof HOUSEHOLD_AREA_CATALOG;
export type { HouseholdAreaKind } from '../../shared/models/household-plan.model';
export type HouseholdAreaGlyph =
  | 'kitchen'
  | 'seating'
  | 'bedroom'
  | 'bathroom'
  | 'outdoors'
  | 'entry'
  | 'work'
  | 'vehicle'
  | 'storage'
  | 'shared'
  | 'generic';

const glyphByArea: Record<HouseholdAreaKind, HouseholdAreaGlyph> = {
  entrance: 'entry',
  foyer: 'entry',
  living_room: 'seating',
  dining_room: 'seating',
  kitchen: 'kitchen',
  pantry: 'storage',
  bedroom: 'bedroom',
  primary_bedroom: 'bedroom',
  guest_bedroom: 'bedroom',
  bathroom: 'bathroom',
  toilet: 'bathroom',
  laundry_room: 'storage',
  home_office: 'work',
  studio_room: 'work',
  library: 'storage',
  playroom: 'seating',
  gym: 'work',
  walk_in_closet: 'storage',
  hallway: 'entry',
  staircase: 'entry',
  landing: 'entry',
  elevator: 'entry',
  storage_room: 'storage',
  basement: 'storage',
  wine_cellar: 'storage',
  attic: 'storage',
  garage: 'vehicle',
  parking_space: 'vehicle',
  utility_room: 'storage',
  workshop: 'work',
  sunroom: 'seating',
  garden: 'outdoors',
  vegetable_garden: 'outdoors',
  plot: 'outdoors',
  balcony: 'outdoors',
  terrace: 'outdoors',
  patio: 'outdoors',
  courtyard: 'outdoors',
  porch: 'outdoors',
  veranda: 'outdoors',
  gallery: 'outdoors',
  roof_terrace: 'outdoors',
  solarium: 'outdoors',
  pool: 'outdoors',
  outdoor_kitchen: 'kitchen',
  shed: 'storage',
  greenhouse: 'outdoors',
  driveway: 'vehicle',
  outdoor_parking: 'vehicle',
  path: 'entry',
  pet_area: 'outdoors',
  sports_area: 'work',
  common_area: 'shared',
  shared_room: 'shared',
  storage_area: 'storage',
  custom: 'generic'
};

export function getHouseholdAreaGlyph(kind: HouseholdAreaKind): HouseholdAreaGlyph {
  return glyphByArea[kind];
}

type HouseholdAreaLabelKey =
  (typeof HOUSEHOLD_AREA_CATALOG)[HouseholdAreaGroup][number]['labelKey'];

const areaLabelKeys = Object.fromEntries(
  Object.values(HOUSEHOLD_AREA_CATALOG)
    .flat()
    .map((area) => [area.kind, area.labelKey])
) as Record<HouseholdAreaKind, HouseholdAreaLabelKey>;

const groupLabelKeys: Record<HouseholdAreaGroup, keyof typeof householdEs> = {
  interior: 'household.area_group_interior',
  exterior: 'household.area_group_exterior',
  shared: 'household.area_group_shared'
};

export function getHouseholdAreaLabel(kind: HouseholdAreaKind, language: 'es' | 'en'): string {
  const key = areaLabelKeys[kind];
  return language === 'en' ? householdEn[key] : householdEs[key];
}

export function getHouseholdAreaGroupLabel(
  group: HouseholdAreaGroup,
  language: 'es' | 'en'
): string {
  const key = groupLabelKeys[group];
  return language === 'en' ? householdEn[key] : householdEs[key];
}
