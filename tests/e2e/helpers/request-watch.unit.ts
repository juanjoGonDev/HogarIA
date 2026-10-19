import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page, Request } from '@playwright/test';

import { redactRequestUrl, watchRequests } from './request-watch';

test('request-watch redacts credential query values but preserves diagnostic context', () => {
  const safe = redactRequestUrl(
    'https://example.test/api/shopping/stream/lists?access_token=do-not-print&from=2026-09-01'
  );

  assert.equal(
    safe,
    'https://example.test/api/shopping/stream/lists?access_token=REDACTED&from=2026-09-01'
  );
  assert.equal(safe.includes('do-not-print'), false);
});

test('request-watch also removes userinfo and common credential parameter aliases', () => {
  const safe = redactRequestUrl(
    'https://alice:password@example.test/?x-api-key=secret&refreshToken=private'
  );

  assert.equal(safe, 'https://example.test/?x-api-key=REDACTED&refreshToken=REDACTED');
  assert.equal(safe.includes('alice'), false);
  assert.equal(safe.includes('private'), false);
});

test('request-watch diagnostics redact credentials in repeated-request URLs', () => {
  const listeners = new Map<string, (request: Request) => void>();
  const page = {
    on: (event: string, callback: (request: Request) => void) => listeners.set(event, callback)
  } as unknown as Page;
  const watch = watchRequests(page);
  const request = {
    method: () => 'GET',
    url: () => 'https://example.test/api/shopping/stream/lists?access_token=do-not-print',
    frame: () => ({ url: () => 'https://example.test' })
  } as unknown as Request;

  for (let index = 0; index < 4; index += 1) listeners.get('request')?.(request);

  assert.equal(
    watch.entries()[0]?.url,
    'GET https://example.test/api/shopping/stream/lists?access_token=REDACTED'
  );
  const diagnostic = watch.describeProblems();
  assert.match(diagnostic, /access_token=REDACTED/);
  assert.equal(diagnostic.includes('do-not-print'), false);
});
