import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { checkFormatFiles, selectFormatPaths } from './check-push-format.mjs';

test('selects only format-checked paths and excludes pnpm lockfile', () => {
  assert.deepEqual(
    selectFormatPaths([
      'src/changed.ts',
      'docs/guide.md',
      'pnpm-lock.yaml',
      'src/component.css',
      'src/changed.ts'
    ]),
    ['src/changed.ts', 'docs/guide.md']
  );
});

test('checks many paths in-process without a file-list command line', async () => {
  const files = Array.from(
    { length: 44 },
    (_, index) =>
      `frontend/src/features/long-component-${String(index).padStart(2, '0')}-${'x'.repeat(180)}.component.ts`
  );
  const checked = [];
  assert.ok(files.join(' ').length > 8191, 'test input exceeds the Windows command-line limit');

  const failures = await checkFormatFiles(files, {
    root: 'D:/workspace',
    exists: () => true,
    read: async (filePath) => filePath,
    prettierApi: {
      check: async (_source, options) => {
        checked.push(options.filepath);
        return true;
      },
      getFileInfo: async () => ({ ignored: false }),
      resolveConfig: async () => ({ semi: true })
    }
  });

  assert.deepEqual(failures, []);
  assert.equal(checked.length, 44);
  assert.ok(
    checked.every((filePath) => filePath.replaceAll('\\', '/').startsWith('D:/workspace/'))
  );
});

test('reports only changed files that fail Prettier', async () => {
  const failures = await checkFormatFiles(['src/ok.ts', 'src/bad.ts', 'src/deleted.ts'], {
    root: 'D:/workspace',
    exists: (filePath) => !filePath.endsWith('deleted.ts'),
    read: async (filePath) => filePath,
    prettierApi: {
      check: async (_source, options) => !options.filepath.endsWith('bad.ts'),
      getFileInfo: async () => ({ ignored: false }),
      resolveConfig: async () => null
    }
  });

  assert.deepEqual(failures, ['src/bad.ts']);
});

test('Lefthook invokes the formatter script without expanding push files into cmd.exe', () => {
  const config = readFileSync(new URL('../lefthook.yml', import.meta.url), 'utf8');
  const formatCheck = config.match(/- name: format-check([\s\S]*?)(?=\n    - name:|\n\s*$)/)?.[1];

  assert.ok(formatCheck, 'format-check Lefthook job exists');
  assert.match(formatCheck, /run:\s*node scripts\/check-push-format\.mjs/);
  assert.doesNotMatch(formatCheck, /run:.*\{push_files\}/);
});
