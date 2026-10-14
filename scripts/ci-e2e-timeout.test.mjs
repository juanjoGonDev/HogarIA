import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

function getE2eShardTimeoutMinutes(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^  e2e:\s*$/.test(line));
  assert.notEqual(start, -1, 'CI workflow must define the e2e shard job');

  const end = lines.findIndex(
    (line, index) => index > start && /^  [A-Za-z0-9_-]+:\s*$/.test(line)
  );
  const job = lines.slice(start, end === -1 ? undefined : end);
  const timeout = job.find((line) => /^    timeout-minutes:\s*\d+\s*$/.test(line));
  assert.ok(timeout, 'e2e shard job must declare its own timeout-minutes');

  return Number(timeout.match(/\d+/)?.[0]);
}

test('CI E2E shards have at least 16 minutes for tests and cleanup', () => {
  const timeout = getE2eShardTimeoutMinutes(workflow);
  assert.ok(
    timeout >= 16,
    `e2e shard timeout is ${timeout}m; it must cover the slowest observed run plus artifact cleanup`
  );
});

test('the dedicated scheduler E2E publishes diagnostics from its own isolated run', () => {
  assert.match(workflow, /id: automation_e2e/);
  assert.match(
    workflow,
    /E2E_RESULTS_FILE: \$\{\{ steps\.automation_e2e\.outputs\.e2e_results_file \}\}/
  );
  assert.match(workflow, /path: \$\{\{ steps\.automation_e2e\.outputs\.e2e_report_dir \}\}/);
  assert.match(workflow, /path: \$\{\{ steps\.automation_e2e\.outputs\.e2e_output_dir \}\}/);
});
