export const HOUSEHOLD_TABS = [
  'home',
  'plan',
  'tasks',
  'members',
  'permissions',
  'settings'
] as const;
export type HouseholdTab = (typeof HOUSEHOLD_TABS)[number];

export function resolveHouseholdTab(value: string | null | undefined): HouseholdTab {
  return HOUSEHOLD_TABS.includes(value as HouseholdTab) ? (value as HouseholdTab) : 'home';
}

export function householdTabQueryValue(tab: HouseholdTab): string | null {
  return tab === 'home' ? null : tab;
}

export function isCanonicalHouseholdTabQuery(value: string | null): boolean {
  return value === null || (HOUSEHOLD_TABS.includes(value as HouseholdTab) && value !== 'home');
}
