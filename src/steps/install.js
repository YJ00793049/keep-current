'use strict';

const { runCommand } = require('../utils/run-command');

const INSTALL_TIMEOUT_MS = 8 * 60 * 1000;

/** Is a global `yarn` binary available? */
function hasGlobalYarn() {
  return runCommand('yarn', ['--version'], { timeout: 30 * 1000 }).ok;
}

/**
 * Build the install invocation for a manager.
 * RULE 3: never pass --force or --legacy-peer-deps. If install fails without
 * them, THAT is the red — we report it, we do not paper over it.
 */
function installInvocation(manager) {
  if (manager === 'npm') {
    return { command: 'npm', args: ['install'], env: null };
  }
  // yarn — use the global binary if present, otherwise run via npx.
  if (hasGlobalYarn()) {
    return { command: 'yarn', args: ['install'], env: null };
  }
  return {
    command: 'npx',
    args: ['--yes', 'yarn', 'install'],
    // Stop corepack/npx from interactively prompting in CI-style runs.
    env: { COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
  };
}

/**
 * Step 5 — Install dependencies and capture the output verbatim.
 *
 * @param {string} repoPath
 * @param {string} manager - 'npm' | 'yarn'
 * @returns {{ ok: boolean, manager: string, command: string, result: object }}
 */
function install(repoPath, manager) {
  const { command, args, env } = installInvocation(manager);
  const result = runCommand(command, args, {
    cwd: repoPath,
    env,
    timeout: INSTALL_TIMEOUT_MS,
  });
  return { ok: result.ok, manager, command: result.command, result };
}

module.exports = { install, installInvocation };
