'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { verify } = require('../steps/verify');
const { snapshot } = require('../steps/snapshot');
const { runCodemods } = require('../steps/codemod');
const { bump } = require('../steps/bump');
const { install } = require('../steps/install');
const { runTests } = require('../steps/test-runner');
const { typecheck } = require('../steps/typecheck');
const { audit } = require('../steps/audit');
const { generateReport } = require('../report/generator');

const { detectPackageManager } = require('../utils/detect-package-manager');
const { detectTestRunner } = require('../utils/detect-test-runner');
const { detectTsconfigType } = require('../utils/detect-tsconfig-type');

const REPORT_FILENAME = 'keep-current-report.md';

/** Thrown for loud, pre-mutation aborts (Rule 5). */
class MigrationAbort extends Error {
  constructor(stage, reason) {
    super(reason);
    this.stage = stage;
  }
}

/**
 * Orchestrate the 10-step migration + audit pipeline.
 *
 * @param {object} opts
 * @param {number} opts.from
 * @param {number} opts.to
 * @param {string} opts.repoPath
 * @param {boolean} [opts.allowDirty]
 * @param {(msg: string) => void} [opts.onProgress]
 * @returns {{ reportPath: string, summaryLine: string, summary: object }}
 */
function migrate(opts) {
  const onProgress = opts.onProgress || (() => {});
  const repoPath = path.resolve(opts.repoPath);
  const fromMajor = opts.from;
  const toMajor = opts.to;
  const startedAt = Date.now();

  if (!fs.existsSync(repoPath)) {
    throw new MigrationAbort('input', `Repo path does not exist: ${repoPath}`);
  }

  // ---- Preflight (read-only). Fail loudly before mutating anything. ----
  onProgress(`Step 1/10 — verifying repo is on React ${fromMajor}…`);
  const verifyStep = verify(repoPath, fromMajor);
  if (!verifyStep.ok) throw new MigrationAbort('verify', verifyStep.reason);

  onProgress('Step 2/10 — checking working tree is clean…');
  const snapshotStep = snapshot(repoPath, !!opts.allowDirty);
  if (!snapshotStep.ok) throw new MigrationAbort('snapshot', snapshotStep.reason);

  onProgress('Detecting package manager, test runner, tsconfig…');
  const pm = detectPackageManager(repoPath);
  if (!pm.ok) throw new MigrationAbort('detect-package-manager', pm.reason);
  const runner = detectTestRunner(repoPath);
  if (!runner.ok) throw new MigrationAbort('detect-test-runner', runner.reason);
  const tsconfig = detectTsconfigType(repoPath);
  if (!tsconfig.ok) throw new MigrationAbort('detect-tsconfig', tsconfig.reason);

  // ---- Mutation + measurement steps. These capture data; they don't abort. ----
  onProgress('Step 3/10 — running official React 19 codemods…');
  const codemodStep = runCodemods(repoPath, snapshotStep.isGitRepo);

  onProgress(`Step 4/10 — bumping react/react-dom to ${toMajor} in package.json…`);
  const bumpStep = bump(repoPath, toMajor);

  onProgress(`Step 5/10 — installing dependencies with ${pm.manager}…`);
  const installStep = install(repoPath, pm.manager);

  onProgress('Step 6/10 — running the existing test suite…');
  const testStep = runTests(repoPath);

  onProgress('Step 7/10 — running the real type-check…');
  const typecheckStep = typecheck(repoPath);

  onProgress('Step 8/10 — running the second-pass audit…');
  const auditResult = audit({
    repoPath,
    manager: pm.manager,
    toMajor,
    installStep,
    testStep,
    typecheckStep,
  });

  onProgress('Step 9/10 — generating the confidence report…');
  const reportData = {
    fromMajor,
    toMajor,
    repoPath,
    date: new Date().toISOString(),
    runtimeMs: Date.now() - startedAt,
    packageManager: pm,
    steps: {
      verify: verifyStep,
      snapshot: snapshotStep,
      codemod: codemodStep,
      bump: bumpStep,
      install: installStep,
      test: testStep,
      typecheck: typecheckStep,
    },
    audit: auditResult,
  };

  const { markdown, summary, summaryLine } = generateReport(reportData);
  const reportPath = path.join(repoPath, REPORT_FILENAME);
  fs.writeFileSync(reportPath, markdown);

  onProgress('Step 10/10 — done.');
  return { reportPath, summaryLine, summary };
}

module.exports = { migrate, MigrationAbort, REPORT_FILENAME };
