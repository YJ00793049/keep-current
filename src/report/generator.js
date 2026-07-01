'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Fenced code block; falls back to a placeholder when empty. */
function fence(text, lang = '') {
  const body = (text || '').replace(/\s+$/, '');
  if (!body) return '_(no output)_\n';
  return '```' + lang + '\n' + body + '\n```\n';
}

function statusFromBool(ok) {
  return ok ? 'GREEN' : 'RED';
}

/** Count *.ts/tsx source files under src/ (for the "already clean" no-op count). */
function countSourceFiles(repoPath) {
  const srcDir = path.join(repoPath, 'src');
  let count = 0;
  const walk = (dir, depth = 0) => {
    if (depth > 8) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) count += 1;
    }
  };
  walk(srcDir);
  return count;
}

/** Compute the 4-row summary matrix and overall totals. */
function computeSummary(data) {
  const { steps, audit } = data;

  const deps = { GREEN: 0, AMBER: 0, RED: 0 };
  for (const f of audit.peerDep.findings) deps[f.level] += 1;

  // Type safety: one verdict.
  const tc = steps.typecheck;
  const typeRow = { GREEN: 0, AMBER: 0, RED: 0 };
  if (!tc.ran) {
    typeRow.GREEN = 1; // no TypeScript -> nothing to break
  } else if (!tc.ok) {
    typeRow.RED = 1;
  } else if (audit.falseGreen.finding) {
    typeRow.AMBER = 1;
  } else {
    typeRow.GREEN = 1;
  }

  // Tests: pass/fail.
  const testRow = { GREEN: 0, AMBER: 0, RED: 0 };
  if (steps.test.ran && steps.test.ok) testRow.GREEN = 1;
  else testRow.RED = 1;

  // Latent breakage: element.ref (AMBER) + behavioral (RED/AMBER).
  const latentRow = { GREEN: 0, AMBER: 0, RED: 0 };
  latentRow.AMBER += audit.elementRef.findings.length;
  for (const f of audit.behavioral.findings) latentRow[f.level] += 1;
  if (latentRow.AMBER === 0 && latentRow.RED === 0) latentRow.GREEN = 1;

  const rows = [
    { name: 'Dependencies', ...deps },
    { name: 'Type safety', ...typeRow },
    { name: 'Tests', ...testRow },
    { name: 'Latent breakage', ...latentRow },
  ];

  const totals = rows.reduce(
    (acc, r) => ({ GREEN: acc.GREEN + r.GREEN, AMBER: acc.AMBER + r.AMBER, RED: acc.RED + r.RED }),
    { GREEN: 0, AMBER: 0, RED: 0 },
  );

  return { rows, totals };
}

function summaryLine(totals) {
  return `${totals.GREEN} green, ${totals.AMBER} amber, ${totals.RED} red`;
}

// ---- section renderers ----

function renderHeader(data) {
  return [
    '# keep-current migration report',
    '',
    `**Target:** React ${data.fromMajor} → ${data.toMajor}`,
    `**Repo:** ${data.repoPath}`,
    `**Date:** ${data.date}`,
    `**Run time:** ${(data.runtimeMs / 1000).toFixed(1)}s`,
    '',
  ].join('\n');
}

function renderSummary(summary) {
  const lines = [
    '## Summary',
    '',
    '| Category | Green | Amber | Red |',
    '| --- | ---: | ---: | ---: |',
  ];
  for (const r of summary.rows) {
    lines.push(`| ${r.name} | ${r.GREEN} | ${r.AMBER} | ${r.RED} |`);
  }
  lines.push('');
  lines.push(`**Overall: ${summaryLine(summary.totals)}.**`);
  lines.push('');
  return lines.join('\n');
}

function renderCodemod(data) {
  const cm = data.steps.codemod;
  const changed = [...cm.changedFiles, ...cm.untrackedFiles];
  const lines = ['## What the codemod changed', ''];

  if (changed.length === 0) {
    lines.push('_No files were changed by the codemods (all no-ops, or the codemods could not run — see below)._');
  } else {
    for (const f of changed) lines.push(`- \`${f}\``);
  }
  lines.push('');

  for (const r of cm.results) {
    if (r.result.error) {
      lines.push(`> ⚠️ \`${r.name}\` could not run: ${r.result.error}`);
      lines.push('');
    }
  }

  const noOpCount = Math.max(0, (data.srcFileCount || 0) - changed.length);
  lines.push('## What was already clean (codemod no-ops)');
  lines.push('');
  lines.push(`${noOpCount} source file(s) under \`src/\` were left unmodified by the codemods.`);
  lines.push('');
  return lines.join('\n');
}

function renderDependencyAudit(audit) {
  const { findings } = audit.peerDep;
  const byLevel = (lvl) => findings.filter((f) => f.level === lvl);
  const lines = ['## Dependency audit', ''];

  const block = (title, items, emptyMsg) => {
    lines.push(`### ${title}`);
    lines.push('');
    if (items.length === 0) {
      lines.push(emptyMsg);
    } else {
      for (const f of items) {
        lines.push(`- **${f.pkg}@${f.version}** — ${f.reason} _(via ${f.source})_`);
        if (f.action) lines.push(`  - ↳ ${f.action}`);
      }
    }
    lines.push('');
  };

  block('RED — blocks migration', byLevel('RED'), '_None._');
  block('AMBER — works now, breaks later', byLevel('AMBER'), '_None._');
  block('GREEN — confirmed compatible', byLevel('GREEN'), '_None._');

  if (audit.peerDep.warningLines.length) {
    lines.push('<details><summary>Raw peer-dependency warnings from install</summary>');
    lines.push('');
    lines.push(fence(audit.peerDep.warningLines.join('\n')));
    lines.push('</details>');
    lines.push('');
  }
  return lines.join('\n');
}

function renderTypecheck(data) {
  const tc = data.steps.typecheck;
  const fg = data.audit.falseGreen.finding;
  const lines = ['## Type-check', ''];

  if (!tc.ran) {
    lines.push('GREEN — no TypeScript configuration found (nothing to check).');
    lines.push('');
    return lines.join('\n');
  }

  const status = tc.ok ? (fg ? 'AMBER' : 'GREEN') : 'RED';
  lines.push(`**${status}** — ran \`${tc.command}\` (${tc.detection.type} tsconfig), ${tc.errorCount} error(s).`);
  lines.push('');

  if (fg) {
    lines.push(`> ⚠️ **False green:** ${fg.reason}`);
    lines.push(`> ↳ ${fg.action}`);
    lines.push('');
    lines.push('`tsc --noEmit` output (the misleading green):');
    lines.push(fence(tc.noEmit.result.combined));
  }

  if (!tc.ok || fg) {
    lines.push(`\`${tc.command}\` output (the real check):`);
    lines.push(fence(tc.result.combined));
  }
  lines.push('');
  return lines.join('\n');
}

function renderTests(data) {
  const t = data.steps.test;
  const lines = ['## Test suite', ''];

  if (!t.ran) {
    lines.push(`**RED** — could not run tests: ${t.reason}`);
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`**${statusFromBool(t.ok)}** — ran \`${t.detection.command} ${t.detection.args.join(' ')}\` (${t.runner}).`);
  lines.push('');

  const behavioral = data.audit.behavioral.findings;
  if (behavioral.length) {
    lines.push('Deprecation warnings extracted from test output:');
    lines.push('');
    for (const f of behavioral) {
      lines.push(`- **${f.level}** ${f.label} (${f.count}×)`);
    }
    lines.push('');
  }

  lines.push('<details><summary>Full test output</summary>');
  lines.push('');
  lines.push(fence(t.result.combined));
  lines.push('</details>');
  lines.push('');
  return lines.join('\n');
}

function renderLatent(data) {
  const { elementRef, behavioral } = data.audit;
  const lines = ['## Latent breakage (the part other tools miss)', ''];

  lines.push('### element.ref access');
  lines.push('');
  if (elementRef.findings.length === 0) {
    lines.push(`_No installed React libraries reach into \`element.ref\`. (${elementRef.scanned} react-peer packages scanned via ${elementRef.engine}.)_`);
  } else {
    lines.push(`Scanned ${elementRef.scanned} react-peer packages (${elementRef.engine}). These reach into a React element's \`.ref\` — works today via React 19's compat shim, breaks on the next React minor:`);
    lines.push('');
    for (const f of elementRef.findings) {
      lines.push(`- **AMBER** \`${f.pkg}@${f.version}\` — ${f.reason}`);
      if (f.action) lines.push(`  - ↳ ${f.action}`);
    }
  }
  lines.push('');

  lines.push('### Behavioral deprecation warnings');
  lines.push('');
  if (behavioral.findings.length === 0) {
    lines.push('_No React deprecation/removal warnings found in test output._');
  } else {
    for (const f of behavioral.findings) {
      lines.push(`- **${f.level}** ${f.label} (${f.count}×)`);
      lines.push(`  - ↳ e.g. \`${f.sample}\``);
    }
  }
  lines.push('');

  const amber = elementRef.findings.length + behavioral.findings.filter((f) => f.level === 'AMBER').length;
  const red = behavioral.findings.filter((f) => f.level === 'RED').length;
  lines.push('### Forward-compatibility risk summary');
  lines.push('');
  lines.push(`${red} removed-API issue(s) and ${amber} deprecation time-bomb(s) detected. ` +
    (red > 0
      ? 'Removed-API issues are breaking now and must be fixed.'
      : amber > 0
        ? 'No removed-API breakage today, but the deprecation time-bombs will fail on a future React minor.'
        : 'No latent forward-compatibility risk detected.'));
  lines.push('');
  return lines.join('\n');
}

function renderNextSteps(data) {
  const { audit, steps } = data;
  const lines = ['## Recommended next steps', ''];
  const ordered = [];

  if (!steps.install.ok) {
    ordered.push(`Resolve the dependency install failure (\`${steps.install.command}\` exited non-zero). Do NOT use --force or --legacy-peer-deps — fix the underlying peer conflict.`);
  }
  for (const f of audit.peerDep.findings.filter((x) => x.level === 'RED')) {
    ordered.push(`Fix RED dependency **${f.pkg}@${f.version}**: ${f.action}`);
  }
  for (const f of audit.behavioral.findings.filter((x) => x.level === 'RED')) {
    ordered.push(`Fix removed-API usage: ${f.label}.`);
  }
  if (!steps.typecheck.ok && steps.typecheck.ran) {
    ordered.push(`Fix the ${steps.typecheck.errorCount} type error(s) reported by \`${steps.typecheck.command}\`.`);
  }
  if (audit.falseGreen.finding) {
    ordered.push(audit.falseGreen.finding.action);
  }
  for (const f of audit.elementRef.findings) {
    ordered.push(`Plan an upgrade for AMBER **${f.pkg}@${f.version}** (element.ref): ${f.action}`);
  }
  for (const f of audit.behavioral.findings.filter((x) => x.level === 'AMBER')) {
    ordered.push(`Address deprecation: ${f.label}.`);
  }

  if (ordered.length === 0) {
    lines.push('_Nothing to do — migration is genuinely clean._');
  } else {
    ordered.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  }
  lines.push('');
  return lines.join('\n');
}

function renderFixLog() {
  return ['## Fix log', '', '_Empty on first run. keep-current diagnoses in v1; auto-fix arrives in v2._', ''].join('\n');
}

/**
 * Step 9 — Build the full markdown report.
 * @returns {{ markdown: string, summary: object, summaryLine: string }}
 */
function generateReport(data) {
  const withCounts = { ...data, srcFileCount: data.srcFileCount ?? countSourceFiles(data.repoPath) };
  const summary = computeSummary(withCounts);

  const markdown = [
    renderHeader(withCounts),
    renderSummary(summary),
    renderCodemod(withCounts),
    renderDependencyAudit(withCounts.audit),
    renderTypecheck(withCounts),
    renderTests(withCounts),
    renderLatent(withCounts),
    renderNextSteps(withCounts),
    renderFixLog(),
  ].join('\n');

  return { markdown, summary, summaryLine: summaryLine(summary.totals) };
}

module.exports = { generateReport, computeSummary, countSourceFiles };
