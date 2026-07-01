'use strict';

const { spawnSync } = require('node:child_process');

// 50 MB — install/test logs can be large and we capture everything verbatim.
const MAX_BUFFER_BYTES = 50 * 1024 * 1024;

/**
 * Run a command and capture its output verbatim. Never throws on a non-zero
 * exit code — the exit code is returned as data so callers can decide what a
 * failure means (Rule 3/4: capture everything, paper over nothing).
 *
 * @param {string} command - executable to run (e.g. "npx", "git", "npm")
 * @param {string[]} [args] - argument list (kept as an array to avoid shell injection)
 * @param {object} [options]
 * @param {string} [options.cwd] - working directory
 * @param {object} [options.env] - environment overrides (merged over process.env)
 * @param {boolean} [options.shell] - run inside a shell (default false)
 * @param {number} [options.timeout] - ms before the child is killed
 * @returns {{
 *   command: string, code: number|null, signal: string|null,
 *   stdout: string, stderr: string, combined: string,
 *   durationMs: number, ok: boolean, error: string|null
 * }}
 */
function runCommand(command, args = [], options = {}) {
  const { cwd, env, shell = false, timeout } = options;
  const display = [command, ...args].join(' ');
  const startedAt = Date.now();

  const result = spawnSync(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    shell,
    timeout,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER_BYTES,
  });

  const durationMs = Date.now() - startedAt;
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  // spawnSync sets `error` for ENOENT (command missing), timeouts, etc.
  const error = result.error ? result.error.message : null;
  const code = typeof result.status === 'number' ? result.status : null;
  const signal = result.signal || null;

  return {
    command: display,
    code,
    signal,
    stdout,
    stderr,
    combined: stdout + (stdout && stderr ? '\n' : '') + stderr,
    durationMs,
    ok: error === null && code === 0,
    error,
  };
}

module.exports = { runCommand, MAX_BUFFER_BYTES };
