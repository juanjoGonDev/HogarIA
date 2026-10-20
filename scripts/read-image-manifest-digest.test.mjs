import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseManifestDigest } from './read-image-manifest-digest.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
const cliPath = fileURLToPath(new URL('./read-image-manifest-digest.mjs', import.meta.url));

test('extracts a sha256 digest from structured OCI manifest JSON', () => {
  assert.equal(
    parseManifestDigest(
      JSON.stringify({ digest, mediaType: 'application/vnd.oci.image.index.v1+json' })
    ),
    digest
  );
});

test('rejects malformed manifest JSON', () => {
  assert.throws(() => parseManifestDigest('{not-json'), /valid JSON/);
});

test('rejects missing or malformed manifest digests', () => {
  assert.throws(() => parseManifestDigest('{}'), /valid sha256 digest/);
  assert.throws(() => parseManifestDigest(JSON.stringify({ digest: 42 })), /valid sha256 digest/);
  assert.throws(
    () => parseManifestDigest(JSON.stringify({ digest: 'sha512:abc' })),
    /valid sha256 digest/
  );
  assert.throws(
    () => parseManifestDigest(JSON.stringify({ digest: `sha256:${'a'.repeat(63)}` })),
    /valid sha256 digest/
  );
});

test('CLI consumes the complete JSON input and prints the digest', () => {
  const result = spawnSync(process.execPath, [cliPath], {
    encoding: 'utf8',
    input: JSON.stringify({ digest, extra: 'x'.repeat(32_000) })
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${digest}\n`);
});

test('CLI fails clearly for invalid JSON instead of emitting a partial digest', () => {
  const result = spawnSync(process.execPath, [cliPath], { encoding: 'utf8', input: '{invalid' });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /valid JSON/);
});
