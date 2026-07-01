'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Lockfile -> package manager. Order is also the report/preference order.
const LOCKFILES = [
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'package-lock.json', manager: 'npm' },
  { file: 'npm-shrinkwrap.json', manager: 'npm' },
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
];

// Only npm and yarn are supported install targets in v1.
const SUPPORTED = new Set(['npm', 'yarn']);

/**
 * Detect the package manager from the repo's lockfile(s).
 * Fails loudly (ok:false) on ambiguity: no lockfile, conflicting lockfiles,
 * or an unsupported manager (Rule 5 — never guess wrong silently).
 *
 * @param {string} repoPath
 * @returns {{ ok: boolean, manager: string|null, lockfile: string|null,
 *   found: string[], reason: string|null }}
 */
function detectPackageManager(repoPath) {
  const found = LOCKFILES.filter(({ file }) =>
    fs.existsSync(path.join(repoPath, file)),
  );

  if (found.length === 0) {
    return {
      ok: false,
      manager: null,
      lockfile: null,
      found: [],
      reason:
        'No lockfile found (looked for yarn.lock, package-lock.json, npm-shrinkwrap.json, pnpm-lock.yaml). ' +
        'Cannot determine the package manager — run an install first or commit your lockfile.',
    };
  }

  const managers = [...new Set(found.map((f) => f.manager))];
  if (managers.length > 1) {
    return {
      ok: false,
      manager: null,
      lockfile: null,
      found: found.map((f) => f.file),
      reason: `Conflicting lockfiles found (${found
        .map((f) => f.file)
        .join(', ')}). Remove all but one so the package manager is unambiguous.`,
    };
  }

  const { manager } = found[0];
  if (!SUPPORTED.has(manager)) {
    return {
      ok: false,
      manager,
      lockfile: found[0].file,
      found: found.map((f) => f.file),
      reason: `Detected ${manager} (${found[0].file}) but only npm and yarn are supported in v1.`,
    };
  }

  return {
    ok: true,
    manager,
    lockfile: found[0].file,
    found: found.map((f) => f.file),
    reason: null,
  };
}

module.exports = { detectPackageManager, LOCKFILES };
