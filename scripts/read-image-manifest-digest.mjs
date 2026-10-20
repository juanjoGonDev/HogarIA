import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function parseManifestDigest(json) {
  let manifest;
  try {
    manifest = JSON.parse(json);
  } catch {
    throw new Error('input is not valid JSON');
  }

  const digest = manifest?.digest;
  if (typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error('manifest does not contain a valid sha256 digest');
  }

  return digest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.stdout.write(`${parseManifestDigest(readFileSync(0, 'utf8'))}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`Unable to read OCI manifest digest: ${message}`);
    process.exitCode = 1;
  }
}
