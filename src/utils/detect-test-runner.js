'use strict';

const path = require('node:path');
const { readJsoncFile } = require('./read-json');

/**
 * Build the single-run, no-watch invocation for a given runner.
 * Everything runs through `npx` so we use the repo's locally-installed binary.
 */
function invocationFor(runner) {
  switch (runner) {
    case 'vitest':
      // `vitest run` is the non-watch single pass.
      return { command: 'npx', args: ['vitest', 'run'], env: { CI: 'true' } };
    case 'react-scripts':
      // CRA's jest wrapper. CI=true + --watchAll=false forces a single run.
      return {
        command: 'npx',
        args: ['react-scripts', 'test', '--watchAll=false'],
        env: { CI: 'true' },
      };
    case 'jest':
      return { command: 'npx', args: ['jest', '--ci'], env: { CI: 'true' } };
    default:
      return null;
  }
}

/**
 * Detect the test runner from package.json (test script first, then deps).
 * Fails loudly (ok:false) when no runner can be identified (Rule 5).
 *
 * @param {string} repoPath
 * @returns {{ ok: boolean, runner: string|null, command: string|null,
 *   args: string[]|null, env: object|null, source: string|null, reason: string|null }}
 */
function detectTestRunner(repoPath) {
  const pkg = readJsoncFile(path.join(repoPath, 'package.json'));
  if (!pkg) {
    return notFound('No package.json found at the repo root.');
  }

  const scripts = pkg.scripts || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const testScript = (scripts.test || '').toLowerCase();

  // 1) The test script is the strongest signal — it's what the repo actually runs.
  let runner = null;
  let source = null;
  if (/\bvitest\b/.test(testScript)) {
    runner = 'vitest';
    source = 'scripts.test';
  } else if (/react-scripts\s+test/.test(testScript)) {
    runner = 'react-scripts';
    source = 'scripts.test';
  } else if (/\bjest\b/.test(testScript)) {
    runner = 'jest';
    source = 'scripts.test';
  }

  // 2) Fall back to declared dependencies.
  if (!runner) {
    if (deps.vitest) {
      runner = 'vitest';
    } else if (deps['react-scripts']) {
      runner = 'react-scripts';
    } else if (deps.jest) {
      runner = 'jest';
    }
    if (runner) source = 'dependencies';
  }

  if (!runner) {
    return notFound(
      'Could not detect a test runner. Looked for vitest / jest / react-scripts ' +
        `in scripts.test ("${scripts.test || ''}") and dependencies.`,
    );
  }

  const invocation = invocationFor(runner);
  return {
    ok: true,
    runner,
    command: invocation.command,
    args: invocation.args,
    env: invocation.env,
    source,
    reason: null,
  };
}

function notFound(reason) {
  return {
    ok: false,
    runner: null,
    command: null,
    args: null,
    env: null,
    source: null,
    reason,
  };
}

module.exports = { detectTestRunner, invocationFor };
