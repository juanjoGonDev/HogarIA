import { appendFileSync, lstatSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { HouseholdPlanningAutomationSchedulerOptions } from './household-planning-automation.scheduler.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const E2E_POLL_INTERVAL_ENV = 'HOGARIA_E2E_AUTOMATION_POLL_INTERVAL_MS';
const E2E_CLOCK_OFFSET_ENV = 'HOGARIA_E2E_AUTOMATION_CLOCK_OFFSET_DAYS';

/** Test-only scheduler controls; production and non-isolated servers always use the real clock. */
export function isolatedHouseholdPlanningSchedulerOptions(
  environment: Readonly<Record<string, string | undefined>>
): Pick<HouseholdPlanningAutomationSchedulerOptions, 'intervalMs' | 'clock' | 'onPoll'> {
  if (
    environment.NODE_ENV === 'production' ||
    environment.E2E_STACK !== 'dev' ||
    environment.E2E_EXTERNAL_STACK !== '1' ||
    !hasIsolatedRunnerDatabase(environment)
  ) {
    return {};
  }

  const intervalMs = boundedInteger(
    environment[E2E_POLL_INTERVAL_ENV],
    E2E_POLL_INTERVAL_ENV,
    1_000,
    10_000
  );
  const clockOffsetDays = boundedInteger(
    environment[E2E_CLOCK_OFFSET_ENV],
    E2E_CLOCK_OFFSET_ENV,
    1,
    14
  );

  return {
    ...(intervalMs === null ? {} : { intervalMs }),
    ...(clockOffsetDays === null
      ? {}
      : { clock: () => new Date(Date.now() + clockOffsetDays * DAY_MS) }),
    ...(intervalMs === null || clockOffsetDays === null
      ? {}
      : {
          onPoll: () => {
            try {
              appendFileSync(
                join(resolve(environment.E2E_RUN_DIR!), 'planning-automation-polls.log'),
                'poll\n'
              );
            } catch {
              // Test diagnostics must never prevent scheduled processing.
            }
          }
        })
  };
}

function hasIsolatedRunnerDatabase(
  environment: Readonly<Record<string, string | undefined>>
): boolean {
  const runDir = environment.E2E_RUN_DIR;
  const databasePath = environment.DATABASE_PATH;
  if (!runDir || !databasePath || !isAbsolute(runDir) || !isAbsolute(databasePath)) return false;

  try {
    const realTempRoot = realpathSync(tmpdir());
    const runDirStats = lstatSync(runDir);
    if (!runDirStats.isDirectory() || runDirStats.isSymbolicLink()) return false;

    const realRunDir = realpathSync(runDir);
    const relativeRunDir = relative(realTempRoot, realRunDir);
    if (
      relativeRunDir === '' ||
      relativeRunDir === '..' ||
      relativeRunDir.startsWith(`..${sep}`) ||
      isAbsolute(relativeRunDir) ||
      !basename(realRunDir).startsWith('hogaria-e2e-')
    ) {
      return false;
    }

    const expectedDatabasePath = join(realRunDir, 'hogaria.sqlite');
    if (resolve(databasePath) !== expectedDatabasePath) return false;
    const databaseStats = lstatSync(expectedDatabasePath);
    return databaseStats.isFile() && !databaseStats.isSymbolicLink();
  } catch {
    return false;
  }
}

function boundedInteger(
  value: string | undefined,
  name: string,
  min: number,
  max: number
): number | null {
  if (value === undefined) return null;
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new RangeError(`${name} must be an integer from ${min} through ${max}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new RangeError(`${name} must be an integer from ${min} through ${max}`);
  }
  return parsed;
}
