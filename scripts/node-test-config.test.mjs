import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const testConfigCommand = packageJson.scripts['test:config'];

test('test:config uses the Node 22 experimental test isolation flag', () => {
  assert.match(testConfigCommand, /(?:^|\s)--experimental-test-isolation=none(?:\s|$)/);
  assert.doesNotMatch(testConfigCommand, /(?:^|\s)--test-isolation=none(?:\s|$)/);
});
