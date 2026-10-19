import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nextHouseholdWeeklyOccurrence } from './household-weekly-schedule.js';
import type { HouseholdWeeklySchedule } from './household-weekly-schedule.js';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type Ledger = typeof import('./household-planning-automation-runs.store.js');
const schedule: HouseholdWeeklySchedule = {
  weekday: 1,
  localTime: '09:30',
  timeZone: 'Europe/Madrid'
};
const config = { mode: 'generate' as const, scopes: ['meals', 'tasks'] as const };

let db: Sql;
let closeDatabase: () => void;
let ledger: Ledger;

function makeHousehold(id = 'home-a') {
  db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
    id,
    id,
    `INVITE-${id}`
  );
}

function makeMember(id = 'owner', householdId = 'home-a') {
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, `${id}@hogaria.test`, id, 'synthetic-hash', householdId);
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, permissions)
     VALUES (?, ?, ?, 'member', ?)`
  ).run(
    `${id}-membership`,
    householdId,
    id,
    JSON.stringify({ settings: true, calendar: { edit: true } })
  );
}

async function enableAutomation(expectedVersion = 0) {
  const store = await import('./household-planning-automation.store.js');
  store.saveHouseholdPlanningAutomation(
    db,
    'home-a',
    'owner',
    {
      expectedVersion,
      ...config,
      scopes: [...config.scopes],
      weekday: schedule.weekday,
      localTime: schedule.localTime,
      timeZone: schedule.timeZone
    },
    new Date('2026-10-11T10:00:00.000Z')
  );
  return store.saveHouseholdPlanningAutomation(
    db,
    'home-a',
    'owner',
    { expectedVersion: expectedVersion + 1, enabled: true },
    new Date('2026-10-11T10:00:00.000Z')
  ).snapshot;
}

function makeOccurrence(weeklySchedule: HouseholdWeeklySchedule = schedule) {
  return nextHouseholdWeeklyOccurrence(weeklySchedule, new Date('2026-10-11T10:00:00.000Z'));
}

function claimInput(overrides: Record<string, unknown> = {}) {
  const occurrence = makeOccurrence();
  return {
    householdId: 'home-a',
    expectedConfigVersion: 2,
    mode: config.mode,
    scopes: [...config.scopes],
    schedule,
    occurrence,
    targetWeekStart: '2026-10-19',
    workerId: 'worker-1',
    leaseMs: 30_000,
    now: new Date(occurrence.utcInstant),
    ...overrides
  };
}

function mustClaim(input: ReturnType<typeof claimInput> = claimInput()) {
  const result = ledger.claimHouseholdPlanningAutomationOccurrence(db, input as never);
  if (result.outcome !== 'claimed' || !result.run) throw new Error('Expected a claimed test run');
  return { outcome: 'claimed' as const, run: result.run };
}

describe('household planning automation run ledger', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    ledger = await import('./household-planning-automation-runs.store.js');
    await database.initializeDatabase();
    db = database.getDatabase();
    closeDatabase = database.closeDatabase;
  });

  afterAll(() => closeDatabase());

  beforeEach(() => {
    db.prepare('DELETE FROM household_planning_automation_runs').run();
    db.prepare('DELETE FROM household_planning_automations').run();
    db.prepare('UPDATE users SET household_id = NULL').run();
    db.prepare('DELETE FROM household_members').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM households').run();
    makeHousehold();
    makeMember();
  });

  it('claims an occurrence once, snapshots only safe configuration metadata, and fences another worker', async () => {
    await enableAutomation();
    const first = mustClaim();
    const duplicate = ledger.claimHouseholdPlanningAutomationOccurrence(
      db,
      claimInput({ workerId: 'worker-2', now: new Date('2026-10-12T07:30:01.000Z') })
    );

    expect(first.outcome).toBe('claimed');
    expect(first.run).toMatchObject({
      householdId: 'home-a',
      occurrenceKey: first.run.occurrenceKey,
      configVersion: 2,
      mode: 'generate',
      scopes: ['meals', 'tasks'],
      targetWeekStart: '2026-10-19',
      status: 'in_progress',
      fence: 1
    });
    expect(duplicate).toMatchObject({ outcome: 'busy', run: { id: first.run.id, fence: 1 } });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM household_planning_automation_runs').get()
    ).toEqual({
      count: 1
    });
    const columns = db
      .prepare('PRAGMA table_info(household_planning_automation_runs)')
      .all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).not.toContain('prompt');
    expect(columns.map(({ name }) => name)).not.toContain('provider_response');
    expect(() =>
      db
        .prepare('UPDATE household_planning_automation_runs SET target_week_start = ? WHERE id = ?')
        .run('2026-10-26', first.run.id)
    ).toThrow('automation occurrence snapshot is immutable');
  });

  it('reads the latest household run as a validated snapshot and returns null when empty', async () => {
    expect(ledger.readLatestHouseholdPlanningAutomationRun(db, 'home-a')).toBeNull();
    await enableAutomation();
    const first = mustClaim();
    const nextOccurrence = nextHouseholdWeeklyOccurrence(schedule, new Date(first.run.scheduledAt));
    const next = mustClaim(
      claimInput({
        occurrence: nextOccurrence,
        targetWeekStart: '2026-10-26',
        now: new Date(nextOccurrence.utcInstant)
      }) as ReturnType<typeof claimInput>
    );

    expect(ledger.readLatestHouseholdPlanningAutomationRun(db, 'home-a')).toMatchObject({
      id: next.run.id,
      occurrenceKey: next.run.occurrenceKey,
      scheduledAt: nextOccurrence.utcInstant,
      status: 'in_progress'
    });
    expect(ledger.readLatestHouseholdPlanningAutomationRun(db, 'other-home')).toBeNull();
  });

  it('marks an expired in-progress lease for review instead of reclaiming or retrying it', async () => {
    await enableAutomation();
    const first = mustClaim(claimInput({ leaseMs: 1_000 }));

    const expired = ledger.claimHouseholdPlanningAutomationOccurrence(
      db,
      claimInput({
        workerId: 'worker-2',
        leaseMs: 1_000,
        now: new Date(Date.parse(first.run.leaseExpiresAt!) + 1)
      })
    );

    expect(expired).toMatchObject({
      outcome: 'review_required',
      run: { id: first.run.id, status: 'review_required', failureCode: 'LEASE_EXPIRED_AMBIGUOUS' }
    });
    expect(expired.run!.fence).toBe(first.run.fence);
  });

  it('completes idempotently and rejects stale owner/fence tokens', async () => {
    await enableAutomation();
    const claim = mustClaim();

    expect(
      ledger.completeHouseholdPlanningAutomationRun(
        db,
        {
          runId: claim.run.id,
          workerId: 'worker-other',
          fence: claim.run.fence,
          now: new Date(Date.parse(claim.run.leaseExpiresAt!) - 1)
        },
        () => {}
      )
    ).toMatchObject({ outcome: 'stale_lease', run: { status: 'in_progress' } });

    const completed = ledger.completeHouseholdPlanningAutomationRun(
      db,
      {
        runId: claim.run.id,
        workerId: 'worker-1',
        fence: claim.run.fence,
        now: new Date(Date.parse(claim.run.leaseExpiresAt!) - 1)
      },
      () => {}
    );
    const repeated = ledger.completeHouseholdPlanningAutomationRun(
      db,
      {
        runId: claim.run.id,
        workerId: 'worker-1',
        fence: claim.run.fence,
        now: new Date(claim.run.leaseExpiresAt!)
      },
      () => {}
    );

    expect(completed).toMatchObject({ outcome: 'completed', run: { status: 'completed' } });
    expect(repeated).toMatchObject({ outcome: 'already_completed', run: { status: 'completed' } });
    expect(
      ledger.claimHouseholdPlanningAutomationOccurrence(db, claimInput({ workerId: 'worker-3' }))
    ).toMatchObject({ outcome: 'already_completed', run: { id: claim.run.id } });
  });

  it('records only allowlisted failure codes and moves a failed claim to review', async () => {
    await enableAutomation();
    const claim = mustClaim();

    expect(
      ledger.failHouseholdPlanningAutomationRun(db, {
        runId: claim.run.id,
        workerId: 'worker-1',
        fence: claim.run.fence,
        failureCode: 'PROVIDER_TIMEOUT_AMBIGUOUS',
        now: new Date(Date.parse(claim.run.leaseExpiresAt!) - 1)
      })
    ).toMatchObject({
      outcome: 'review_required',
      run: { failureCode: 'PROVIDER_TIMEOUT_AMBIGUOUS', status: 'review_required' }
    });

    expect(() =>
      ledger.failHouseholdPlanningAutomationRun(db, {
        runId: claim.run.id,
        workerId: 'worker-1',
        fence: claim.run.fence,
        failureCode: 'provider returned private prompt and token' as never,
        now: new Date()
      })
    ).toThrowError(expect.objectContaining({ code: 'AUTOMATION_FAILURE_CODE_INVALID' }));
    expect(
      (
        db
          .prepare('SELECT failure_code FROM household_planning_automation_runs WHERE id = ?')
          .get(claim.run.id) as { failure_code: string }
      ).failure_code
    ).toBe('PROVIDER_TIMEOUT_AMBIGUOUS');
  });

  it('requires an explicit authorized retry and fences the same occurrence with a new token', async () => {
    await enableAutomation();
    makeMember('retriager');
    const claim = mustClaim();
    const failure = ledger.failHouseholdPlanningAutomationRun(db, {
      runId: claim.run.id,
      workerId: 'worker-1',
      fence: claim.run.fence,
      failureCode: 'PROVIDER_TIMEOUT_AMBIGUOUS',
      now: new Date(Date.parse(claim.run.leaseExpiresAt!) - 1)
    });
    expect(failure.outcome).toBe('review_required');

    const retried = ledger.retryHouseholdPlanningAutomationRun(db, {
      householdId: 'home-a',
      occurrenceKey: claim.run.occurrenceKey,
      expectedConfigVersion: 2,
      requestedBy: 'retriager',
      workerId: 'worker-retry',
      leaseMs: 30_000,
      now: new Date('2026-10-12T07:30:30.000Z')
    });
    expect(retried).toMatchObject({
      outcome: 'claimed',
      run: {
        id: claim.run.id,
        occurrenceKey: claim.run.occurrenceKey,
        status: 'in_progress',
        fence: 2,
        failureCode: null,
        leaseExpiresAt: '2026-10-12T07:31:00.000Z'
      }
    });
    expect(
      ledger.completeHouseholdPlanningAutomationRun(
        db,
        {
          runId: claim.run.id,
          workerId: 'worker-1',
          fence: claim.run.fence,
          now: new Date('2026-10-12T07:30:31.000Z')
        },
        () => {}
      )
    ).toMatchObject({ outcome: 'stale_lease', run: { fence: 2, status: 'in_progress' } });
    expect(
      ledger.retryHouseholdPlanningAutomationRun(db, {
        householdId: 'home-a',
        occurrenceKey: claim.run.occurrenceKey,
        expectedConfigVersion: 2,
        requestedBy: 'retriager',
        workerId: 'worker-second-retry',
        leaseMs: 30_000,
        now: new Date('2026-10-12T07:30:31.000Z')
      })
    ).toMatchObject({ outcome: 'busy', run: { id: claim.run.id, fence: 2 } });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM household_planning_automation_runs').get()
    ).toEqual({ count: 1 });
  });

  it('does not retry without settings and calendar edit authorization', async () => {
    await enableAutomation();
    makeMember('limited');
    db.prepare('UPDATE household_members SET permissions = ? WHERE user_id = ?').run(
      JSON.stringify({ settings: true, calendar: { edit: false } }),
      'limited'
    );
    const claim = mustClaim();
    ledger.failHouseholdPlanningAutomationRun(db, {
      runId: claim.run.id,
      workerId: 'worker-1',
      fence: claim.run.fence,
      failureCode: 'PROVIDER_TIMEOUT_AMBIGUOUS',
      now: new Date(Date.parse(claim.run.leaseExpiresAt!) - 1)
    });

    expect(
      ledger.retryHouseholdPlanningAutomationRun(db, {
        householdId: 'home-a',
        occurrenceKey: claim.run.occurrenceKey,
        expectedConfigVersion: 2,
        requestedBy: 'limited',
        workerId: 'worker-retry',
        leaseMs: 30_000,
        now: new Date('2026-10-12T07:30:30.000Z')
      })
    ).toEqual({ outcome: 'not_authorized', run: null });
    expect(
      ledger.readHouseholdPlanningAutomationRun(db, 'home-a', claim.run.occurrenceKey)
    ).toMatchObject({ status: 'review_required', fence: 1 });
  });

  it('turns an expired lease into review first and waits for a separate retry action', async () => {
    await enableAutomation();
    const claim = mustClaim(claimInput({ leaseMs: 1_000 }));

    const expired = ledger.retryHouseholdPlanningAutomationRun(db, {
      householdId: 'home-a',
      occurrenceKey: claim.run.occurrenceKey,
      expectedConfigVersion: 2,
      requestedBy: 'owner',
      workerId: 'worker-retry',
      leaseMs: 30_000,
      now: new Date(claim.run.leaseExpiresAt!)
    });
    expect(expired).toMatchObject({
      outcome: 'review_required',
      run: { status: 'review_required', fence: 1, failureCode: 'LEASE_EXPIRED_AMBIGUOUS' }
    });

    const explicitRetry = ledger.retryHouseholdPlanningAutomationRun(db, {
      householdId: 'home-a',
      occurrenceKey: claim.run.occurrenceKey,
      expectedConfigVersion: 2,
      requestedBy: 'owner',
      workerId: 'worker-retry',
      leaseMs: 30_000,
      now: new Date(Date.parse(claim.run.leaseExpiresAt!) + 1)
    });
    expect(explicitRetry).toMatchObject({
      outcome: 'claimed',
      run: { id: claim.run.id, status: 'in_progress', fence: 2, failureCode: null }
    });
  });

  it('cancels an explicit retry after a configuration-version change', async () => {
    const enabled = await enableAutomation();
    const claim = mustClaim();
    ledger.failHouseholdPlanningAutomationRun(db, {
      runId: claim.run.id,
      workerId: 'worker-1',
      fence: claim.run.fence,
      failureCode: 'PROVIDER_TIMEOUT_AMBIGUOUS',
      now: new Date(Date.parse(claim.run.leaseExpiresAt!) - 1)
    });
    const automation = await import('./household-planning-automation.store.js');
    automation.saveHouseholdPlanningAutomation(
      db,
      'home-a',
      'owner',
      { expectedVersion: enabled.version, enabled: false },
      new Date('2026-10-12T07:30:30.000Z')
    );

    expect(
      ledger.retryHouseholdPlanningAutomationRun(db, {
        householdId: 'home-a',
        occurrenceKey: claim.run.occurrenceKey,
        expectedConfigVersion: enabled.version,
        requestedBy: 'owner',
        workerId: 'worker-retry',
        leaseMs: 30_000,
        now: new Date('2026-10-12T07:30:31.000Z')
      })
    ).toMatchObject({ outcome: 'stale_config', run: { status: 'cancelled', fence: 1 } });
  });

  it('pauses automation when its original authorizer lost permission before explicit retry', async () => {
    await enableAutomation();
    makeMember('retriager');
    const claim = mustClaim();
    ledger.failHouseholdPlanningAutomationRun(db, {
      runId: claim.run.id,
      workerId: 'worker-1',
      fence: claim.run.fence,
      failureCode: 'PROVIDER_TIMEOUT_AMBIGUOUS',
      now: new Date(Date.parse(claim.run.leaseExpiresAt!) - 1)
    });
    db.prepare('UPDATE household_members SET is_active = 0 WHERE user_id = ?').run('owner');

    expect(
      ledger.retryHouseholdPlanningAutomationRun(db, {
        householdId: 'home-a',
        occurrenceKey: claim.run.occurrenceKey,
        expectedConfigVersion: 2,
        requestedBy: 'retriager',
        workerId: 'worker-retry',
        leaseMs: 30_000,
        now: new Date('2026-10-12T07:30:30.000Z')
      })
    ).toMatchObject({
      outcome: 'authorization_invalid',
      run: { status: 'cancelled', failureCode: 'AUTHORIZATION_INVALID' }
    });
    expect(
      db
        .prepare(
          'SELECT enabled, version FROM household_planning_automations WHERE household_id = ?'
        )
        .get('home-a')
    ).toEqual({ enabled: 0, version: 3 });
  });

  it('marks a review-required occurrence skipped rather than retrying after its target week starts', async () => {
    await enableAutomation();
    const claim = mustClaim();
    ledger.failHouseholdPlanningAutomationRun(db, {
      runId: claim.run.id,
      workerId: 'worker-1',
      fence: claim.run.fence,
      failureCode: 'PROVIDER_TIMEOUT_AMBIGUOUS',
      now: new Date(Date.parse(claim.run.leaseExpiresAt!) - 1)
    });

    expect(
      ledger.retryHouseholdPlanningAutomationRun(db, {
        householdId: 'home-a',
        occurrenceKey: claim.run.occurrenceKey,
        expectedConfigVersion: 2,
        requestedBy: 'owner',
        workerId: 'worker-retry',
        leaseMs: 30_000,
        now: new Date('2026-10-19T00:00:00.000Z')
      })
    ).toMatchObject({ outcome: 'skipped', run: { status: 'skipped', fence: 1 } });
  });

  it('cancels a stale configuration occurrence without claiming provider work', async () => {
    await enableAutomation();
    const stale = ledger.claimHouseholdPlanningAutomationOccurrence(
      db,
      claimInput({ expectedConfigVersion: 1 })
    );

    expect(stale).toMatchObject({
      outcome: 'stale_config',
      run: { status: 'cancelled', failureCode: 'CONFIG_STALE', configVersion: 1 }
    });
  });

  it('pauses when the authorizing member loses permission and never claims the occurrence', async () => {
    await enableAutomation();
    db.prepare('UPDATE household_members SET is_active = 0 WHERE user_id = ?').run('owner');

    const result = ledger.claimHouseholdPlanningAutomationOccurrence(db, claimInput());
    const configuration = db
      .prepare('SELECT enabled, version FROM household_planning_automations WHERE household_id = ?')
      .get('home-a') as { enabled: number; version: number };

    expect(result).toMatchObject({
      outcome: 'authorization_invalid',
      run: { status: 'cancelled', failureCode: 'AUTHORIZATION_INVALID' }
    });
    expect(configuration).toEqual({ enabled: 0, version: 3 });
  });

  it('fences a running result after configuration changes and cancels it explicitly', async () => {
    const enabled = await enableAutomation();
    const claim = mustClaim();
    const changed = await import('./household-planning-automation.store.js');
    changed.saveHouseholdPlanningAutomation(
      db,
      'home-a',
      'owner',
      { expectedVersion: enabled.version, enabled: false },
      new Date('2026-10-12T08:00:00.000Z')
    );

    expect(
      ledger.cancelStaleHouseholdPlanningAutomationRuns(
        db,
        'home-a',
        3,
        new Date('2026-10-12T08:00:01.000Z')
      )
    ).toBe(1);
    expect(
      ledger.completeHouseholdPlanningAutomationRun(
        db,
        {
          runId: claim.run.id,
          workerId: 'worker-1',
          fence: claim.run.fence,
          now: new Date('2026-10-12T08:00:02.000Z')
        },
        () => {}
      )
    ).toMatchObject({
      outcome: 'cancelled',
      run: { status: 'cancelled', failureCode: 'CONFIG_STALE' }
    });
  });

  it('validates DST gaps with the shared occurrence resolver', async () => {
    await enableAutomation();
    const gapSchedule: HouseholdWeeklySchedule = {
      weekday: 7,
      localTime: '02:30',
      timeZone: 'Europe/Madrid'
    };
    const occurrence = nextHouseholdWeeklyOccurrence(
      gapSchedule,
      new Date('2026-03-28T12:00:00.000Z')
    );
    const gapConfig = db
      .prepare(
        `UPDATE household_planning_automations SET weekday = 7, local_time = '02:30', time_zone = 'Europe/Madrid', version = 3
         WHERE household_id = 'home-a'`
      )
      .run();
    expect(gapConfig.changes).toBe(1);

    const result = ledger.claimHouseholdPlanningAutomationOccurrence(
      db,
      claimInput({
        expectedConfigVersion: 3,
        schedule: gapSchedule,
        occurrence,
        targetWeekStart: '2026-03-30',
        now: new Date(occurrence.utcInstant)
      })
    );

    expect(occurrence).toMatchObject({ localTime: '03:00', scheduledLocalDate: '2026-03-29' });
    expect(result.outcome).toBe('claimed');
  });

  it('returns not_due without creating a ledger row and rejects the wrong target week', async () => {
    await enableAutomation();
    const occurrence = makeOccurrence();
    const early = ledger.claimHouseholdPlanningAutomationOccurrence(
      db,
      claimInput({ now: new Date(Date.parse(occurrence.utcInstant) - 1) })
    );
    expect(early).toEqual({ outcome: 'not_due', run: null });
    expect(
      (
        db.prepare('SELECT COUNT(*) AS count FROM household_planning_automation_runs').get() as {
          count: number;
        }
      ).count
    ).toBe(0);

    expect(() =>
      ledger.claimHouseholdPlanningAutomationOccurrence(
        db,
        claimInput({ targetWeekStart: '2026-10-20' })
      )
    ).toThrowError(expect.objectContaining({ code: 'AUTOMATION_RUN_INPUT_INVALID' }));
  });

  it('records a missed week as skipped without leasing or calling a publisher', async () => {
    await enableAutomation();
    const occurrence = makeOccurrence();
    const initialClaim = mustClaim(claimInput({ leaseMs: 1_000 }));
    const input = claimInput({
      leaseMs: 1_000,
      now: new Date('2026-10-19T00:00:00.000Z')
    });
    expect(ledger.recordMissedHouseholdPlanningAutomationOccurrence(db, input)).toMatchObject({
      outcome: 'skipped',
      run: {
        id: initialClaim.run.id,
        status: 'skipped',
        failureCode: 'TARGET_WEEK_MISSED',
        leaseExpiresAt: null,
        targetWeekStart: '2026-10-19'
      }
    });
    expect(ledger.recordMissedHouseholdPlanningAutomationOccurrence(db, input)).toMatchObject({
      outcome: 'skipped'
    });
    expect(
      ledger.readHouseholdPlanningAutomationRun(db, 'home-a', occurrence.occurrenceKey)?.fence
    ).toBe(1);
  });

  it('returns not_missed before the target week and skips a just-claimed run when the week starts', async () => {
    const saved = await enableAutomation();
    const lateSundaySchedule: HouseholdWeeklySchedule = {
      weekday: 7,
      localTime: '23:30',
      timeZone: 'Europe/Madrid'
    };
    db.prepare(
      `UPDATE household_planning_automations
          SET weekday = 7, local_time = '23:30', version = ? WHERE household_id = 'home-a'`
    ).run(saved.version + 1);
    const occurrence = nextHouseholdWeeklyOccurrence(
      lateSundaySchedule,
      new Date('2026-10-18T12:00:00.000Z')
    );
    const input = claimInput({
      expectedConfigVersion: saved.version + 1,
      schedule: lateSundaySchedule,
      occurrence,
      targetWeekStart: '2026-10-19',
      now: new Date(occurrence.utcInstant),
      leaseMs: 3_600_000
    });
    expect(ledger.recordMissedHouseholdPlanningAutomationOccurrence(db, input)).toEqual({
      outcome: 'not_missed',
      run: null
    });
    const claim = mustClaim(input as ReturnType<typeof claimInput>);
    let published = false;
    const completion = ledger.completeHouseholdPlanningAutomationRun(
      db,
      {
        runId: claim.run!.id,
        workerId: 'worker-1',
        fence: claim.run!.fence,
        now: new Date('2026-10-18T22:00:00.000Z')
      },
      () => {
        published = true;
      }
    );
    expect(completion).toMatchObject({
      outcome: 'skipped',
      run: { status: 'skipped', failureCode: 'TARGET_WEEK_MISSED' }
    });
    expect(published).toBe(false);
  });

  it('renews only the active fenced lease and expires it into review without changing its fence', async () => {
    await enableAutomation();
    const claim = mustClaim(claimInput({ leaseMs: 60_000 }));
    const renewed = ledger.renewHouseholdPlanningAutomationRunLease(db, {
      runId: claim.run.id,
      workerId: 'worker-1',
      fence: claim.run.fence,
      leaseMs: 120_000,
      now: new Date('2026-10-12T07:30:20.000Z')
    });
    expect(renewed).toMatchObject({ outcome: 'renewed', run: { status: 'in_progress', fence: 1 } });
    expect(Date.parse(renewed.run!.leaseExpiresAt!) - Date.parse(claim.run.leaseExpiresAt!)).toBe(
      80_000
    );

    const expired = ledger.renewHouseholdPlanningAutomationRunLease(db, {
      runId: claim.run.id,
      workerId: 'worker-1',
      fence: claim.run.fence,
      leaseMs: 120_000,
      now: new Date('2026-10-12T07:33:00.000Z')
    });
    expect(expired).toMatchObject({
      outcome: 'review_required',
      run: { status: 'review_required', failureCode: 'LEASE_EXPIRED_AMBIGUOUS', fence: 1 }
    });
  });

  it('rolls publication and completion back together when the local commit fails', async () => {
    await enableAutomation();
    db.exec('CREATE TABLE IF NOT EXISTS automation_ledger_publish_probe (id TEXT PRIMARY KEY)');
    db.prepare('DELETE FROM automation_ledger_publish_probe').run();
    const claim = mustClaim();

    expect(() =>
      ledger.completeHouseholdPlanningAutomationRun(
        db,
        {
          runId: claim.run.id,
          workerId: 'worker-1',
          fence: claim.run.fence,
          now: new Date('2026-10-12T07:30:01.000Z')
        },
        () => {
          db.prepare('INSERT INTO automation_ledger_publish_probe (id) VALUES (?)').run(
            'synthetic'
          );
          throw new Error('provider response must not be persisted');
        }
      )
    ).toThrow('provider response must not be persisted');
    expect(
      (
        db.prepare('SELECT COUNT(*) AS count FROM automation_ledger_publish_probe').get() as {
          count: number;
        }
      ).count
    ).toBe(0);
    expect(
      ledger.readHouseholdPlanningAutomationRun(db, 'home-a', claim.run.occurrenceKey)?.status
    ).toBe('in_progress');
  });

  it('does not invoke async publisher callbacks or allow an unauthorized completion', async () => {
    await enableAutomation();
    const claim = mustClaim();
    let asyncPublisherCalled = false;
    expect(() =>
      ledger.completeHouseholdPlanningAutomationRun(
        db,
        {
          runId: claim.run.id,
          workerId: 'worker-1',
          fence: claim.run.fence,
          now: new Date('2026-10-12T07:30:01.000Z')
        },
        (async () => {
          asyncPublisherCalled = true;
        }) as never
      )
    ).toThrowError(expect.objectContaining({ code: 'AUTOMATION_RUN_PUBLISH_MUST_BE_SYNCHRONOUS' }));
    expect(asyncPublisherCalled).toBe(false);
    expect(
      ledger.readHouseholdPlanningAutomationRun(db, 'home-a', claim.run.occurrenceKey)?.status
    ).toBe('in_progress');

    db.prepare('UPDATE household_members SET permissions = ? WHERE user_id = ?').run(
      JSON.stringify({ settings: false, calendar: { edit: true } }),
      'owner'
    );
    const completion = ledger.completeHouseholdPlanningAutomationRun(
      db,
      {
        runId: claim.run.id,
        workerId: 'worker-1',
        fence: claim.run.fence,
        now: new Date('2026-10-12T07:30:02.000Z')
      },
      () => {
        throw new Error('must not publish');
      }
    );
    expect(completion).toMatchObject({
      outcome: 'authorization_invalid',
      run: { status: 'cancelled', failureCode: 'AUTHORIZATION_INVALID' }
    });
    expect(
      db
        .prepare('SELECT enabled FROM household_planning_automations WHERE household_id = ?')
        .get('home-a')
    ).toEqual({ enabled: 0 });
  });

  it('does not renew or complete under a stale config and makes missing rows explicit', async () => {
    const absent = ledger.completeHouseholdPlanningAutomationRun(
      db,
      { runId: 'missing', workerId: 'worker-1', fence: 1, now: new Date() },
      () => {}
    );
    expect(absent).toEqual({ outcome: 'not_found', run: null });

    const enabled = await enableAutomation();
    const claim = mustClaim();
    db.prepare(
      'UPDATE household_planning_automations SET version = version + 1 WHERE household_id = ?'
    ).run('home-a');
    expect(
      ledger.renewHouseholdPlanningAutomationRunLease(db, {
        runId: claim.run.id,
        workerId: 'worker-1',
        fence: claim.run.fence,
        leaseMs: 30_000,
        now: new Date('2026-10-12T07:30:01.000Z')
      })
    ).toMatchObject({
      outcome: 'stale_config',
      run: { status: 'cancelled', failureCode: 'CONFIG_STALE' }
    });
    expect(
      ledger.cancelStaleHouseholdPlanningAutomationRuns(
        db,
        'home-a',
        enabled.version + 1,
        new Date()
      )
    ).toBe(0);
  });
});
