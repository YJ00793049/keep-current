'use strict';

const path = require('node:path');
const { readJsoncFile } = require('../utils/read-json');
const { parseMajor } = require('../utils/version');

/**
 * Step 1 — Verify the repo is on the declared --from React version.
 * Reads package.json and confirms the installed/declared react major matches.
 *
 * @param {string} repoPath
 * @param {number} fromMajor
 * @returns {{ ok: boolean, currentReact: string|null, currentReactDom: string|null,
 *   currentMajor: number|null, fromMajor: number, reason: string|null }}
 */
function verify(repoPath, fromMajor) {
  const pkgPath = path.join(repoPath, 'package.json');
  const pkg = readJsoncFile(pkgPath);

  if (!pkg) {
    return fail(fromMajor, `No package.json found at ${pkgPath}.`);
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const currentReact = deps.react || null;
  const currentReactDom = deps['react-dom'] || null;

  if (!currentReact) {
    return fail(fromMajor, 'react is not listed in dependencies or devDependencies.');
  }

  const currentMajor = parseMajor(currentReact);
  if (currentMajor === null) {
    return fail(
      fromMajor,
      `Could not parse a major version from react "${currentReact}".`,
    );
  }

  if (currentMajor !== fromMajor) {
    return {
      ok: false,
      currentReact,
      currentReactDom,
      currentMajor,
      fromMajor,
      reason: `Repo declares react ${currentReact} (major ${currentMajor}), but --from is ${fromMajor}. ` +
        `Re-run with --from ${currentMajor}, or check out the pre-migration state.`,
    };
  }

  return {
    ok: true,
    currentReact,
    currentReactDom,
    currentMajor,
    fromMajor,
    reason: null,
  };
}

function fail(fromMajor, reason) {
  return {
    ok: false,
    currentReact: null,
    currentReactDom: null,
    currentMajor: null,
    fromMajor,
    reason,
  };
}

module.exports = { verify };
