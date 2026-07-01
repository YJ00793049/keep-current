'use strict';

const { runCommand } = require('../utils/run-command');

/**
 * Step 2 — Snapshot / clean-tree check.
 * We do NOT auto-stash (that would surprise the user); we confirm the working
 * tree is clean so the codemod diff is attributable, and fail loudly if it is
 * dirty without --allow-dirty.
 *
 * Scoped to the repo subtree (pathspec ".") so a clean app inside a dirty
 * monorepo is still considered clean.
 *
 * @param {string} repoPath
 * @param {boolean} allowDirty
 * @returns {{ ok: boolean, isGitRepo: boolean, clean: boolean,
 *   dirtyFiles: string[], reason: string|null }}
 */
function snapshot(repoPath, allowDirty) {
  const insideTree = runCommand(
    'git',
    ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'],
  );
  const isGitRepo = insideTree.ok && insideTree.stdout.trim() === 'true';

  if (!isGitRepo) {
    if (allowDirty) {
      return {
        ok: true,
        isGitRepo: false,
        clean: false,
        dirtyFiles: [],
        reason: 'Not a git repository — cannot snapshot, proceeding because --allow-dirty was passed.',
      };
    }
    return {
      ok: false,
      isGitRepo: false,
      clean: false,
      dirtyFiles: [],
      reason: 'Not a git repository, so the working tree cannot be snapshotted or rolled back. ' +
        'Initialize git (so changes are recoverable) or re-run with --allow-dirty to proceed anyway.',
    };
  }

  const status = runCommand('git', ['-C', repoPath, 'status', '--porcelain', '--', '.']);
  const dirtyFiles = status.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const clean = dirtyFiles.length === 0;

  if (!clean && !allowDirty) {
    return {
      ok: false,
      isGitRepo: true,
      clean: false,
      dirtyFiles,
      reason: `Working tree is dirty (${dirtyFiles.length} change(s)). Commit or stash your work, ` +
        'or re-run with --allow-dirty. Refusing to run codemods over uncommitted changes.',
    };
  }

  return {
    ok: true,
    isGitRepo: true,
    clean,
    dirtyFiles,
    reason: clean ? null : `Proceeding over ${dirtyFiles.length} uncommitted change(s) because --allow-dirty was passed.`,
  };
}

module.exports = { snapshot };
