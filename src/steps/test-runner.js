'use strict';

const { runCommand } = require('../utils/run-command');
const { detectTestRunner } = require('../utils/detect-test-runner');

const TEST_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Step 6 — Run the repo's EXISTING test suite, single run, no watch (Rule 2:
 * tests are ground truth; we never modify them). Output is captured verbatim
 * so the audit can mine stderr for React deprecation warnings.
 *
 * @param {string} repoPath
 * @returns {{ ok: boolean, ran: boolean, runner: string|null,
 *   detection: object, result: object|null, reason: string|null }}
 */
function runTests(repoPath) {
  const detection = detectTestRunner(repoPath);
  if (!detection.ok) {
    return {
      ok: false,
      ran: false,
      runner: null,
      detection,
      result: null,
      reason: detection.reason,
    };
  }

  const result = runCommand(detection.command, detection.args, {
    cwd: repoPath,
    env: detection.env,
    timeout: TEST_TIMEOUT_MS,
  });

  return {
    ok: result.ok,
    ran: true,
    runner: detection.runner,
    detection,
    result,
    reason: null,
  };
}

module.exports = { runTests };
