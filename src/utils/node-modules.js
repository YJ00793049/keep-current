'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJsoncFile } = require('./read-json');

// React's own packages — they legitimately contain element.ref/getNodeFromInstance
// internals, so they are noise for a third-party-library audit.
const FRAMEWORK_PACKAGES = new Set(['react', 'react-dom', 'scheduler', 'react-is']);

/** Read an installed package's metadata from node_modules, or null if absent. */
function readInstalledPackage(repoPath, name) {
  const dir = path.join(repoPath, 'node_modules', ...name.split('/'));
  const pkgJsonPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return null;

  let json;
  try {
    json = readJsoncFile(pkgJsonPath);
  } catch {
    return null;
  }
  return {
    name,
    dir,
    version: json.version || null,
    peerReact: (json.peerDependencies && json.peerDependencies.react) || null,
    json,
  };
}

/**
 * Enumerate every package physically present in node_modules that declares a
 * `react` peer dependency (scoped packages included), excluding React's own
 * framework packages. Used to scope the element.ref scan precisely.
 *
 * @param {string} repoPath
 * @returns {{ name: string, dir: string, version: string|null, peerReact: string|null }[]}
 */
function listReactPeerPackages(repoPath) {
  const nmRoot = path.join(repoPath, 'node_modules');
  if (!fs.existsSync(nmRoot)) return [];

  const out = [];
  for (const entry of safeReaddir(nmRoot)) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      // scoped: descend one level
      for (const sub of safeReaddir(path.join(nmRoot, entry))) {
        addIfReactPeer(repoPath, `${entry}/${sub}`, out);
      }
    } else {
      addIfReactPeer(repoPath, entry, out);
    }
  }
  return out;
}

function addIfReactPeer(repoPath, name, out) {
  if (FRAMEWORK_PACKAGES.has(name)) return;
  const info = readInstalledPackage(repoPath, name);
  if (info && info.peerReact) out.push(info);
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

module.exports = { readInstalledPackage, listReactPeerPackages, FRAMEWORK_PACKAGES };
