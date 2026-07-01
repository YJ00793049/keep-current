'use strict';

const { runCommand } = require('../utils/run-command');

// Codemods download via npx and can be slow; cap each so we never hang forever.
const CODEMOD_TIMEOUT_MS = 5 * 60 * 1000;

const CODEMODS = [
  {
    name: 'react/19/migration-recipe',
    command: 'npx',
    args: ['codemod@latest', 'react/19/migration-recipe', '--no-interactive', '--allow-dirty'],
  },
  {
    name: 'types-react-codemod preset-19',
    command: 'npx',
    args: ['types-react-codemod@latest', 'preset-19', './src', '--yes'],
  },
];

/**
 * Step 3 — Run the official React 19 codemods and capture what changed.
 *
 * @param {string} repoPath
 * @param {boolean} isGitRepo - from the snapshot step; enables diff capture
 * @returns {{ ok: boolean, results: object[], changedFiles: string[],
 *   untrackedFiles: string[], diff: string }}
 */
function runCodemods(repoPath, isGitRepo) {
  const results = CODEMODS.map(({ name, command, args }) => ({
    name,
    result: runCommand(command, args, { cwd: repoPath, timeout: CODEMOD_TIMEOUT_MS }),
  }));

  let changedFiles = [];
  let untrackedFiles = [];
  let diff = '';

  if (isGitRepo) {
    const named = runCommand('git', ['-C', repoPath, 'diff', '--name-only', '--', '.']);
    changedFiles = splitLines(named.stdout);

    const statusPorcelain = runCommand('git', ['-C', repoPath, 'status', '--porcelain', '--', '.']);
    untrackedFiles = splitLines(statusPorcelain.stdout)
      .filter((l) => l.startsWith('??'))
      .map((l) => l.replace(/^\?\?\s*/, ''));

    const fullDiff = runCommand('git', ['-C', repoPath, 'diff', '--', '.']);
    diff = fullDiff.stdout;
  }

  return {
    ok: results.every((r) => r.result.error === null),
    results,
    changedFiles,
    untrackedFiles,
    diff,
  };
}

function splitLines(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

module.exports = { runCodemods, CODEMODS };
