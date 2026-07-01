'use strict';

const fs = require('node:fs');

/**
 * Strip // and /* *​/ comments and trailing commas from a JSONC string.
 * tsconfig.json files are JSONC, so a plain JSON.parse would throw on them.
 * Intentionally simple: good enough for config files, not a full tokenizer.
 */
function stripJsonc(text) {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next;
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
    } else if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
    } else {
      out += ch;
    }
  }

  // Remove trailing commas before } or ]
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Parse a JSONC string into an object, throwing a clear error on failure. */
function parseJsonc(text) {
  return JSON.parse(stripJsonc(text));
}

/** Read and parse a JSONC file, or return null if it does not exist. */
function readJsoncFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return parseJsonc(fs.readFileSync(filePath, 'utf8'));
}

module.exports = { stripJsonc, parseJsonc, readJsoncFile };
