import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const angularWorkspace = JSON.parse(readFileSync(join(repoRoot, 'frontend/angular.json'), 'utf8'));
const frontendPackage = JSON.parse(readFileSync(join(repoRoot, 'frontend/package.json'), 'utf8'));
const testTarget = angularWorkspace.projects.hogaria.architect.test;

test('the standard Angular test target loads the repository Karma config', () => {
  assert.equal(testTarget.options.karmaConfig, 'karma.conf.js');
  assert.match(frontendPackage.scripts.test, /--code-coverage/);
  assert.match(frontendPackage.scripts['test:coverage'], /--code-coverage/);
});

test('Karma keeps the 80% gate and CI default while exposing a local Chrome launcher', () => {
  const require = createRequire(import.meta.url);
  const configureKarma = require('../frontend/karma.conf.js');
  let options;
  configureKarma({
    LOG_INFO: 'INFO',
    set(config) {
      options = config;
    }
  });

  assert.deepEqual(options.coverageReporter.check.global, {
    statements: 80,
    branches: 80,
    functions: 80,
    lines: 80
  });
  assert.deepEqual(options.browsers, ['ChromeHeadless']);
  assert.equal(options.customLaunchers?.ChromeHeadlessLocal?.base, 'ChromeHeadless');
  assert.ok(options.customLaunchers.ChromeHeadlessLocal.flags.includes('--use-angle=swiftshader'));
});

test('Karma can write coverage to an explicit temporary directory without changing its gate', () => {
  const require = createRequire(import.meta.url);
  const configureKarma = require('../frontend/karma.conf.js');
  const reportDirectory = join(repoRoot, 'tmp', 'synthetic-coverage');
  const previousDirectory = process.env.KARMA_COVERAGE_DIR;
  process.env.KARMA_COVERAGE_DIR = reportDirectory;
  try {
    let options;
    configureKarma({
      LOG_INFO: 'INFO',
      set(config) {
        options = config;
      }
    });
    assert.equal(options.coverageReporter.dir, resolve(reportDirectory));
    assert.deepEqual(options.coverageReporter.check.global, {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80
    });
  } finally {
    if (previousDirectory === undefined) delete process.env.KARMA_COVERAGE_DIR;
    else process.env.KARMA_COVERAGE_DIR = previousDirectory;
  }
});

test('the local frontend proxy uses explicit IPv4 loopback for API and health routes', () => {
  const proxy = JSON.parse(readFileSync(join(repoRoot, 'frontend/proxy.conf.json'), 'utf8'));

  assert.equal(proxy['/api'].target, 'http://127.0.0.1:3000');
  assert.equal(proxy['/health'].target, 'http://127.0.0.1:3000');
});
