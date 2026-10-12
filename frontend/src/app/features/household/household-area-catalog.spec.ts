import { householdEn, householdEs } from '../../core/i18n/dict/household';
import {
  HOUSEHOLD_AREA_CATALOG,
  getHouseholdAreaGlyph,
  getHouseholdAreaLabel
} from './household-area-catalog';

describe('household area catalogue', () => {
  it('includes the supported interior, outdoor, shared and custom spaces', () => {
    const areas = Object.values(HOUSEHOLD_AREA_CATALOG).flat();
    const kinds = areas.map((area) => area.kind);

    expect(kinds).toContain('garden');
    expect(kinds).toContain('balcony');
    expect(kinds).toContain('terrace');
    expect(kinds).toContain('pool');
    expect(kinds).toContain('garage');
    expect(kinds).toContain('outdoor_kitchen');
    expect(kinds).toContain('custom');
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('provides non-empty Spanish and English labels for every stable kind', () => {
    const areas = Object.values(HOUSEHOLD_AREA_CATALOG).flat();
    for (const area of areas) {
      expect(householdEs[area.labelKey].trim()).not.toBe('');
      expect(householdEn[area.labelKey].trim()).not.toBe('');
      expect(getHouseholdAreaLabel(area.kind, 'es')).toBe(householdEs[area.labelKey]);
      expect(getHouseholdAreaLabel(area.kind, 'en')).toBe(householdEn[area.labelKey]);
    }
  });

  it('uses recognizable plan glyphs for key rooms and outdoor spaces', () => {
    expect(getHouseholdAreaGlyph('kitchen')).toBe('kitchen');
    expect(getHouseholdAreaGlyph('dining_room')).toBe('seating');
    expect(getHouseholdAreaGlyph('bedroom')).toBe('bedroom');
    expect(getHouseholdAreaGlyph('bathroom')).toBe('bathroom');
    expect(getHouseholdAreaGlyph('garden')).toBe('outdoors');
    expect(getHouseholdAreaGlyph('garage')).toBe('vehicle');
    expect(getHouseholdAreaGlyph('custom')).toBe('generic');
  });
});
