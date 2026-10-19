import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as prettier from 'prettier';

const FORMAT_FILE = /\.(?:ts|json|md|yml|yaml)$/i;

export function selectFormatPaths(paths) {
  return [...new Set(paths)].filter(
    (path) => FORMAT_FILE.test(path) && basename(path) !== 'pnpm-lock.yaml'
  );
}

export async function formatFiles(paths, options = {}) {
  const root = options.root ?? process.cwd();
  const exists = options.exists ?? existsSync;
  const read = options.read ?? ((filePath) => readFileSync(filePath, 'utf8'));
  const write =
    options.write ?? ((filePath, contents) => writeFileSync(filePath, contents, 'utf8'));
  const prettierApi = options.prettierApi ?? prettier;
  const changed = [];

  for (const path of selectFormatPaths(paths)) {
    const filePath = resolve(root, path);
    if (!exists(filePath)) continue;

    const fileInfo = await prettierApi.getFileInfo(filePath, {
      ignorePath: resolve(root, '.prettierignore')
    });
    if (fileInfo.ignored || fileInfo.inferredParser === null) continue;

    const config = (await prettierApi.resolveConfig(filePath)) ?? {};
    const contents = await read(filePath, path);
    const formatted = await prettierApi.format(contents, { ...config, filepath: filePath });
    if (formatted === contents) continue;

    await write(filePath, formatted, path);
    changed.push(path);
  }

  return changed;
}

function runGit(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function getStagedFilePaths(root) {
  return runGit(root, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT', '--'])
    .split('\0')
    .filter(Boolean);
}

async function main() {
  const root = runGit(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
  const stagedFiles = getStagedFilePaths(root);
  const changed = await formatFiles(stagedFiles, { root });

  if (changed.length) {
    console.log(`prettier: ${changed.length} staged route(s) formatted in-process.`);
  } else {
    console.log(`prettier: ${selectFormatPaths(stagedFiles).length} staged route(s); no changes.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
