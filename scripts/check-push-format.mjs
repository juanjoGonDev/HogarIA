import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as prettier from 'prettier';

const FORMAT_FILE = /\.(?:ts|json|md|yml|yaml)$/i;

export function selectFormatPaths(paths) {
  return [...new Set(paths)].filter(
    (path) => FORMAT_FILE.test(path) && basename(path) !== 'pnpm-lock.yaml'
  );
}

export async function checkFormatFiles(paths, options = {}) {
  const root = options.root ?? process.cwd();
  const exists = options.exists ?? existsSync;
  const read = options.read ?? ((filePath) => readFileSync(filePath, 'utf8'));
  const prettierApi = options.prettierApi ?? prettier;
  const failures = [];

  for (const path of selectFormatPaths(paths)) {
    const filePath = resolve(root, path);
    if (!exists(filePath)) continue;

    const fileInfo = await prettierApi.getFileInfo(filePath, {
      ignorePath: resolve(root, '.prettierignore')
    });
    if (fileInfo.ignored || fileInfo.inferredParser === null) continue;

    const config = (await prettierApi.resolveConfig(filePath)) ?? {};
    const contents = await read(filePath, path);
    const isFormatted = await prettierApi.check(contents, { ...config, filepath: filePath });
    if (!isFormatted) failures.push(path);
  }

  return failures;
}

function runGit(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function getPushedFilePaths(root) {
  const pushedRef = runGit(root, ['rev-parse', '--verify', '@{push}^{commit}']).trim();
  const changedFiles = runGit(root, [
    'diff',
    '--name-only',
    '-z',
    '--diff-filter=ACMRT',
    `${pushedRef}...HEAD`,
    '--'
  ]);

  return changedFiles.split('\0').filter(Boolean);
}

async function main() {
  const root = runGit(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  let pushedFiles;

  try {
    pushedFiles = getPushedFilePaths(root);
  } catch (error) {
    console.error(
      'format-check: no se pudo resolver @{push}; configura la rama upstream antes de comprobar el formato.'
    );
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const failures = await checkFormatFiles(pushedFiles, {
    root,
    exists: () => true,
    read: (_filePath, path) => runGit(root, ['show', `HEAD:${path}`])
  });
  if (failures.length) {
    for (const file of failures) console.error(`format-check: formato incorrecto: ${file}`);
    process.exitCode = 1;
  } else {
    console.log(
      `format-check: ${selectFormatPaths(pushedFiles).length} rutas revisadas; sin incidencias.`
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
