import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { assertSafeAiPersonaSeedTarget, createAiPersonaSeedPlan } from './ai-persona-seeds.mjs';

const ALL = (values, expected) =>
  assert.deepEqual([...new Set(values)].sort(), [...expected].sort());

describe('AI persona seed generator', () => {
  it('is deterministic per run and isolates every account email by run id', () => {
    const first = createAiPersonaSeedPlan('matrix_20261126');
    const repeat = createAiPersonaSeedPlan('matrix_20261126');
    const anotherRun = createAiPersonaSeedPlan('matrix_20261127');

    assert.deepEqual(first, repeat);
    assert.equal(first.users.length, 10);
    assert.equal(new Set(first.users.map((user) => user.email)).size, first.users.length);
    assert.ok(first.users.every((user) => user.email.endsWith('@hogaria.test')));
    assert.ok(first.users.every((user) => !('password' in user) && !('token' in user)));
    assert.notEqual(first.users[0].email, anotherRun.users[0].email);
  });

  it('covers solo, couple and six-member household profiles across current schema enums', () => {
    const { users, households } = createAiPersonaSeedPlan('coverage');
    const solo = users.filter((user) => user.accountType === 'solo');
    assert.equal(solo.length, 2);
    assert.ok(solo.every((user) => user.householdKey && user.role === 'admin'));
    assert.ok(solo.every((user) => households[user.householdKey].memberKeys.length === 1));
    assert.equal(users.filter((user) => user.householdKey === null).length, 0);
    assert.equal(households.couple.memberKeys.length, 2);
    assert.equal(households.family.memberKeys.length, 6);

    ALL(
      users.map((user) => user.cookingLevel),
      ['none', 'beginner', 'intermediate', 'expert']
    );
    ALL(
      users.flatMap((user) => user.taste.goals),
      ['balanced', 'weight-loss', 'weight-gain', 'muscle-gain', 'maintenance', 'variety', 'custom']
    );
    ALL(
      users.flatMap((user) => user.modules),
      ['meals', 'pantry', 'shopping', 'receipts', 'home']
    );

    const members = users.filter((user) => user.memberProfile !== null);
    assert.ok(
      members.every((user) => {
        const profile = user.memberProfile;
        const encodedAllergies = profile.allergies
          .map((allergy) => `${allergy.name} (${allergy.severity})`)
          .join(', ');
        return (
          user.taste.notes.includes(`dieta ${profile.dietType}`) &&
          user.taste.notes.includes(`picante ${profile.spiceTolerance}`) &&
          user.taste.notes.includes(`ración ${profile.portionSize}`) &&
          user.taste.notes.includes(`alergias ${encodedAllergies || 'ninguna'}.`)
        );
      })
    );
    ALL(
      members.map((user) => user.role),
      ['admin', 'member', 'child']
    );
    ALL(
      members.map((user) => user.memberProfile.dietType),
      ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'keto', 'paleo']
    );
    ALL(
      members.map((user) => user.memberProfile.spiceTolerance),
      ['low', 'medium', 'high']
    );
    ALL(
      members.map((user) => user.memberProfile.portionSize),
      ['small', 'medium', 'large']
    );
    ALL(
      members.flatMap((user) => user.memberProfile.allergies.map((allergy) => allergy.severity)),
      ['mild', 'moderate', 'severe']
    );
  });

  it('rejects unsafe run identifiers rather than creating ambiguous fixture names', () => {
    for (const runId of ['', '   ', '../outside', 'run;drop', 'A'.repeat(50)]) {
      assert.throws(() => createAiPersonaSeedPlan(runId), /run id/i);
    }
  });

  it('allows writes only for opted-in loopback runs with the owned SQLite path', () => {
    const runDirectory = mkdtempSync(join(tmpdir(), 'hogaria-e2e-'));
    const environment = {
      E2E_EXTERNAL_STACK: '1',
      E2E_STACK: 'dev',
      E2E_RUN_DIR: runDirectory,
      DATABASE_PATH: join(runDirectory, 'hogaria.sqlite'),
      E2E_SEED: 'synthetic-run',
      E2E_BASE_URL: 'http://127.0.0.1:4001',
      E2E_FRONTEND_PORT: '4001',
      E2E_API_PORT: '4002'
    };
    try {
      assert.doesNotThrow(() =>
        assertSafeAiPersonaSeedTarget({
          optIn: '1',
          origin: 'http://127.0.0.1:4001',
          databasePath: join(runDirectory, 'hogaria.sqlite'),
          runDirectory,
          environment
        })
      );
      assert.throws(
        () =>
          assertSafeAiPersonaSeedTarget({
            optIn: '0',
            origin: 'http://127.0.0.1:4001',
            databasePath: join(runDirectory, 'hogaria.sqlite'),
            runDirectory,
            environment
          }),
        /opt-in/i
      );
      assert.throws(
        () =>
          assertSafeAiPersonaSeedTarget({
            optIn: '1',
            origin: 'https://example.test',
            databasePath: join(runDirectory, 'hogaria.sqlite'),
            runDirectory,
            environment
          }),
        /loopback/i
      );
      assert.throws(
        () =>
          assertSafeAiPersonaSeedTarget({
            optIn: '1',
            origin: 'http://127.0.0.1:4001',
            databasePath: join(tmpdir(), 'hogaria.sqlite'),
            runDirectory,
            environment
          }),
        /DATABASE_PATH/i
      );
    } finally {
      rmSync(runDirectory, { recursive: true, force: true });
    }
  });
});
