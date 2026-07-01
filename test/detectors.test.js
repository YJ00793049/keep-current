'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { detectPackageManager } = require('../src/utils/detect-package-manager');
const { detectTestRunner } = require('../src/utils/detect-test-runner');
const { detectTsconfigType } = require('../src/utils/detect-tsconfig-type');

/** Create a throwaway repo dir with the given files ({ name: contents }). */
function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-fixture-'));
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), contents);
  }
  return dir;
}

// ---- detectPackageManager ----

test('detects yarn from yarn.lock', () => {
  const dir = makeRepo({ 'yarn.lock': '' });
  const result = detectPackageManager(dir);
  assert.equal(result.ok, true);
  assert.equal(result.manager, 'yarn');
});

test('detects npm from package-lock.json', () => {
  const dir = makeRepo({ 'package-lock.json': '{}' });
  const result = detectPackageManager(dir);
  assert.equal(result.ok, true);
  assert.equal(result.manager, 'npm');
});

test('fails loudly when no lockfile exists', () => {
  const dir = makeRepo({});
  const result = detectPackageManager(dir);
  assert.equal(result.ok, false);
  assert.match(result.reason, /No lockfile/);
});

test('fails loudly on conflicting lockfiles', () => {
  const dir = makeRepo({ 'yarn.lock': '', 'package-lock.json': '{}' });
  const result = detectPackageManager(dir);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Conflicting/);
});

test('fails loudly on unsupported pnpm', () => {
  const dir = makeRepo({ 'pnpm-lock.yaml': '' });
  const result = detectPackageManager(dir);
  assert.equal(result.ok, false);
  assert.match(result.reason, /only npm and yarn/);
});

// ---- detectTestRunner ----

test('detects vitest from the test script', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
  });
  const result = detectTestRunner(dir);
  assert.equal(result.ok, true);
  assert.equal(result.runner, 'vitest');
  assert.deepEqual(result.args, ['vitest', 'run']);
});

test('detects react-scripts (CRA jest) from the test script', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ scripts: { test: 'react-scripts test' } }),
  });
  const result = detectTestRunner(dir);
  assert.equal(result.runner, 'react-scripts');
  assert.equal(result.env.CI, 'true');
  assert.ok(result.args.includes('--watchAll=false'));
});

test('detects plain jest from the test script', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({ scripts: { test: 'jest --coverage' } }),
  });
  const result = detectTestRunner(dir);
  assert.equal(result.runner, 'jest');
});

test('falls back to dependencies when the test script is unhelpful', () => {
  const dir = makeRepo({
    'package.json': JSON.stringify({
      scripts: { test: 'echo no tests' },
      devDependencies: { vitest: '^2.0.0' },
    }),
  });
  const result = detectTestRunner(dir);
  assert.equal(result.runner, 'vitest');
  assert.equal(result.source, 'dependencies');
});

test('fails loudly when no test runner can be found', () => {
  const dir = makeRepo({ 'package.json': JSON.stringify({ scripts: {} }) });
  const result = detectTestRunner(dir);
  assert.equal(result.ok, false);
});

// ---- detectTsconfigType ----

test('classifies a references config as a solution config', () => {
  const dir = makeRepo({
    'tsconfig.json': JSON.stringify({
      files: [],
      references: [{ path: './tsconfig.app.json' }],
    }),
  });
  const result = detectTsconfigType(dir);
  assert.equal(result.type, 'solution');
  assert.equal(result.hasReferences, true);
});

test('classifies a normal config as standard', () => {
  const dir = makeRepo({
    'tsconfig.json': JSON.stringify({
      compilerOptions: { noEmit: true },
      include: ['src'],
    }),
  });
  const result = detectTsconfigType(dir);
  assert.equal(result.type, 'standard');
});

test('tolerates JSONC comments and trailing commas in tsconfig', () => {
  const dir = makeRepo({
    'tsconfig.json':
      '{\n  // a comment\n  "files": [],\n  "references": [{ "path": "./a" },],\n}',
  });
  const result = detectTsconfigType(dir);
  assert.equal(result.type, 'solution');
});

test('returns type none when there is no tsconfig', () => {
  const dir = makeRepo({});
  const result = detectTsconfigType(dir);
  assert.equal(result.type, 'none');
});
