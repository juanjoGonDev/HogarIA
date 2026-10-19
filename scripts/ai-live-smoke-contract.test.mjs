import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  AI_LIVE_ASSISTANT_ACTION_KINDS,
  AI_LIVE_SMOKE_DEADLINES,
  assertAiLiveSmokeDeadlineContract
} from './ai-live-smoke-contract.mjs';
import { AI_LIVE_SMOKE_COMPLETION_BUDGET } from './ai-live-smoke-safety.mjs';

test('real smoke deadlines leave a strictly increasing margin across each boundary', () => {
  assert.equal(assertAiLiveSmokeDeadlineContract(), true);
  assert.equal(AI_LIVE_SMOKE_DEADLINES.configMs, 240_000);
  assert.ok(AI_LIVE_SMOKE_DEADLINES.proxyMs > AI_LIVE_SMOKE_DEADLINES.configMs);
  assert.ok(AI_LIVE_SMOKE_DEADLINES.requestMs > AI_LIVE_SMOKE_DEADLINES.proxyMs);
  assert.ok(AI_LIVE_SMOKE_DEADLINES.testMs > AI_LIVE_SMOKE_DEADLINES.requestMs);
  assert.ok(AI_LIVE_SMOKE_DEADLINES.globalMs > AI_LIVE_SMOKE_DEADLINES.testMs);
  assert.ok(AI_LIVE_SMOKE_DEADLINES.watchdogMs > AI_LIVE_SMOKE_DEADLINES.globalMs);
  assert.equal(AI_LIVE_SMOKE_DEADLINES.recipeMaxTokens, 4096);
  assert.ok(AI_LIVE_SMOKE_COMPLETION_BUDGET <= 10);
});

test('assistant live smoke contract lists all supported action kinds once', () => {
  assert.equal(AI_LIVE_ASSISTANT_ACTION_KINDS.length, 13);
  assert.equal(new Set(AI_LIVE_ASSISTANT_ACTION_KINDS).size, 13);
});

test('deadline contract rejects a request layer that can expire before its inner dependency', () => {
  assert.throws(
    () =>
      assertAiLiveSmokeDeadlineContract({
        ...AI_LIVE_SMOKE_DEADLINES,
        requestMs: AI_LIVE_SMOKE_DEADLINES.proxyMs
      }),
    /strictly increasing/
  );
});

test('live recipe limits remain within the server AI configuration schema', async () => {
  const schemaPath = fileURLToPath(new URL('../server/src/schemas/ai.schema.ts', import.meta.url));
  const schema = await readFile(schemaPath, 'utf8');
  assert.match(schema, /AI_CONFIG_MAX_TOKENS = 4096/);
  assert.match(schema, /maxTokens:[\s\S]{0,160}\.max\(AI_CONFIG_MAX_TOKENS\)/);
  assert.match(schema, /AI_CONFIG_MAX_TIMEOUT_MS = 240_000/);
  assert.match(schema, /timeout:[\s\S]{0,100}\.max\(AI_CONFIG_MAX_TIMEOUT_MS\)/);
});
