'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { satisfiesMajor, parseMajor } = require('../src/utils/version');
const { parseInstallWarnings, classifyPeer } = require('../src/steps/audit/peer-dep');
const { auditBehavioral } = require('../src/steps/audit/behavioral');
const { auditFalseGreen } = require('../src/steps/audit/false-green');
const { computeSummary } = require('../src/report/generator');

// ---- version: satisfiesMajor ----

test('caret range pins the major (excludes the next)', () => {
  assert.equal(satisfiesMajor('^18.0.0', 18), true);
  assert.equal(satisfiesMajor('^18.0.0', 19), false);
});

test('OR ranges allow any listed major', () => {
  assert.equal(satisfiesMajor('^16.8 || ^17.0 || ^18.0', 19), false);
  assert.equal(satisfiesMajor('^16.8 || ^17.0 || ^18.0', 17), true);
});

test('open lower-bound range includes higher majors', () => {
  assert.equal(satisfiesMajor('>=18', 19), true);
  assert.equal(satisfiesMajor('>=18', 17), false);
});

test('star and empty ranges allow everything', () => {
  assert.equal(satisfiesMajor('*', 19), true);
  assert.equal(satisfiesMajor('', 19), true);
});

test('parseMajor pulls the leading major from a range', () => {
  assert.equal(parseMajor('^19.2.7'), 19);
  assert.equal(parseMajor('>=18'), 18);
});

// ---- peer-dep: parseInstallWarnings ----

test('parses yarn incorrect-peer-dependency warnings', () => {
  const out = 'warning "@radix-ui/react-dialog > @radix-ui/react-compose-refs@1.0.1" has incorrect peer dependency "react@^16.8 || ^17.0 || ^18.0".';
  const { names } = parseInstallWarnings(out, 'yarn');
  assert.ok(names.has('@radix-ui/react-compose-refs'));
});

test('parses npm ERESOLVE peer lines', () => {
  const out = [
    'npm error code ERESOLVE',
    'npm error Could not resolve dependency:',
    'npm error peer react@"^18.0.0" from @testing-library/react@15.0.6',
  ].join('\n');
  const { names } = parseInstallWarnings(out, 'npm');
  assert.ok(names.has('@testing-library/react'));
});

// ---- peer-dep: classifyPeer (the discriminating verdict) ----

test('GREEN when installed peer already includes the target', () => {
  // react-router@7: peer ">=18"
  const v = classifyPeer({ name: 'react-router', installedPeer: '>=18', installedMajor: 7, toMajor: 19, online: true });
  assert.equal(v.level, 'GREEN');
});

test('RED when target support requires a MAJOR upgrade', () => {
  // @testing-library/react@15 (peer ^18) -> latest 16.x supports react 19
  const v = classifyPeer({
    name: '@testing-library/react', installedPeer: '^18.0.0', installedMajor: 15,
    latestVersion: '16.1.0', latestPeer: '^18.0.0 || ^19.0.0', toMajor: 19, online: true,
  });
  assert.equal(v.level, 'RED');
  assert.match(v.reason, /MAJOR upgrade/);
});

test('AMBER when a same-major release adds target support', () => {
  // Radix dialog@1.0.5 (peer excludes 19) -> latest 1.1.x supports 19 (same major)
  const v = classifyPeer({
    name: '@radix-ui/react-dialog', installedPeer: '^16.8 || ^17.0 || ^18.0', installedMajor: 1,
    latestVersion: '1.1.6', latestPeer: '^16.8 || ^17.0 || ^18.0 || ^19.0', toMajor: 19, online: true,
  });
  assert.equal(v.level, 'AMBER');
  assert.match(v.reason, /non-breaking bump/);
});

test('RED when no published version supports the target', () => {
  // react-helmet-async@2.0.4 -> even latest excludes react 19
  const v = classifyPeer({
    name: 'react-helmet-async', installedPeer: '^16.6.0 || ^17.0.0 || ^18.0.0', installedMajor: 2,
    latestVersion: '2.0.5', latestPeer: '^16.6.0 || ^17.0.0 || ^18.0.0', toMajor: 19, online: true,
  });
  assert.equal(v.level, 'RED');
  assert.match(v.reason, /no published version/);
});

test('RED (conservative) when offline and installed peer excludes target', () => {
  const v = classifyPeer({ name: 'lucide-react', installedPeer: '^16 || ^17 || ^18', installedMajor: 0, toMajor: 19, online: false });
  assert.equal(v.level, 'RED');
  assert.match(v.reason, /registry unreachable/);
});

// ---- behavioral ----

test('classifies removed APIs as RED and deprecations as AMBER', () => {
  const out = [
    'Warning: ReactDOM.render is no longer supported in React 18.',
    'Warning: Support for defaultProps will be removed from function components.',
  ].join('\n');
  const { findings } = auditBehavioral(out);
  const red = findings.find((f) => f.level === 'RED');
  const amber = findings.find((f) => f.level === 'AMBER');
  assert.ok(red && /ReactDOM\.render/.test(red.label));
  assert.ok(amber && /defaultProps/.test(amber.label));
});

test('dedupes repeated warnings and counts them', () => {
  const out = Array(3).fill('Warning: Support for defaultProps will be removed.').join('\n');
  const { findings } = auditBehavioral(out);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].count, 3);
});

// ---- false-green ----

test('flags a solution config where noEmit is clean but -b errors', () => {
  const { finding } = auditFalseGreen({
    type: 'solution',
    ok: false,
    errorCount: 4,
    noEmit: { ok: true, errorCount: 0, result: { combined: '' } },
  });
  assert.ok(finding);
  assert.equal(finding.level, 'AMBER');
});

test('does not flag when both checks agree', () => {
  const { finding } = auditFalseGreen({
    type: 'solution',
    ok: true,
    errorCount: 0,
    noEmit: { ok: true, errorCount: 0, result: { combined: '' } },
  });
  assert.equal(finding, null);
});

// ---- summary matrix ----

test('computeSummary tallies the 4 rows and totals', () => {
  const summary = computeSummary({
    steps: {
      typecheck: { ran: true, ok: true },
      test: { ran: true, ok: true },
    },
    audit: {
      peerDep: { findings: [{ level: 'RED' }, { level: 'GREEN' }, { level: 'GREEN' }] },
      elementRef: { findings: [{ level: 'AMBER' }] },
      behavioral: { findings: [] },
      falseGreen: { finding: null },
    },
  });
  const deps = summary.rows.find((r) => r.name === 'Dependencies');
  assert.equal(deps.RED, 1);
  assert.equal(deps.GREEN, 2);
  assert.equal(summary.totals.RED, 1);
  assert.equal(summary.totals.AMBER, 1);
});
