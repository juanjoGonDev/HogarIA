import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

function getJobTimeoutMinutes(source, jobName) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `CI workflow must define the ${jobName} job`);

  const end = lines.findIndex(
    (line, index) => index > start && /^  [A-Za-z0-9_-]+:\s*$/.test(line)
  );
  const job = lines.slice(start, end === -1 ? undefined : end);
  const timeout = job.find((line) => /^    timeout-minutes:\s*\d+\s*$/.test(line));
  assert.ok(timeout, 'e2e shard job must declare its own timeout-minutes');

  return Number(timeout.match(/\d+/)?.[0]);
}

test('CI E2E jobs have at least 30 minutes for completion and diagnostics', () => {
  for (const jobName of ['e2e', 'full-stack']) {
    const timeout = getJobTimeoutMinutes(workflow, jobName);
    assert.ok(
      timeout >= 30,
      `${jobName} timeout is ${timeout}m; it must allow the observed suite to finish and publish diagnostics`
    );
  }
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
