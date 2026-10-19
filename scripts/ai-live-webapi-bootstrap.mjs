import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertSmokeRunDirectoryOwned,
  createWebApiAttestation,
  validateWebApiAttestation
} from './ai-live-webapi-supervisor.mjs';

const runDir = assertSmokeRunDirectoryOwned(process.env.HOGARIA_AI_REAL_SMOKE_WEBAPI_RUN_DIR ?? '');
if (resolve(process.cwd()) !== runDir) {
  throw new Error('The WebAPI bootstrap did not start in its owned temporary directory.');
}

const webApiRoot = resolve(process.env.HOGARIA_AI_REAL_SMOKE_WEBAPI_ROOT ?? '');
const configUrl = pathToFileURL(join(webApiRoot, 'src', 'config', 'config.ts')).href;
const persistenceUrl = pathToFileURL(
  join(webApiRoot, 'src', 'shared', 'persistence', 'config.ts')
).href;
const patchrightConfigUrl = pathToFileURL(
  join(webApiRoot, 'src', 'providers', 'patchright', 'config.ts')
).href;
const [{ config }, { readPersistenceConfig }, { createPatchrightProviderConfig }] =
  await Promise.all([import(configUrl), import(persistenceUrl), import(patchrightConfigUrl)]);

const attestation = createWebApiAttestation({
  config,
  persistence: readPersistenceConfig(),
  effectiveProfileDirectory: createPatchrightProviderConfig('runtime').userDataDir,
  env: process.env,
  cwd: process.cwd(),
  pid: process.pid
});
validateWebApiAttestation(attestation, {
  expectedEnv: process.env,
  childPid: process.pid,
  runDir
});

writeFileSync(
  process.env.HOGARIA_AI_REAL_SMOKE_WEBAPI_ATTESTATION_FILE,
  `${JSON.stringify(attestation)}\n`,
  { encoding: 'utf8', flag: 'wx', mode: 0o600 }
);

await import(pathToFileURL(join(webApiRoot, 'src', 'main.ts')).href);
