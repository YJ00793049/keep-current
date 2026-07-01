'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJsoncFile } = require('../utils/read-json');
const { runCommand } = require('../utils/run-command');

const REACT_PACKAGES = ['react', 'react-dom', '@types/react', '@types/react-dom'];

/**
 * Resolve the latest published version for a package at a given major.
 * Empirical (npm view) with a sane fallback range if offline.
 */
function resolveTargetRange(pkgName, toMajor) {
  const view = runCommand('npm', ['view', `${pkgName}@^${toMajor}.0.0`, 'version'], {
    timeout: 60 * 1000,
  });
  if (view.ok && view.stdout.trim()) {
    // npm may print multiple lines ("pkg@x 'ver'"); take the last concrete version.
    const versions = view.stdout
      .trim()
      .split('\n')
      .map((l) => {
        const m = l.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)\s*$/);
        return m ? m[1] : null;
      })
      .filter(Boolean);
    if (versions.length) return `^${versions[versions.length - 1]}`;
  }
  return `^${toMajor}.0.0`;
}

/**
 * Detect indentation used in a JSON file so we rewrite it consistently.
 */
function detectIndent(text) {
  const m = text.match(/^[ \t]+/m);
  return m ? m[0] : '  ';
}

/**
 * Step 4 — Bump react, react-dom and their @types to the target major in
 * package.json. Immutable: a NEW package object is built and written; the
 * in-memory original is never mutated.
 *
 * @param {string} repoPath
 * @param {number} toMajor
 * @returns {{ ok: boolean, bumped: object[], skipped: string[], reason: string|null }}
 */
function bump(repoPath, toMajor) {
  const pkgPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { ok: false, bumped: [], skipped: [], reason: `No package.json at ${pkgPath}.` };
  }

  const raw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = readJsoncFile(pkgPath);
  const indent = detectIndent(raw);

  const nextDeps = { ...(pkg.dependencies || {}) };
  const nextDevDeps = { ...(pkg.devDependencies || {}) };
  const bumped = [];
  const skipped = [];

  for (const name of REACT_PACKAGES) {
    const target = resolveTargetRange(name, toMajor);
    if (Object.prototype.hasOwnProperty.call(nextDeps, name)) {
      bumped.push({ name, from: nextDeps[name], to: target, location: 'dependencies' });
      nextDeps[name] = target;
    } else if (Object.prototype.hasOwnProperty.call(nextDevDeps, name)) {
      bumped.push({ name, from: nextDevDeps[name], to: target, location: 'devDependencies' });
      nextDevDeps[name] = target;
    } else {
      skipped.push(name);
    }
  }

  // Build a new package object immutably, preserving key order where present.
  const nextPkg = { ...pkg };
  if (pkg.dependencies) nextPkg.dependencies = nextDeps;
  if (pkg.devDependencies) nextPkg.devDependencies = nextDevDeps;

  fs.writeFileSync(pkgPath, JSON.stringify(nextPkg, null, indent) + '\n');

  return { ok: bumped.length > 0, bumped, skipped, reason: null };
}

module.exports = { bump, REACT_PACKAGES, resolveTargetRange };
