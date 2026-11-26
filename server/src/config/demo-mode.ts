import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEMO_DATABASE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../.tmp/ai-persona-demo/hogaria.sqlite'
);

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
  workingDirectory = process.cwd()
}: {
  mode: string | undefined;
  databasePath: string;
  workingDirectory?: string;
}): void {
  if (mode !== undefined && mode !== '' && mode !== '0' && mode !== '1') {
    throw new Error('HOGARIA_DEMO_MODE must be unset, 0 or 1.');
  }

  const configuredPath = resolve(workingDirectory, databasePath);
  const demoEnabled = mode === '1';
  const selectsDemoDatabase = pathsEqual(configuredPath, DEMO_DATABASE_PATH);

  if (demoEnabled && !selectsDemoDatabase) {
    throw new Error('Demo mode requires DATABASE_PATH to be the exact demo database path.');
  }
  if (!demoEnabled && selectsDemoDatabase) {
    throw new Error('The demo database requires HOGARIA_DEMO_MODE=1.');
  }
}
