import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isolatedHouseholdPlanningSchedulerOptions } from './household-planning-automation.scheduler.runtime.js';

const runDir = mkdtempSync(join(tmpdir(), 'hogaria-e2e-runtime-test-'));
const databasePath = join(runDir, 'hogaria.sqlite');
writeFileSync(databasePath, '');

const isolatedEnvironment = {
  NODE_ENV: 'test',
  E2E_STACK: 'dev',
  E2E_EXTERNAL_STACK: '1',
  E2E_RUN_DIR: runDir,
  DATABASE_PATH: databasePath
};

afterAll(() => {
  rmSync(runDir, { recursive: true, force: false });
});

describe('isolated household automation scheduler controls', () => {
  it('does not enable test controls in production, full-stack, or non-isolated runs', () => {
    const requestedControls = {
      ...isolatedEnvironment,
      HOGARIA_E2E_AUTOMATION_POLL_INTERVAL_MS: '1000',
      HOGARIA_E2E_AUTOMATION_CLOCK_OFFSET_DAYS: '8'
    };

    expect(
      isolatedHouseholdPlanningSchedulerOptions({ ...requestedControls, NODE_ENV: 'production' })
    ).toEqual({});
    expect(
      isolatedHouseholdPlanningSchedulerOptions({ ...requestedControls, E2E_STACK: 'full-stack' })
    ).toEqual({});
    expect(
      isolatedHouseholdPlanningSchedulerOptions({ ...requestedControls, E2E_EXTERNAL_STACK: '0' })
    ).toEqual({});
  });

  it('leaves the production cadence and real clock unchanged when controls are absent', () => {
    expect(isolatedHouseholdPlanningSchedulerOptions(isolatedEnvironment)).toEqual({});
  });

  it('does not enable clock controls unless the runner supplies its temporary SQLite database', () => {
    const requestedControls = {
      ...isolatedEnvironment,
      HOGARIA_E2E_AUTOMATION_POLL_INTERVAL_MS: '1000',
      HOGARIA_E2E_AUTOMATION_CLOCK_OFFSET_DAYS: '4'
    };

    expect(
      isolatedHouseholdPlanningSchedulerOptions({
        ...requestedControls,
        E2E_RUN_DIR: undefined,
        DATABASE_PATH: undefined
      })
    ).toEqual({});
    expect(
      isolatedHouseholdPlanningSchedulerOptions({
        ...requestedControls,
        DATABASE_PATH: join(tmpdir(), 'hogaria.sqlite')
      })
    ).toEqual({});
  });

  it('uses a bounded poll interval and deterministic clock offset only in isolated dev E2E', () => {
    const before = Date.now();
    const options = isolatedHouseholdPlanningSchedulerOptions({
      ...isolatedEnvironment,
      HOGARIA_E2E_AUTOMATION_POLL_INTERVAL_MS: '1000',
      HOGARIA_E2E_AUTOMATION_CLOCK_OFFSET_DAYS: '8'
    });

    expect(options.intervalMs).toBe(1_000);
    expect(options.clock).toBeTypeOf('function');
    expect(options.clock!().getTime()).toBeGreaterThanOrEqual(before + 8 * 86_400_000);
    expect(options.clock!().getTime()).toBeLessThanOrEqual(Date.now() + 8 * 86_400_000);
  });

  it('records poll ticks to the isolated runner directory without exposing household data', () => {
    const options = isolatedHouseholdPlanningSchedulerOptions({
      ...isolatedEnvironment,
      HOGARIA_E2E_AUTOMATION_POLL_INTERVAL_MS: '1000',
      HOGARIA_E2E_AUTOMATION_CLOCK_OFFSET_DAYS: '4'
    });
    const onPoll = Reflect.get(options, 'onPoll') as (() => void) | undefined;

    expect(onPoll).toBeTypeOf('function');
    onPoll?.();
    onPoll?.();
    expect(readFileSync(join(runDir, 'planning-automation-polls.log'), 'utf8')).toBe(
      'poll\npoll\n'
    );
  });

  it.each([
    ['HOGARIA_E2E_AUTOMATION_POLL_INTERVAL_MS', '999'],
    ['HOGARIA_E2E_AUTOMATION_POLL_INTERVAL_MS', '10001'],
    ['HOGARIA_E2E_AUTOMATION_POLL_INTERVAL_MS', '1s'],
    ['HOGARIA_E2E_AUTOMATION_CLOCK_OFFSET_DAYS', '0'],
    ['HOGARIA_E2E_AUTOMATION_CLOCK_OFFSET_DAYS', '15'],
    ['HOGARIA_E2E_AUTOMATION_CLOCK_OFFSET_DAYS', 'eight']
  ])('rejects invalid isolated test value %s=%s', (name, value) => {
    expect(() =>
      isolatedHouseholdPlanningSchedulerOptions({ ...isolatedEnvironment, [name]: value })
    ).toThrow(RangeError);
  });
});
