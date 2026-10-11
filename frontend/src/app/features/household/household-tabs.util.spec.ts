import {
  householdTabQueryValue,
  isCanonicalHouseholdTabQuery,
  resolveHouseholdTab
} from './household-tabs.util';

describe('household tabs URL contract', () => {
  it('defaults to the household overview and rejects unknown tabs safely', () => {
    expect(resolveHouseholdTab(null)).toBe('home');
    expect(resolveHouseholdTab('not-a-tab')).toBe('home');
  });

  it('keeps all non-default tabs directly addressable and omits the default query', () => {
    expect(resolveHouseholdTab('members')).toBe('members');
    expect(resolveHouseholdTab('plan')).toBe('plan');
    expect(resolveHouseholdTab('tasks')).toBe('tasks');
    expect(resolveHouseholdTab('permissions')).toBe('permissions');
    expect(resolveHouseholdTab('settings')).toBe('settings');
    expect(householdTabQueryValue('home')).toBeNull();
    expect(householdTabQueryValue('settings')).toBe('settings');
    expect(householdTabQueryValue('plan')).toBe('plan');
    expect(householdTabQueryValue('tasks')).toBe('tasks');
  });

  it('recognizes only canonical query values for URL cleanup', () => {
    expect(isCanonicalHouseholdTabQuery(null)).toBeTrue();
    expect(isCanonicalHouseholdTabQuery('members')).toBeTrue();
    expect(isCanonicalHouseholdTabQuery('tasks')).toBeTrue();
    expect(isCanonicalHouseholdTabQuery('home')).toBeFalse();
    expect(isCanonicalHouseholdTabQuery('broken')).toBeFalse();
  });
});
