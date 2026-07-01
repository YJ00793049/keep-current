'use strict';

const { runCommand } = require('../utils/run-command');
const { detectTsconfigType } = require('../utils/detect-tsconfig-type');

const TSC_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Count "error TSxxxx" occurrences in tsc output (a stable error signal across
 * tsc -b and tsc --noEmit).
 */
function countTsErrors(output) {
  const matches = output.match(/error TS\d+/g);
  return matches ? matches.length : 0;
}

/**
 * Step 7 — Run the REAL type-check.
 * - solution/reference config -> `tsc -b` is authoritative. We ALSO run
 *   `tsc --noEmit` so the audit can detect the false-green gap.
 * - standard config -> `tsc --noEmit` is the real check.
 * - no tsconfig -> skipped.
 *
 * @param {string} repoPath
 * @returns {{ ran: boolean, type: string, detection: object,
 *   command: string|null, ok: boolean, result: object|null,
 *   errorCount: number, noEmit: object|null }}
 */
function typecheck(repoPath) {
  const detection = detectTsconfigType(repoPath);

  if (detection.type === 'none') {
    return {
      ran: false,
      type: 'none',
      detection,
      command: null,
      ok: true,
      result: null,
      errorCount: 0,
      noEmit: null,
    };
  }

  if (detection.type === 'solution') {
    const real = runCommand('npx', ['tsc', '-b'], { cwd: repoPath, timeout: TSC_TIMEOUT_MS });
    const noEmitRun = runCommand('npx', ['tsc', '--noEmit'], { cwd: repoPath, timeout: TSC_TIMEOUT_MS });
    return {
      ran: true,
      type: 'solution',
      detection,
      command: 'npx tsc -b',
      ok: real.ok,
      result: real,
      errorCount: countTsErrors(real.combined),
      noEmit: {
        command: 'npx tsc --noEmit',
        ok: noEmitRun.ok,
        result: noEmitRun,
        errorCount: countTsErrors(noEmitRun.combined),
      },
    };
  }

  // standard config
  const real = runCommand('npx', ['tsc', '--noEmit'], { cwd: repoPath, timeout: TSC_TIMEOUT_MS });
  return {
    ran: true,
    type: 'standard',
    detection,
    command: 'npx tsc --noEmit',
    ok: real.ok,
    result: real,
    errorCount: countTsErrors(real.combined),
    noEmit: null,
  };
}

module.exports = { typecheck, countTsErrors };
