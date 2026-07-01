#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { migrate, MigrationAbort } = require('../src/commands/migrate');

const USAGE = `keep-current — confidence reports for React major-version migrations

Usage:
  keep-current migrate --from <major> --to <major> <repo-path> [--allow-dirty]

Options:
  --from <n>      Current React major the repo is on (required)
  --to <n>        Target React major to migrate to (required)
  --allow-dirty   Proceed even if the working tree is dirty / not a git repo
  -h, --help      Show this help

Example:
  npx keep-current migrate --from 18 --to 19 ./apps/web

Exit codes: 0 = clean (nothing must-fix), 1 = must-fix items present, 2 = aborted.
`;

/** Minimal, dependency-free argv parser for the migrate command. */
function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    return { help: true };
  }

  const command = args[0];
  const opts = { allowDirty: false };
  const positionals = [];

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--from') {
      opts.from = Number(args[(i += 1)]);
    } else if (arg === '--to') {
      opts.to = Number(args[(i += 1)]);
    } else if (arg === '--allow-dirty') {
      opts.allowDirty = true;
    } else if (arg.startsWith('--')) {
      return { error: `Unknown flag: ${arg}` };
    } else {
      positionals.push(arg);
    }
  }

  opts.command = command;
  opts.repoPath = positionals[0];
  return opts;
}

function validate(opts) {
  const errors = [];
  if (opts.command !== 'migrate') errors.push(`Unknown command "${opts.command}" (only "migrate" is supported).`);
  if (!Number.isInteger(opts.from)) errors.push('--from <major> is required and must be an integer.');
  if (!Number.isInteger(opts.to)) errors.push('--to <major> is required and must be an integer.');
  if (!opts.repoPath) errors.push('A <repo-path> argument is required.');
  return errors;
}

function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (opts.error) {
    process.stderr.write(`✖ ${opts.error}\n\n${USAGE}`);
    process.exit(2);
  }

  const errors = validate(opts);
  if (errors.length) {
    process.stderr.write(`✖ ${errors.join('\n✖ ')}\n\n${USAGE}`);
    process.exit(2);
  }

  try {
    const { reportPath, summaryLine, summary } = migrate({
      from: opts.from,
      to: opts.to,
      repoPath: opts.repoPath,
      allowDirty: opts.allowDirty,
      onProgress: (msg) => process.stderr.write(`  ${msg}\n`),
    });

    const rel = path.relative(process.cwd(), reportPath) || reportPath;
    // e.g. "4 must-fix, 8 defer, 6 compatible — see ./keep-current-report.md"
    process.stdout.write(`\n${summaryLine} — see ./${rel}\n`);
    // Exit 1 only when there are "must fix before deploy" items (internal RED).
    process.exit(summary.totals.RED > 0 ? 1 : 0);
  } catch (err) {
    if (err instanceof MigrationAbort) {
      process.stderr.write(`\n✖ Aborted at "${err.stage}": ${err.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`\n✖ Unexpected error: ${err.stack || err.message}\n`);
    process.exit(2);
  }
}

main();
