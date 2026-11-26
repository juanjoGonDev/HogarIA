import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEMO_DATABASE_RELATIVE_PATH = '.tmp/ai-persona-demo/hogaria.sqlite';

export function resolveDemoDatabasePath(projectRoot = REPOSITORY_ROOT): string {
  return resolve(projectRoot, DEMO_DATABASE_RELATIVE_PATH);
}

export const DEMO_DATABASE_PATH = resolveDemoDatabasePath();
export const DEMO_DATABASE_LOCK_PATH = DEMO_DATABASE_PATH + '.lock';

function pathsEqual(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export function assertDemoDatabaseSelection({
  mode,
  databasePath,
  workingDirectory = process.cwd(),
  projectRoot = REPOSITORY_ROOT
}: {
  mode: string | undefined;
  databasePath: string;
  workingDirectory?: string;
  projectRoot?: string;
}): void {
  if (mode !== undefined && mode !== '' && mode !== '0' && mode !== '1') {
    throw new Error('HOGARIA_DEMO_MODE must be unset, 0 or 1.');
  }

  const configuredPath = resolve(workingDirectory, databasePath);
  const demoEnabled = mode === '1';
  const selectsDemoDatabase = pathsEqual(configuredPath, resolveDemoDatabasePath(projectRoot));

  if (demoEnabled && !selectsDemoDatabase) {
    throw new Error('Demo mode requires DATABASE_PATH to be the exact demo database path.');
  }
  if (!demoEnabled && selectsDemoDatabase) {
    throw new Error('The demo database requires HOGARIA_DEMO_MODE=1.');
  }
}

function ensureDemoDirectory(projectRoot: string): string {
  const directory = dirname(resolveDemoDatabasePath(projectRoot));
  mkdirSync(directory, { recursive: true });
  if (!pathsEqual(realpathSync(directory), directory)) {
    throw new Error('The demo database directory cannot be redirected.');
  }
  return directory;
}

function assertOwnedRegularFile(path: string): boolean {
  if (!existsSync(path)) return false;
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    throw new Error('A managed demo database artifact is redirected or not a regular file.');
  }
  return true;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function removeStaleLock(lockPath: string): void {
  if (!assertOwnedRegularFile(lockPath)) return;
  const previous = readFileSync(lockPath, 'utf8');
  const match = previous.match(/^(\d+):([a-f0-9-]{36})\r?\n?$/i);
  if (!match) throw new Error('The demo database lock is invalid; refusing to remove it.');
  if (processIsAlive(Number(match[1]))) {
    throw new Error('The demo database is already in use.');
  }
  if (readFileSync(lockPath, 'utf8') !== previous) {
    throw new Error('The demo database lock changed during inspection.');
  }
  unlinkSync(lockPath);
}

export function acquireDemoDatabaseLock({
  projectRoot = REPOSITORY_ROOT
}: {
  projectRoot?: string;
} = {}): () => void {
  ensureDemoDirectory(projectRoot);
  const lockPath = resolveDemoDatabasePath(projectRoot) + '.lock';
  const lockContent = String(process.pid) + ':' + randomUUID() + '\n';

  let descriptor: number;
  try {
    descriptor = openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    removeStaleLock(lockPath);
    descriptor = openSync(lockPath, 'wx', 0o600);
  }

  try {
    writeSync(descriptor, lockContent);
  } catch (error) {
    closeSync(descriptor);
    unlinkSync(lockPath);
    throw error;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;

    const ownsLock =
      assertOwnedRegularFile(lockPath) && readFileSync(lockPath, 'utf8') === lockContent;
    closeSync(descriptor);
    if (ownsLock) unlinkSync(lockPath);
  };
}

export function resetDemoDatabase({
  projectRoot = REPOSITORY_ROOT
}: {
  projectRoot?: string;
} = {}): void {
  const release = acquireDemoDatabaseLock({ projectRoot });
  try {
    const databasePath = resolveDemoDatabasePath(projectRoot);
    const directory = ensureDemoDirectory(projectRoot);
    if (!pathsEqual(dirname(databasePath), directory)) {
      throw new Error('The demo database path escaped its managed directory.');
    }
    for (const suffix of ['', '-wal', '-shm', '-journal', '.seeded']) {
      const path = databasePath + suffix;
      if (assertOwnedRegularFile(path)) unlinkSync(path);
    }
  } finally {
    release();
  }
}
