'use strict';

const path = require('node:path');
const { readJsoncFile } = require('../../utils/read-json');
const { readInstalledPackage } = require('../../utils/node-modules');
const { runCommand } = require('../../utils/run-command');
const { satisfiesMajor, parseMajor } = require('../../utils/version');

/**
 * Parse package names that the installer flagged for peer-dependency problems.
 * yarn warns and swallows; npm ERESOLVE-blocks. Either way the real signal is
 * here in the captured output.
 *
 * @returns {{ names: Set<string>, lines: string[] }}
 */
function parseInstallWarnings(output, manager) {
  const names = new Set();
  const lines = [];
  if (!output) return { names, lines };

  for (const line of output.split('\n')) {
    if (manager === 'yarn') {
      // warning "a > b@1.2.3" has incorrect peer dependency "react@^18".
      const m = line.match(/"([^"]+)" has (?:incorrect|unmet) peer dependency "react@/i);
      if (m) {
        const chain = m[1].split('>').map((s) => s.trim());
        const last = chain[chain.length - 1];
        names.add(stripVersion(last));
        lines.push(line.trim());
      }
    } else {
      // npm error/warn: peer react@"^18.0.0" from @testing-library/react@15.0.6
      const m = line.match(/peer react@"[^"]+" from\s+(@?[^@\s]+(?:\/[^@\s]+)?)@/i);
      if (m) {
        names.add(m[1]);
        lines.push(line.trim());
      } else if (/ERESOLVE|unable to resolve dependency tree|peer dep/i.test(line)) {
        lines.push(line.trim());
      }
    }
  }
  return { names, lines };
}

function stripVersion(token) {
  // "@scope/name@1.2.3" -> "@scope/name" ; "name@1.2.3" -> "name"
  const at = token.lastIndexOf('@');
  return at > 0 ? token.slice(0, at) : token;
}

/**
 * One-time registry reachability probe. Offline, per-package `npm view` calls
 * fail slowly (retries/backoff), so we probe once and skip them when offline —
 * falling back to the installed node_modules peer data, which is itself
 * empirical (the actual installed artifact, not memory).
 */
function probeRegistry() {
  return runCommand('npm', ['ping', '--fetch-retries=0'], { timeout: 8 * 1000 }).ok;
}

/** npm view a single field, returning the trimmed value or null. */
function npmViewField(spec, field) {
  const view = runCommand('npm', ['view', spec, field, '--fetch-retries=0'], {
    timeout: 30 * 1000,
  });
  return view.ok && view.stdout.trim() ? view.stdout.trim() : null;
}

/** Latest published version + its react peer range for a package (empirical). */
function fetchLatest(name) {
  return {
    latestVersion: npmViewField(name, 'version'),
    latestPeer: npmViewField(name, 'peerDependencies.react'),
  };
}

/**
 * Pure classifier — the heart of the peer-dep audit. Distinguishes a genuinely
 * blocking package from a conservative-but-fine one using the upgrade path:
 *   GREEN — installed peer already includes the target major.
 *   AMBER — installed peer excludes target, but a SAME-MAJOR release supports it
 *           (a non-breaking bump; works today, just officially under-declared).
 *   RED   — reaching target support needs a MAJOR upgrade, OR no release supports
 *           target at all, OR we are offline and cannot establish a safe path.
 *
 * @returns {{ level: 'GREEN'|'AMBER'|'RED', reason: string, action: string|null }}
 */
function classifyPeer({ name, installedPeer, installedMajor, latestVersion, latestPeer, toMajor, online }) {
  if (satisfiesMajor(installedPeer, toMajor)) {
    return {
      level: 'GREEN',
      reason: `installed peer range "${installedPeer}" includes react ${toMajor}`,
      action: null,
    };
  }

  if (!online) {
    return {
      level: 'RED',
      reason: `installed peer range "${installedPeer}" excludes react ${toMajor}; could not check for a compatible release (npm registry unreachable)`,
      action: `Re-run online to find the upgrade path for ${name}, or verify manually that a react ${toMajor}-compatible release exists.`,
    };
  }

  if (latestVersion == null) {
    return {
      level: 'RED',
      reason: `installed peer range "${installedPeer}" excludes react ${toMajor}; npm view could not resolve the latest version of ${name}`,
      action: `Check ${name} manually for a react ${toMajor}-compatible release.`,
    };
  }

  // A latest that includes the target — OR that no longer declares a restrictive
  // react peer at all (latestPeer == null) — is a compatible upgrade target.
  const latestRelaxedPeer = latestPeer == null;
  const latestSupportsTarget = latestRelaxedPeer || satisfiesMajor(latestPeer, toMajor);

  if (latestSupportsTarget) {
    const latestMajor = parseMajor(latestVersion);
    const peerNote = latestRelaxedPeer
      ? `${name}@${latestVersion} no longer declares a restrictive react peer`
      : `${name}@${latestVersion} supports react ${toMajor}`;

    if (latestMajor != null && installedMajor != null && latestMajor > installedMajor) {
      return {
        level: 'RED',
        reason: `installed peer "${installedPeer}" excludes react ${toMajor}; support requires a MAJOR upgrade — ${peerNote} (installed ${installedMajor}.x)`,
        action: `Upgrade ${name} to ${latestMajor}.x — a major version, so review its breaking changes.`,
      };
    }
    return {
      level: 'AMBER',
      reason: `installed peer "${installedPeer}" excludes react ${toMajor}, but ${peerNote} (same major) — a non-breaking bump`,
      action: `Bump ${name} to ${latestVersion} (same major). Works today; bump to silence the declared incompatibility.`,
    };
  }

  return {
    level: 'RED',
    reason: `no published version of ${name} supports react ${toMajor} (latest ${name}@${latestVersion} peer "${latestPeer}")`,
    action: `No react ${toMajor}-compatible release of ${name} exists — replace it or hold react back.`,
  };
}

/**
 * PEER-DEP AUDIT.
 * For every direct dependency that declares a react peer, empirically verify
 * its peer range and classify:
 *   RED   — peer range hard-excludes the target React major.
 *   AMBER — peer range allows target but the installer emitted a (swallowed) warning.
 *   GREEN — peer range confirmed to include the target.
 *
 * @param {object} args
 * @param {string} args.repoPath
 * @param {string} args.installOutput - verbatim install output (combined)
 * @param {string} args.manager - 'npm' | 'yarn'
 * @param {number} args.toMajor
 * @returns {{ findings: object[], warnedPackages: string[], warningLines: string[] }}
 */
function auditPeerDeps({ repoPath, installOutput, manager, toMajor }) {
  const pkg = readJsoncFile(path.join(repoPath, 'package.json')) || {};
  const directDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  const { names: warned, lines } = parseInstallWarnings(installOutput, manager);
  const online = probeRegistry();

  const findings = [];
  for (const name of Object.keys(directDeps)) {
    const installed = readInstalledPackage(repoPath, name);
    if (!installed || !installed.peerReact) continue; // no react peer -> not relevant

    const installedPeer = installed.peerReact;
    const excludes = !satisfiesMajor(installedPeer, toMajor);
    // Only spend network calls on packages that look incompatible.
    const latest = excludes && online ? fetchLatest(name) : { latestVersion: null, latestPeer: null };

    const verdict = classifyPeer({
      name,
      installedPeer,
      installedMajor: parseMajor(installed.version),
      latestVersion: latest.latestVersion,
      latestPeer: latest.latestPeer,
      toMajor,
      online,
    });

    findings.push({
      pkg: name,
      version: installed.version,
      level: verdict.level,
      peerRange: installedPeer,
      latestVersion: latest.latestVersion,
      source: online ? 'npm view (latest) + node_modules (installed)' : 'node_modules (offline — npm registry unreachable)',
      reason: verdict.reason,
      action: verdict.action,
      warned: warned.has(name),
    });
  }

  // Stable, useful ordering: RED, then AMBER, then GREEN; alphabetical within.
  const rank = { RED: 0, AMBER: 1, GREEN: 2 };
  findings.sort((a, b) => rank[a.level] - rank[b.level] || a.pkg.localeCompare(b.pkg));

  return { findings, warnedPackages: [...warned], warningLines: lines };
}

module.exports = { auditPeerDeps, parseInstallWarnings, classifyPeer };
