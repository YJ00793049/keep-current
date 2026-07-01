'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJsoncFile } = require('./read-json');

/**
 * Classify the root tsconfig.json so the type-check step runs the RIGHT command.
 *
 * - "solution" / reference config: has a non-empty `references` array, or
 *   `files: []`. These check 0 files under `tsc --noEmit` (the false-green trap)
 *   and only surface real errors under `tsc -b`.
 * - "standard": a normal config — `tsc --noEmit` is the correct check.
 * - "none": no tsconfig at the root (not a TypeScript project).
 *
 * @param {string} repoPath
 * @returns {{ ok: boolean, type: 'solution'|'standard'|'none',
 *   hasReferences: boolean, filesEmpty: boolean, references: string[],
 *   tsconfigPath: string|null, reason: string|null }}
 */
function detectTsconfigType(repoPath) {
  const tsconfigPath = path.join(repoPath, 'tsconfig.json');

  if (!fs.existsSync(tsconfigPath)) {
    return {
      ok: true,
      type: 'none',
      hasReferences: false,
      filesEmpty: false,
      references: [],
      tsconfigPath: null,
      reason: 'No tsconfig.json at repo root — not a TypeScript project.',
    };
  }

  let config;
  try {
    config = readJsoncFile(tsconfigPath);
  } catch (err) {
    return {
      ok: false,
      type: 'standard',
      hasReferences: false,
      filesEmpty: false,
      references: [],
      tsconfigPath,
      reason: `Failed to parse tsconfig.json: ${err.message}`,
    };
  }

  const references = Array.isArray(config.references)
    ? config.references.map((r) => (r && r.path) || String(r))
    : [];
  const hasReferences = references.length > 0;
  const filesEmpty = Array.isArray(config.files) && config.files.length === 0;

  const type = hasReferences || filesEmpty ? 'solution' : 'standard';

  return {
    ok: true,
    type,
    hasReferences,
    filesEmpty,
    references,
    tsconfigPath,
    reason: null,
  };
}

module.exports = { detectTsconfigType };
