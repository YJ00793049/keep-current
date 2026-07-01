# keep-current

Automates React major-version migrations and produces a **confidence report** that
catches what the official codemods mark "done" but isn't.

Every other tool says _"migration complete."_ keep-current says:
**here's what's actually broken, here's what's a time bomb, here's what's genuinely safe.**

```bash
npx keep-current migrate --from 18 --to 19 ./path/to/repo
```

## The problem it solves

The official `react/19/migration-recipe` + `types-react-codemod` preset-19 leave three
categories of silent breakage no existing tool catches:

1. **Swallowed peer-dep warnings** — yarn warns and installs anyway; npm ERESOLVE-blocks.
   Either way the real incompatibility is easy to miss.
2. **`element.ref` deprecation** — libraries like Radix UI 1.0.x reach into `element.ref`,
   which React 19 deprecated. Tests stay green today via a compat shim but hard-fail on the
   next React minor.
3. **`tsc --noEmit` false greens** — solution/reference `tsconfig.json` files check **0 files**
   under `--noEmit` and report success. Only `tsc -b` surfaces the real errors.

## What it does (v1)

Ten steps, in order:

1. **Verify** the repo is on the declared `--from` version (reads `package.json`).
2. **Snapshot** — confirm a clean git working tree (fails loudly if dirty and no `--allow-dirty`).
3. **Codemods** — runs `react/19/migration-recipe` and `types-react-codemod preset-19`, captures the diff.
4. **Bump** react / react-dom / @types to the target major (immutably rewrites `package.json`).
5. **Install** — npm or yarn (detected from the lockfile). **Never** `--force` / `--legacy-peer-deps`.
   If install fails without them, that _is_ the red — it's reported, not papered over.
6. **Test** — runs your existing suite once, no watch (`vitest` / `jest` / CRA `react-scripts`), captured verbatim.
7. **Type-check** — the _real_ one: `tsc -b` for solution configs, `tsc --noEmit` otherwise.
8. **Audit** — the second-pass analysis no other tool does (below).
9. **Report** — writes `keep-current-report.md`.
10. **Summary** — prints the report path and a one-line verdict.

## The audit (the part no other tool does)

Every finding is classified **RED** (blocks migration) / **AMBER** (works now, breaks later) /
**GREEN** (genuinely safe). All checks are **empirical** — nothing is hardcoded from memory.

- **Peer-dep audit** — for every direct dependency with a `react` peer, verifies the range against
  the target major via `npm view`. A package is only **RED** when reaching target support needs a
  **major** upgrade (e.g. `@testing-library/react` 15 → 16) or no compatible release exists at all
  (e.g. `react-helmet-async`). A conservative range that a **same-major** bump fixes is **AMBER**,
  not RED — because it works today.
- **element.ref audit** — scans installed React libraries (scoped to packages declaring a `react`
  peer, so babel/esbuild noise is excluded) for `element.ref` / `children.ref` / `getElementRef`
  access. Flagged **AMBER**: works via React 19's shim, breaks on the next minor.
- **False-green type audit** — on a solution config, runs `tsc -b` **and** `tsc --noEmit` and diffs
  them. If `--noEmit` is clean but `-b` errors, flags **AMBER**: _"`tsc --noEmit` is a false green on
  this repo — real errors only show under `tsc -b`."_
- **Behavioral audit** — mines test stderr for React deprecation/removal warnings
  (`ReactDOM.render` removed → RED; `defaultProps`, `element.ref`, `act()`, legacy lifecycles →
  AMBER). Breaks that surface as outright **test failures** are reported by the test step itself.

## Usage

```
keep-current migrate --from <major> --to <major> <repo-path> [--allow-dirty]

  --from <n>      Current React major the repo is on (required)
  --to <n>        Target React major to migrate to (required)
  --allow-dirty   Proceed even if the working tree is dirty / not a git repo
  -h, --help      Show help
```

**Exit codes:** `0` = clean (no RED findings) · `1` = RED findings present · `2` = aborted (bad
input or a failed precondition).

## Design rules

1. **Empirical only** — peer compatibility is always verified with `npm view` at runtime, never
   assumed. (Offline, it falls back to the installed `node_modules` artifact and classifies
   conservatively.)
2. **Tests are ground truth** — runs your existing tests and reports their real output. Never
   modifies a test to make it pass.
3. **Never `--force` / `--legacy-peer-deps`** — a failing install is a signal, not a problem to hide.
4. **Everything captured verbatim** — every step's stdout/stderr goes into the report.
5. **Fails loudly on ambiguity** — if it can't detect the package manager, test runner, or tsconfig
   type, it stops and tells you what it found, rather than guessing wrong.
6. **Diagnoses, doesn't fix** — the fix log starts empty. Auto-fix is v2.

## Requirements

- Node ≥ 18. Zero runtime dependencies (Node built-ins only).
- `git` (for the snapshot/diff steps). `ripgrep` is used for the element.ref scan when present;
  otherwise a built-in Node scan is used.

## Development

```bash
npm test          # node --test — unit + isolation tests for every step
```

## License

MIT
