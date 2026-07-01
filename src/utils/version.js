'use strict';

/**
 * Tiny, dependency-free semver helpers operating at MAJOR-version granularity.
 * This is deliberately not a full semver implementation — we only ever need to
 * answer "does this peer range allow React major N?" for migration decisions.
 */

/** Extract the major version integer from a version or range string. */
function parseMajor(range) {
  if (!range || typeof range !== 'string') return null;
  const match = range.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/** Does a single comparator token (e.g. "^18.0.0", ">=18", "<19.0.0") allow `major`? */
function comparatorAllowsMajor(token, major) {
  const m = token.match(/^(\^|~|>=|<=|>|<|=)?\s*v?(\d+|x|\*)/);
  if (!m) return false;
  const op = m[1] || '=';
  const raw = m[2];
  if (raw === 'x' || raw === '*') return true; // x-range major matches anything
  const maj = parseInt(raw, 10);

  switch (op) {
    case '^':
    case '~':
    case '=':
      return major === maj; // caret/tilde pin the major for versions >= 1.0.0
    case '>=':
    case '>':
      return major >= maj;
    case '<=':
      return major <= maj;
    case '<':
      return major < maj;
    default:
      return major === maj;
  }
}

/** A clause is a space-separated AND of comparators (e.g. ">=16.8.0 <18.0.0"). */
function clauseAllowsMajor(clause, major) {
  const trimmed = clause.trim();
  if (trimmed === '' || trimmed === '*' || trimmed === 'x') return true;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return tokens.every((t) => comparatorAllowsMajor(t, major));
}

/**
 * Does a peer-dependency range allow the given React major version?
 * A range is an OR of `||`-separated clauses.
 *
 * @param {string} range - e.g. "^16.8 || ^17.0 || ^18.0"
 * @param {number} major - e.g. 19
 * @returns {boolean}
 */
function satisfiesMajor(range, major) {
  if (range == null || range === '' || range === '*') return true;
  return range
    .split('||')
    .some((clause) => clauseAllowsMajor(clause, major));
}

module.exports = { parseMajor, satisfiesMajor, comparatorAllowsMajor };
