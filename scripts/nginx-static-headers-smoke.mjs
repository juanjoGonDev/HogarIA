import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const STATIC_HEADER_CASES = [
  { path: '/index.html', cacheControl: 'no-cache, no-store, must-revalidate' },
  { path: '/ngsw.json', cacheControl: 'no-cache, no-store, must-revalidate' },
  { path: '/ngsw-worker.js', cacheControl: 'no-cache, no-store, must-revalidate' },
  { path: '/safety-worker.js', cacheControl: 'no-cache, no-store, must-revalidate' },
  { path: '/manifest.json', cacheControl: 'no-cache, no-store, must-revalidate' },
  { path: '/main-ABCDEFGH.js', cacheControl: 'public, max-age=31536000, immutable' }
];

export async function verifyStaticHeaders(baseUrl, fetcher = fetch) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Nginx smoke URL must be HTTP(S) and must not contain credentials.');
  }

  for (const { path, cacheControl } of STATIC_HEADER_CASES) {
    const response = await fetcher(new URL(path, base), { method: 'HEAD' });
    if (response.status !== 200) {
      throw new Error(`${path} expected HTTP 200, received ${response.status}.`);
    }

    const expectedHeaders = {
      'cache-control': cacheControl,
      'x-frame-options': 'SAMEORIGIN',
      'x-content-type-options': 'nosniff'
    };
    for (const [name, expected] of Object.entries(expectedHeaders)) {
      const actual = response.headers.get(name);
      if (actual?.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(
          `${path} expected ${name}: ${expected}, received ${actual ?? 'missing'}.`
        );
      }
    }
  }

  return STATIC_HEADER_CASES.map(({ path }) => path);
}

function runDocker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function dockerPath(path) {
  return resolve(path).replaceAll('\\', '/');
}

function assertOwnedTempDirectory(path, tempRoot) {
  const target = resolve(path);
  const relativeTarget = relative(resolve(tempRoot), target);
  if (
    relativeTarget === '' ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(relativeTarget) ||
    lstatSync(target).isSymbolicLink()
  ) {
    throw new Error('Refusing to remove an unowned or redirected Nginx smoke directory.');
  }
}

async function waitForNginx(baseUrl, containerId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/index.html`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(1_000)
      });
      if (response.status === 200) return;
    } catch {
      // Container startup can take a moment after Docker reports its host port.
    }
    await delay(500);
  }

  const logs = spawnSync('docker', ['logs', containerId], { encoding: 'utf8' });
  throw new Error(`Nginx smoke did not become ready. ${logs.stdout ?? ''} ${logs.stderr ?? ''}`);
}

async function runSmoke() {
  const tempRoot = resolve(tmpdir());
  const runDirectory = mkdtempSync(join(tempRoot, 'hogaria-nginx-static-smoke-'));
  const staticDirectory = join(runDirectory, 'static');
  const containerName = `hogaria-nginx-static-smoke-${process.pid}-${randomUUID()}`;
  let containerId;
  let containerStarted = false;
  let failure;

  try {
    const existing = spawnSync('docker', ['container', 'inspect', containerName], {
      stdio: 'ignore'
    });
    if (existing.status === 0) {
      throw new Error('Refusing to reuse an existing Nginx smoke container.');
    }

    mkdirSync(staticDirectory);
    writeFileSync(join(staticDirectory, 'index.html'), '<!doctype html><html></html>\n');
    writeFileSync(join(staticDirectory, 'ngsw.json'), '{}\n');
    writeFileSync(join(staticDirectory, 'ngsw-worker.js'), '/* synthetic worker */\n');
    writeFileSync(join(staticDirectory, 'safety-worker.js'), '/* synthetic safety worker */\n');
    writeFileSync(join(staticDirectory, 'manifest.json'), '{}\n');
    writeFileSync(join(staticDirectory, 'main-ABCDEFGH.js'), 'globalThis.nginxSmoke = true;\n');

    containerId = runDocker([
      'create',
      '--name',
      containerName,
      '--add-host',
      'app:127.0.0.1',
      '--publish',
      '127.0.0.1::80',
      '--mount',
      `type=bind,source=${dockerPath(join(repoRoot, 'nginx', 'nginx.conf'))},target=/etc/nginx/nginx.conf,readonly`,
      '--mount',
      `type=bind,source=${dockerPath(join(repoRoot, 'nginx', 'proxy-api-common.conf'))},target=/etc/nginx/proxy-api-common.conf,readonly`,
      '--mount',
      `type=bind,source=${dockerPath(staticDirectory)},target=/usr/share/nginx/html,readonly`,
      'nginx:alpine'
    ]);
    if (!containerId) throw new Error('Docker did not return an Nginx smoke container ID.');
    containerStarted = true;
    runDocker(['start', containerId]);

    const mapping = runDocker(['port', containerId, '80/tcp']);
    const port = mapping.match(/:(\d+)\s*$/m)?.[1];
    if (!port) throw new Error('Docker did not expose a host port for the Nginx smoke.');

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForNginx(baseUrl, containerId);
    const checked = await verifyStaticHeaders(baseUrl);
    console.log(`nginx-static-headers-smoke: ${checked.length} respuestas verificadas.`);
  } catch (error) {
    failure = error;
  } finally {
    if (containerStarted) {
      try {
        runDocker(['rm', '--force', containerId]);
      } catch (error) {
        failure ??= error;
      }
    }

    try {
      assertOwnedTempDirectory(runDirectory, tempRoot);
      rmSync(runDirectory, { recursive: true, force: false });
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure) throw failure;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
