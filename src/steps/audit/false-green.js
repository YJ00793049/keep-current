'use strict';

/**
 * FALSE-GREEN TYPE AUDIT.
 * On a solution/reference tsconfig, `tsc --noEmit` checks 0 files and reports
 * success while `tsc -b` surfaces the real errors. If --noEmit is clean but -b
 * is not, the repo's "green" type-check is a lie — flag it AMBER.
 *
 * @param {object} typecheckResult - output of steps/typecheck.js
 * @returns {{ finding: object|null }}
 */
function auditFalseGreen(typecheckResult) {
  if (!typecheckResult || typecheckResult.type !== 'solution' || !typecheckResult.noEmit) {
    return { finding: null };
  }

  const noEmit = typecheckResult.noEmit;
  const realErrors = typecheckResult.errorCount;
  const noEmitErrors = noEmit.errorCount;

  const isFalseGreen = noEmitErrors === 0 && noEmit.ok && realErrors > 0;

  if (!isFalseGreen) {
    return { finding: null };
  }

  return {
    finding: {
      level: 'AMBER',
      noEmitErrors,
      realErrors,
      reason:
        `tsc --noEmit reports 0 errors (false green) because this is a solution/reference config that checks 0 files, ` +
        `but tsc -b surfaces ${realErrors} real error(s).`,
      action: 'Use `tsc -b` (or `tsc --build`) for type-checking and in CI — never `tsc --noEmit` on this repo.',
    },
  };
}

module.exports = { auditFalseGreen };
