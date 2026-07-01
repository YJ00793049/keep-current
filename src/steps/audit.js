'use strict';

const { auditPeerDeps } = require('./audit/peer-dep');
const { auditElementRef } = require('./audit/element-ref');
const { auditFalseGreen } = require('./audit/false-green');
const { auditBehavioral } = require('./audit/behavioral');

/**
 * Step 8 — Second-pass audit. The part no other tool does: empirically inspect
 * what install/test/typecheck left behind and classify the silent breakage.
 *
 * @param {object} ctx
 * @param {string} ctx.repoPath
 * @param {string} ctx.manager
 * @param {number} ctx.toMajor
 * @param {object} ctx.installStep   - output of steps/install.js
 * @param {object} ctx.testStep      - output of steps/test-runner.js
 * @param {object} ctx.typecheckStep - output of steps/typecheck.js
 * @returns {{ peerDep: object, elementRef: object, falseGreen: object, behavioral: object }}
 */
function audit(ctx) {
  const installOutput = ctx.installStep && ctx.installStep.result ? ctx.installStep.result.combined : '';
  const testOutput = ctx.testStep && ctx.testStep.result ? ctx.testStep.result.combined : '';

  const peerDep = auditPeerDeps({
    repoPath: ctx.repoPath,
    installOutput,
    manager: ctx.manager,
    toMajor: ctx.toMajor,
  });

  const elementRef = auditElementRef(ctx.repoPath);
  const falseGreen = auditFalseGreen(ctx.typecheckStep);
  const behavioral = auditBehavioral(testOutput);

  return { peerDep, elementRef, falseGreen, behavioral };
}

module.exports = { audit };
