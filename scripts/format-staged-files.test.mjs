import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { formatFiles, selectFormatPaths } from './format-staged-files.mjs';

test('selects supported formatter paths and excludes the lockfile', () => {
  assert.deepEqual(
    selectFormatPaths([
      'src/a.ts',
      'docs/a.md',
      'config/a.yml',
      'config/a.yaml',
      'package.json',
      'pnpm-lock.yaml',
      'styles.css',
      'src/a.ts'
    ]),
    ['src/a.ts', 'docs/a.md', 'config/a.yml', 'config/a.yaml', 'package.json']
  );
});

test('formats long staged path lists without building a file-list command', async () => {
  const paths = Array.from(
    { length: 44 },
    (_, index) => `src/${String(index).padStart(2, '0')}-${'x'.repeat(190)}.ts`
  );
  assert.ok(paths.join(' ').length > 8191, 'test input exceeds the Windows command-line limit');

  const writes = [];
  const formattedPaths = await formatFiles(paths, {
    root: 'C:/repo',
    exists: () => true,
    read: (_filePath, path) => path,
    write: (_filePath, contents, path) => writes.push([path, contents]),
    prettierApi: {
      getFileInfo: async () => ({ ignored: false, inferredParser: 'typescript' }),
      resolveConfig: async () => ({}),
      format: async (contents) => `${contents}\n`
    }
  });

  assert.deepEqual(formattedPaths, paths);
  assert.equal(writes.length, 44);
  assert.deepEqual(writes[0], [paths[0], `${paths[0]}\n`]);
});

test('skips ignored, unsupported, and already formatted staged files', async () => {
  const writes = [];
  const formattedPaths = await formatFiles(['ignored.ts', 'unknown.ts', 'clean.ts'], {
    root: 'C:/repo',
    exists: () => true,
    read: (_filePath, path) => path,
    write: (...args) => writes.push(args),
    prettierApi: {
      getFileInfo: async (filePath) =>
        filePath.endsWith('ignored.ts')
          ? { ignored: true, inferredParser: 'typescript' }
          : filePath.endsWith('unknown.ts')
            ? { ignored: false, inferredParser: null }
            : { ignored: false, inferredParser: 'typescript' },
      resolveConfig: async () => ({}),
      format: async (contents) => contents
    }
  });

  assert.deepEqual(formattedPaths, []);
  assert.deepEqual(writes, []);
});

test('Lefthook invokes the formatter without expanding staged paths', () => {
  const config = readFileSync(fileURLToPath(new URL('../lefthook.yml', import.meta.url)), 'utf8');
  const prettierJob = config.match(/- name: prettier([\s\S]*?)(?=\n    - name:|\n\s*$)/)?.[1];

  assert.ok(prettierJob, 'prettier Lefthook job exists');
  assert.match(prettierJob, /run:\s*node scripts\/format-staged-files\.mjs/);
  assert.doesNotMatch(prettierJob, /\{staged_files\}/);
});
