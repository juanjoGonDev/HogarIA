import { describe, expect, it } from 'vitest';
import { DEMO_DATABASE_PATH, assertDemoDatabaseSelection } from './demo-mode.js';

describe('demo database selection', () => {
  it('allows the canonical database only with the explicit demo mode', () => {
    expect(() =>
      assertDemoDatabaseSelection({
        mode: '1',
        databasePath: DEMO_DATABASE_PATH
      })
    ).not.toThrow();
  });

  it('rejects enabling demo mode with the normal database', () => {
    expect(() =>
      assertDemoDatabaseSelection({
        mode: '1',
        databasePath: './data/hogaria.sqlite'
      })
    ).toThrow(/demo database path/i);
  });

  it('rejects the demo database from normal server mode', () => {
    expect(() =>
      assertDemoDatabaseSelection({
        mode: undefined,
        databasePath: DEMO_DATABASE_PATH
      })
    ).toThrow(/requires HOGARIA_DEMO_MODE=1/i);
  });

  it('keeps the normal database valid when demo mode is off', () => {
    expect(() =>
      assertDemoDatabaseSelection({
        mode: undefined,
        databasePath: './data/hogaria.sqlite'
      })
    ).not.toThrow();
  });

  it('rejects ambiguous demo-mode values', () => {
    expect(() =>
      assertDemoDatabaseSelection({
        mode: 'true',
        databasePath: './data/hogaria.sqlite'
      })
    ).toThrow(/HOGARIA_DEMO_MODE/i);
  });
});
