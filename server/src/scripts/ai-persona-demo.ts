import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDemoDatabasePath, resetDemoDatabase } from '../config/demo-mode.js';
import { getDemoSeedState, writeDemoSeedMarker } from '../config/demo-seed.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SEED_SPEC = 'tests/e2e/ai-persona-seeds.spec.ts';

function minimalProcessEnvironment(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const allowed = [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'HOME',
    'APPDATA',
    'LOCALAPPDATA',
    'PLAYWRIGHT_BROWSERS_PATH',
    'E2E_CHROME_BIN',
    'HOGARIA_AI_REAL_SMOKE_WEB_API_ORIGIN'
  ];
  const environment: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return { ...environment, ...overrides };
}

export function runOwnedNodeScript(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  { gracefulShutdown = false }: { gracefulShutdown?: boolean } = {}
): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: PROJECT_ROOT,
      env,
      stdio: gracefulShutdown ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit',
      windowsHide: true
    });
    let stopRequested = false;
    const stopChild = () => {
      stopRequested = true;
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (gracefulShutdown && child.connected) {
        child.send({ type: 'shutdown' }, (error) => {
          if (error && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        });
      } else {
        child.kill('SIGINT');
      }
    };
    const removeSignalHandlers = () => {
      process.removeListener('SIGINT', stopChild);
      process.removeListener('SIGTERM', stopChild);
    };
    process.once('SIGINT', stopChild);
    process.once('SIGTERM', stopChild);
    child.once('error', (error) => {
      removeSignalHandlers();
      rejectRun(error);
    });
    child.once('exit', (code, signal) => {
      removeSignalHandlers();
      if (code === 0 || (stopRequested && (signal === 'SIGINT' || signal === 'SIGTERM'))) {
        resolveRun();
      } else rejectRun(new Error(`${script} exited with ${code ?? signal ?? 'unknown error'}.`));
    });
  });
}

function demoEnvironment(
  extra: Record<string, string> = {},
  projectRoot = PROJECT_ROOT
): NodeJS.ProcessEnv {
  return minimalProcessEnvironment({
    HOGARIA_DEMO_MODE: '1',
    HOGARIA_DEMO_RUN: '1',
    DATABASE_PATH: resolveDemoDatabasePath(projectRoot),
    JWT_SECRET: randomBytes(32).toString('base64url'),
    ...extra
  });
}

type DemoSeedStateReader = () => ReturnType<typeof getDemoSeedState>;
type DemoMarkerWriter = () => void;
type DemoScriptRunner = typeof runOwnedNodeScript;

interface DemoCommandDependencies {
  resetDatabase: () => void;
  seedDatabase: () => Promise<void>;
  runScript: DemoScriptRunner;
  projectRoot: string;
}

interface SeedDependencies {
  projectRoot: string;
  getSeedState: DemoSeedStateReader;
  writeSeedMarker: DemoMarkerWriter;
  resetDatabase: () => void;
  runScript: DemoScriptRunner;
}

async function seedDemoDatabase({
  projectRoot,
  getSeedState,
  writeSeedMarker,
  resetDatabase,
  runScript
}: SeedDependencies): Promise<void> {
  if (getSeedState() === 'seeded') {
    console.log('[demo] perfiles sintéticos ya presentes; seed sin cambios.');
    return;
  }

  let seedAttempted = false;
  try {
    seedAttempted = true;
    await runScript(
      resolve(PROJECT_ROOT, 'scripts/run-isolated-playwright.mjs'),
      [SEED_SPEC],
      demoEnvironment(
        {
          HOGARIA_DEMO_SEED: 'demo',
          HOGARIA_AI_SEED_GENERATION: '1',
          HOGARIA_AI_SEED_CLEANUP_ON_FAILURE: '1'
        },
        projectRoot
      )
    );
    try {
      writeSeedMarker();
    } catch (error) {
      if (getSeedState() !== 'seeded') throw error;
    }
    console.log('[demo] 10 perfiles sintéticos guardados por la API en la SQLite demo.');
  } catch (error) {
    if (seedAttempted) {
      try {
        getSeedState();
      } catch {
        try {
          resetDatabase();
          console.error('[demo] seed incompleto eliminado; puedes volver a ejecutar demo:seed.');
        } catch {
          console.error(
            '[demo] seed incompleto; ejecuta demo:db:reset cuando la demo esté parada.'
          );
        }
      }
    }
    throw error;
  }
}

async function regenerateDemo(dependencies: DemoCommandDependencies): Promise<void> {
  dependencies.resetDatabase();
  await dependencies.seedDatabase();
  await dependencies.runScript(
    resolve(PROJECT_ROOT, 'scripts/run-ai-real-smoke.mjs'),
    [],
    demoEnvironment({ HOGARIA_AI_REAL_SMOKE: '1' }, dependencies.projectRoot)
  );
}

async function startDemoApp(dependencies: DemoCommandDependencies): Promise<void> {
  await dependencies.seedDatabase();
  await dependencies.runScript(
    resolve(PROJECT_ROOT, 'scripts/run-ai-persona-demo-app.mjs'),
    [],
    demoEnvironment({}, dependencies.projectRoot),
    { gracefulShutdown: true }
  );
}

export async function runDemoCommand(
  command: string | undefined,
  overrides: Partial<DemoCommandDependencies & SeedDependencies> = {}
): Promise<void> {
  const projectRoot = overrides.projectRoot ?? PROJECT_ROOT;
  const resetDatabase = overrides.resetDatabase ?? (() => resetDemoDatabase({ projectRoot }));
  const getSeedState = overrides.getSeedState ?? (() => getDemoSeedState({ projectRoot }));
  const writeSeedMarker = overrides.writeSeedMarker ?? (() => writeDemoSeedMarker({ projectRoot }));
  const runScript = overrides.runScript ?? runOwnedNodeScript;
  const seedDatabase =
    overrides.seedDatabase ??
    (() =>
      seedDemoDatabase({ projectRoot, getSeedState, writeSeedMarker, resetDatabase, runScript }));
  const dependencies = { projectRoot, resetDatabase, seedDatabase, runScript };

  switch (command) {
    case 'reset':
      resetDatabase();
      console.log('[demo] SQLite demo restablecida.');
      return;
    case 'seed':
      await seedDatabase();
      return;
    case 'regenerate':
      await regenerateDemo(dependencies);
      return;
    case 'app':
      await startDemoApp(dependencies);
      return;
    default:
      throw new Error('Uso: ai-persona-demo.ts <reset|seed|regenerate|app>.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDemoCommand(process.argv[2]).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Demo command failed.');
    process.exitCode = 1;
  });
}
