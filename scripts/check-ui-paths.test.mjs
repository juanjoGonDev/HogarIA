import assert from 'node:assert/strict';
import test from 'node:test';

import * as uiPaths from './check-ui-paths.mjs';

test('excludes a POSIX core i18n path', () => {
  assert.equal(uiPaths.isExcludedI18nCatalogPath('frontend/src/app/core/i18n/labels.ts'), true);
});

test('excludes a Windows core i18n path', () => {
  assert.equal(
    uiPaths.isExcludedI18nCatalogPath(
      String.raw`D:\projects\MiCocinAI\frontend\src\app\core\i18n\labels.ts`
    ),
    true
  );
});

test('does not exclude a source file outside core i18n', () => {
  assert.equal(
    uiPaths.isExcludedI18nCatalogPath(
      String.raw`D:\projects\MiCocinAI\frontend\src\app\features\pantry\pantry.component.ts`
    ),
    false
  );
});

test('excludes POSIX UI test fixtures from the visible-text scan', () => {
  assert.equal(typeof uiPaths.isExcludedUiTestSupportPath, 'function');
  assert.equal(
    uiPaths.isExcludedUiTestSupportPath(
      'frontend/src/app/core/interceptors/auth.interceptor.test-fixtures.ts'
    ),
    true
  );
});

test('excludes Windows UI test fixtures but keeps real screen sources', () => {
  assert.equal(
    uiPaths.isExcludedUiTestSupportPath(
      String.raw`D:\projects\MiCocinAI\frontend\src\app\core\interceptors\auth.interceptor.test-fixtures.ts`
    ),
    true
  );
  assert.equal(
    uiPaths.isExcludedUiTestSupportPath(
      String.raw`D:\projects\MiCocinAI\frontend\src\app\features\pantry\pantry.component.ts`
    ),
    false
  );
  assert.equal(
    uiPaths.isExcludedUiTestSupportPath(
      'frontend/src/app/features/pantry/pantry.component.spec.ts'
    ),
    true
  );
});
