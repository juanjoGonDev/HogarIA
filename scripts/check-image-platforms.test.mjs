import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkImagePlatforms } from './check-image-platforms.mjs';

const index = (platforms) =>
  JSON.stringify({
    schemaVersion: 2,
    manifests: platforms.map(([os, architecture]) => ({ platform: { os, architecture } }))
  });

test('accepts a GHCR index containing the required Linux architectures', () => {
  const result = checkImagePlatforms(
    index([
      ['linux', 'amd64'],
      ['linux', 'arm64'],
      ['unknown', 'unknown']
    ])
  );

  assert.deepEqual(result, ['linux/amd64', 'linux/arm64']);
});

test('rejects an image missing a required platform', () => {
  assert.throws(
    () => checkImagePlatforms(index([['linux', 'amd64']])),
    /missing required platform: linux\/arm64/
  );
});

test('rejects malformed/non-index image manifests', () => {
  assert.throws(() => checkImagePlatforms('{'), /valid JSON/);
  assert.throws(() => checkImagePlatforms(JSON.stringify({ schemaVersion: 2 })), /manifest index/);
});
