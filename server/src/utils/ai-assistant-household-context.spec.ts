import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_HOUSEHOLD_HEADER,
  assistantHouseholdContextMatches
} from './ai-assistant-household-context.js';

describe('assistant household context header', () => {
  it('uses a dedicated, non-empty header name that domain middleware can distinguish from ordinary requests', () => {
    expect(ASSISTANT_HOUSEHOLD_HEADER).toBe('x-assistant-household-id');
  });

  it('accepts an unchanged household snapshot and the explicit personal-mode snapshot only', () => {
    expect(assistantHouseholdContextMatches('home-1', 'home-1')).toBe(true);
    expect(assistantHouseholdContextMatches('', null)).toBe(true);
    expect(assistantHouseholdContextMatches('home-1', 'home-2')).toBe(false);
    expect(assistantHouseholdContextMatches('', 'home-1')).toBe(false);
    expect(assistantHouseholdContextMatches('home-1', null)).toBe(false);
  });
});
