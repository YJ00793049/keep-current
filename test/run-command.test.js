'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runCommand } = require('../src/utils/run-command');

test('captures stdout and reports ok on success', () => {
  // Arrange / Act
  const result = runCommand('node', ['-e', "process.stdout.write('hello')"]);

  // Assert
  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'hello');
  assert.equal(result.error, null);
});

test('captures stderr verbatim', () => {
  const result = runCommand('node', ['-e', "process.stderr.write('boom')"]);

  assert.equal(result.stderr, 'boom');
  assert.match(result.combined, /boom/);
});

test('returns non-zero exit code as data without throwing', () => {
  const result = runCommand('node', ['-e', 'process.exit(3)']);

  assert.equal(result.ok, false);
  assert.equal(result.code, 3);
  assert.equal(result.error, null);
});

test('reports error (not throw) when the command does not exist', () => {
  const result = runCommand('keep-current-this-binary-does-not-exist');

  assert.equal(result.ok, false);
  assert.notEqual(result.error, null);
});

test('runs in the provided cwd', () => {
  const result = runCommand('node', ['-e', 'process.stdout.write(process.cwd())'], {
    cwd: '/tmp',
  });

  assert.match(result.stdout, /tmp$/);
});

test('measures duration', () => {
  const result = runCommand('node', ['-e', '0']);
  assert.ok(result.durationMs >= 0);
});
