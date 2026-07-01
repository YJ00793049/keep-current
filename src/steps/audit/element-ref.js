'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { listReactPeerPackages } = require('../../utils/node-modules');
const { runCommand } = require('../../utils/run-command');

// React 19 deprecated reaching into an element's `.ref`. Libraries like Radix
// UI do this (Slot reads `children.ref`). Scoped to identifiers that hold a
// React element so we don't match unrelated AST `.ref` usage in babel/esbuild.
const ELEMENT_REF_PATTERN =
  '\\b(children|child|element|reactElement)\\.ref\\b|\\bgetElementRef\\b|\\bgetNodeFromInstance\\b';

const BUILD_DIRS = ['dist', 'cjs', 'lib', 'build'];

/** True if ripgrep is available (fast path). */
function hasRipgrep() {
  return runCommand('rg', ['--version'], { timeout: 15 * 1000 }).ok;
}

/** Search a package's build dirs for the deprecated ref-access pattern. */
function scanPackage(info, useRg) {
  const searchDirs = BUILD_DIRS.map((d) => path.join(info.dir, d)).filter((d) =>
    fs.existsSync(d),
  );
  if (searchDirs.length === 0) return null;

  if (useRg) {
    const res = runCommand(
      'rg',
      ['-oN', '--no-messages', '-e', ELEMENT_REF_PATTERN, '-g', '!*.map', '-g', '!*.flow', ...searchDirs],
      { timeout: 60 * 1000 },
    );
    if (res.ok && res.stdout.trim()) {
      const tokens = [...new Set(res.stdout.trim().split('\n').map((l) => l.trim()))];
      return { tokens: tokens.slice(0, 5) };
    }
    return null;
  }

  // Fallback: Node-side scan (bounded).
  const re = new RegExp(ELEMENT_REF_PATTERN);
  const tokens = new Set();
  for (const dir of searchDirs) {
    for (const file of walk(dir)) {
      if (file.endsWith('.map') || file.endsWith('.flow')) continue;
      const text = safeRead(file);
      const m = text.match(new RegExp(ELEMENT_REF_PATTERN, 'g'));
      if (m) m.forEach((t) => tokens.add(t));
      if (tokens.size >= 5) break;
    }
  }
  return tokens.size ? { tokens: [...tokens].slice(0, 5) } : null;
}

function* walk(dir, depth = 0) {
  if (depth > 4) return;
  for (const entry of safeReaddir(dir)) {
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) yield* walk(full, depth + 1);
    else if (/\.(js|mjs|cjs|jsx)$/.test(entry)) yield full;
  }
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}
function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * ELEMENT.REF AUDIT.
 * Flags installed React libraries that reach into a React element's `.ref`.
 * These work today via React 19's compat shim but hard-fail on the next React
 * minor — classified AMBER (latent breakage).
 *
 * @param {string} repoPath
 * @returns {{ findings: object[], scanned: number, engine: string }}
 */
function auditElementRef(repoPath) {
  const candidates = listReactPeerPackages(repoPath);
  const useRg = hasRipgrep();
  const findings = [];

  for (const info of candidates) {
    const hit = scanPackage(info, useRg);
    if (hit) {
      findings.push({
        pkg: info.name,
        version: info.version,
        level: 'AMBER',
        tokens: hit.tokens,
        reason: `accesses a React element's .ref (${hit.tokens.join(', ')}); deprecated in React 19, removed in a future minor`,
        action: `Upgrade ${info.name} to a version that uses the ref-as-prop API, or confirm the maintainer's React 19 support.`,
      });
    }
  }

  findings.sort((a, b) => a.pkg.localeCompare(b.pkg));
  return { findings, scanned: candidates.length, engine: useRg ? 'ripgrep' : 'node' };
}

module.exports = { auditElementRef, ELEMENT_REF_PATTERN };
