'use strict';

// React deprecation / removal signals that surface in test stderr.
// RED = removed API (already broken behavior); AMBER = deprecation shim (works now, breaks later).
const RULES = [
  { re: /ReactDOM\.render is no longer supported/i, level: 'RED', label: 'ReactDOM.render was removed — use createRoot()' },
  { re: /ReactDOM\.hydrate is no longer supported/i, level: 'RED', label: 'ReactDOM.hydrate was removed — use hydrateRoot()' },
  { re: /unmountComponentAtNode/i, level: 'RED', label: 'unmountComponentAtNode was removed — use root.unmount()' },
  { re: /react-test-renderer is deprecated/i, level: 'RED', label: 'react-test-renderer is deprecated/removed in React 19' },
  { re: /Accessing element\.ref.*no longer supported|element\.ref was removed|ref is now a regular prop/i, level: 'AMBER', label: 'element.ref access deprecated — breaks on a future React minor' },
  { re: /defaultProps will be removed|Support for defaultProps/i, level: 'AMBER', label: 'defaultProps on function components removed in React 19' },
  { re: /not wrapped in act\(|act\(\.\.\.\) is not supported|wrap-tests-with-act/i, level: 'AMBER', label: 'act() warning — test will break under stricter React' },
  { re: /findDOMNode (is deprecated|was removed)/i, level: 'AMBER', label: 'findDOMNode deprecated/removed' },
  { re: /UNSAFE_componentWill|componentWillMount|componentWillReceiveProps|componentWillUpdate/i, level: 'AMBER', label: 'Legacy lifecycle method — deprecated' },
  { re: /string ref|Component .* contains the string ref/i, level: 'AMBER', label: 'String refs deprecated' },
  { re: /Legacy context API/i, level: 'AMBER', label: 'Legacy context API deprecated' },
];

/** Collapse whitespace and trim a line for stable de-duplication. */
function normalize(line) {
  return line.replace(/\s+/g, ' ').trim();
}

/**
 * BEHAVIORAL AUDIT.
 * Mine captured test output (stdout+stderr) for React deprecation/removal
 * warnings the green test run papered over.
 *
 * @param {string} testOutput - verbatim combined test output
 * @returns {{ findings: object[] }}
 */
function auditBehavioral(testOutput) {
  if (!testOutput) return { findings: [] };

  const byKey = new Map();
  for (const rawLine of testOutput.split('\n')) {
    const line = normalize(rawLine);
    if (!line) continue;

    let matched = false;
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        addFinding(byKey, rule.level, rule.label, line);
        matched = true;
        break;
      }
    }

    // Catch-all: a React "Warning:" we don't have a specific rule for.
    if (!matched && /\bWarning:\s/.test(line) && /react/i.test(line)) {
      addFinding(byKey, 'AMBER', 'Unclassified React warning', line);
    }
  }

  const findings = [...byKey.values()];
  const rank = { RED: 0, AMBER: 1 };
  findings.sort((a, b) => rank[a.level] - rank[b.level]);
  return { findings };
}

function addFinding(byKey, level, label, sample) {
  const key = `${level}::${label}`;
  if (byKey.has(key)) {
    byKey.get(key).count += 1;
    return;
  }
  byKey.set(key, {
    level,
    label,
    sample: sample.slice(0, 300),
    count: 1,
  });
}

module.exports = { auditBehavioral, RULES };
