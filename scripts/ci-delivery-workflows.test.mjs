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
  assert.match(smoke, /Smoke Nginx cache and security headers[\s\S]*scripts\/nginx-static-headers-smoke\.mjs/);
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
  assert.match(dockerfile, /ARG HOGARIA_IMAGE_REVISION=dev/);
  assert.match(dockerfile, /ENV HOGARIA_IMAGE_REVISION=\$HOGARIA_IMAGE_REVISION/);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*curl -f http:\/\/localhost:3000\/health/);
});

test('publishes GHCR manifests from native architecture builds on the default branch', () => {
  const trigger = block(publish, /^on:\s*$/m, /^permissions:\s*$/m);
  const build = block(publish, /^  build:\s*$/m, /^  [A-Za-z0-9_-]+:\s*$/m);
  const manifest = block(publish, /^  publish-manifest:\s*$/m, /^  [A-Za-z0-9_-]+:\s*$/m);
  const smoke = block(publish, /^  smoke:\s*$/m, /^  [A-Za-z0-9_-]+:\s*$/m);

  assert.match(trigger, /push:\s*\n\s+branches:\s*\[master\]/);
  assert.doesNotMatch(trigger, /pull_request/);
  assert.match(publish, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
  assert.match(build, /arch:\s*amd64\s+platform:\s*linux\/amd64\s+runner:\s*ubuntu-24\.04\s/);
  assert.match(build, /arch:\s*arm64\s+platform:\s*linux\/arm64\s+runner:\s*ubuntu-24\.04-arm\s/);
  assert.match(build, /runs-on:\s*\$\{\{ matrix\.runner \}\}/);
  assert.match(build, /packages:\s*write/);
  assert.match(build, /github\.ref == 'refs\/heads\/master'/);
  assert.match(build, /docker\/login-action@v4/);
  assert.match(build, /docker\/build-push-action@v7/);
  assert.match(build, /platforms:\s*\$\{\{ matrix\.platform \}\}/);
  assert.match(build, /HOGARIA_IMAGE_REVISION=\$\{\{ github\.sha \}\}/);
  assert.match(build, /:\$\{\{ github\.sha \}\}-\$\{\{ matrix\.arch \}\}/);
  assert.match(build, /org\.opencontainers\.image\.revision=\$\{\{ github\.sha \}\}/);
  assert.match(build, /push:\s*true/);
  assert.match(build, /cache-to:.*ignore-error=true/);
  assert.doesNotMatch(publish, /setup-qemu-action/);
  assert.doesNotMatch(publish, /^\s+GITHUB_SHA:/m);
  assert.match(manifest, /needs:\s*\[build\]/);
  assert.match(manifest, /packages:\s*write/);
  assert.match(
    manifest,
    /docker buildx imagetools create[\s\S]*--tag "\$IMAGE:\$COMMIT_SHA"[\s\S]*--tag "\$IMAGE:latest"[\s\S]*"\$IMAGE:\$\{COMMIT_SHA\}-amd64"[\s\S]*"\$IMAGE:\$\{COMMIT_SHA\}-arm64"/
  );
  assert.match(
    manifest,
    /docker buildx imagetools inspect --format '\{\{json \.Manifest\}\}' "\$IMAGE:\$COMMIT_SHA" \\\s*\| node scripts\/read-image-manifest-digest\.mjs/
  );
  assert.match(
    manifest,
    /docker buildx imagetools inspect --format '\{\{json \.Manifest\}\}' "\$IMAGE:\$tag" \\\s*\| node scripts\/read-image-manifest-digest\.mjs/
  );
  assert.equal((manifest.match(/read-image-manifest-digest\.mjs/g) ?? []).length, 2);
  assert.match(
    manifest,
    /for tag in "\$COMMIT_SHA" latest; do[\s\S]*"\$actual_digest" != "\$EXPECTED_DIGEST"/
  );
  assert.doesNotMatch(manifest, /awk/);
  assert.match(manifest, /scripts\/check-image-platforms\.mjs/);
  assert.match(
    manifest,
    /imagetools inspect --raw "\$IMAGE:\$tag" \| node scripts\/check-image-platforms\.mjs/
  );
  assert.match(manifest, /EXPECTED_DIGEST:\s*\$\{\{ steps\.manifest\.outputs\.digest \}\}/);
  assert.match(smoke, /needs:\s*\[publish-manifest\]/);
  assert.match(smoke, /arch:\s*amd64\s+platform:\s*linux\/amd64\s+runner:\s*ubuntu-24\.04\s/);
  assert.match(smoke, /arch:\s*arm64\s+platform:\s*linux\/arm64\s+runner:\s*ubuntu-24\.04-arm\s/);
  assert.match(smoke, /runs-on:\s*\$\{\{ matrix\.runner \}\}/);
  assert.match(smoke, /packages:\s*read/);
  assert.match(smoke, /docker pull --platform "\$PLATFORM"/);
  assert.match(smoke, /EXPECTED_IMAGE_REVISION:\s*\$\{\{ github\.sha \}\}/);
  assert.match(smoke, /scripts\/container-smoke\.mjs/);
  assert.match(smoke, /docker inspect --format='\{\{\.State\.Health\.Status\}\}'/);
  assert.doesNotMatch(publish, /pull_request_target/);
});
