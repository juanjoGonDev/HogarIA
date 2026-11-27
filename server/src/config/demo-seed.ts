import { closeSync, lstatSync, openSync, readFileSync, writeSync } from 'node:fs';
import Database from 'better-sqlite3';

import { createAiPersonaSeedPlan } from '../../../scripts/ai-persona-seeds.mjs';
import { acquireDemoDatabaseLock, resolveDemoDatabasePath } from './demo-mode.js';

export const DEMO_SEED_RUN_ID = 'demo';
export const DEMO_SEED_MARKER_CONTENT =
  JSON.stringify({ version: 1, runId: DEMO_SEED_RUN_ID, personaCount: 10 }) + '\n';

type DemoSeedState = 'empty' | 'seeded';

function assertRegularArtifact(path: string): boolean {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    throw new Error('A demo seed artifact is redirected or not a regular file.');
  }
  return true;
}

function expectedEmails(): string[] {
  return createAiPersonaSeedPlan(DEMO_SEED_RUN_ID).users.map(({ email }) => email);
}

function hasExpectedPersonas(database: Database.Database): boolean {
  const hasEmail = database.prepare('SELECT 1 FROM users WHERE email = ? LIMIT 1');
  return expectedEmails().every((email) => hasEmail.get(email) !== undefined);
}

function readUserCount(database: Database.Database): number {
  const result = database.prepare('SELECT COUNT(*) AS count FROM users').get() as {
    count: number;
  };
  return result.count;
}

export function getDemoSeedState({
  projectRoot = process.cwd()
}: {
  projectRoot?: string;
} = {}): DemoSeedState {
  const databasePath = resolveDemoDatabasePath(projectRoot);
  const markerPath = databasePath + '.seeded';
  const databaseExists = assertRegularArtifact(databasePath);
  const markerExists = assertRegularArtifact(markerPath);

  if (!databaseExists) {
    if (markerExists) throw new Error('The demo seed marker exists without its database.');
    return 'empty';
  }

  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const markedSeed = markerExists;
    if (markedSeed) {
      const marker = readFileSync(markerPath, 'utf8');
      if (marker !== DEMO_SEED_MARKER_CONTENT || !hasExpectedPersonas(database)) {
        throw new Error('The demo seed marker does not match the expected synthetic profiles.');
      }
      return 'seeded';
    }

    if (readUserCount(database) === 0) return 'empty';
    throw new Error('The demo database contains unmarked or partial data; run demo:db:reset.');
  } finally {
    database.close();
  }
}

export function writeDemoSeedMarker({
  projectRoot = process.cwd()
}: {
  projectRoot?: string;
} = {}): void {
  const release = acquireDemoDatabaseLock({ projectRoot });
  const databasePath = resolveDemoDatabasePath(projectRoot);
  const markerPath = databasePath + '.seeded';
  let descriptor: number | undefined;
  try {
    if (!assertRegularArtifact(databasePath)) {
      throw new Error('The demo database is missing after the seed run.');
    }
    if (assertRegularArtifact(markerPath)) {
      throw new Error('The demo seed marker already exists; refusing to overwrite it.');
    }

    const database = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
      if (!hasExpectedPersonas(database)) {
        throw new Error('The seed run did not persist all 10 synthetic persona accounts.');
      }
    } finally {
      database.close();
    }

    descriptor = openSync(markerPath, 'wx', 0o600);
    writeSync(descriptor, DEMO_SEED_MARKER_CONTENT);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    release();
  }
}
