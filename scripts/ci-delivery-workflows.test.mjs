import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const publish = readFileSync(
  new URL('../.github/workflows/publish-ghcr.yml', import.meta.url),
  'utf8'
);
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

function block(source, startPattern, nextTopLevelPattern) {
  const start = source.search(startPattern);
  assert.notEqual(start, -1, `missing block ${startPattern}`);
  const rest = source.slice(start);
  const end = rest.slice(1).search(nextTopLevelPattern);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

test('runs the existing CI for PRs targeting any base and on base edits', () => {
  const trigger = block(ci, /^  pull_request:\s*$/m, /^  [A-Za-z0-9_-]+:\s*$/m);

  assert.doesNotMatch(trigger, /^\s+branches:/m);
  assert.match(
    trigger,
    /types:\s*\[[^\]]*opened[^\]]*reopened[^\]]*synchronize[^\]]*ready_for_review[^\]]*edited/
  );
});

test('builds and smokes both PR image architectures without registry writes or secrets', () => {
  const smoke = block(ci, /^  container-smoke:\s*$/m, /^  [A-Za-z0-9_-]+:\s*$/m);

  assert.match(ci, /^permissions:\s*read-all\s*$/m);
  assert.doesNotMatch(ci, /packages:\s*write/);
  assert.doesNotMatch(smoke, /docker\/login-action/);
  assert.match(smoke, /platform:\s*linux\/amd64[\s\S]*platform:\s*linux\/arm64/);
  assert.match(smoke, /platforms:\s*\$\{\{ matrix\.platform \}\}/);
  assert.match(smoke, /push:\s*false/);
  assert.match(smoke, /load:\s*true/);
  assert.match(smoke, /cache-to:.*ignore-error=true/);
  assert.match(smoke, /scripts\/container-smoke\.mjs/);
  assert.match(smoke, /docker inspect --format='\{\{\.State\.Health\.Status\}\}'/);
});

test('compiles once natively and installs native production modules for the image target', () => {
  assert.match(dockerfile, /^FROM --platform=\$BUILDPLATFORM node:22-alpine AS build$/m);
  assert.match(dockerfile, /^FROM node:22-alpine AS runtime-deps$/m);
  assert.match(
    dockerfile,
    /CI=true pnpm install --filter @hogaria\/server --prod --frozen-lockfile/
  );
  assert.match(dockerfile, /pnpm --filter @hogaria\/server --prod deploy --legacy/);
  assert.match(dockerfile, /COPY --from=runtime-deps \/prod\/server\/node_modules/);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*curl -f http:\/\/localhost:3000\/health/);
});

test('publishes multi-arch GHCR images only from the default branch with scoped write access', () => {
  const trigger = block(publish, /^on:\s*$/m, /^permissions:\s*$/m);
  const job = block(publish, /^  publish:\s*$/m, /^  [A-Za-z0-9_-]+:\s*$/m);

  assert.match(trigger, /push:\s*\n\s+branches:\s*\[master\]/);
  assert.doesNotMatch(trigger, /pull_request/);
  assert.match(publish, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
  assert.match(job, /packages:\s*write/);
  assert.match(job, /github\.ref == 'refs\/heads\/master'/);
  assert.match(job, /docker\/login-action@v4/);
  assert.match(job, /docker\/build-push-action@v7/);
  assert.match(job, /platforms:\s*linux\/amd64,linux\/arm64/);
  assert.match(job, /push:\s*true/);
  assert.match(job, /cache-to:.*ignore-error=true/);
  assert.match(job, /github\.sha/);
  assert.match(job, /:latest/);
  assert.match(job, /scripts\/check-image-platforms\.mjs/);
  assert.match(job, /scripts\/container-smoke\.mjs/);
  assert.match(job, /docker inspect --format='\{\{\.State\.Health\.Status\}\}'/);
  assert.doesNotMatch(publish, /pull_request_target/);
});
