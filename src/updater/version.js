/**
 * Strict three-component semantic versions.
 *
 * Prerelease precedence is deliberately absent until a beta channel needs it.
 * Guessing at it now would mean shipping untested ordering rules that decide
 * whether a user is offered an update.
 */

const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(version) {
  const match = SEMVER_PATTERN.exec(String(version || '').trim());
  if (!match) return null;
  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

export function isValidSemver(version) {
  return parseSemver(version) !== null;
}

/** Returns -1, 0, or 1. Throws on malformed input rather than guessing. */
export function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left) throw new TypeError(`Not a semantic version: ${JSON.stringify(a)}`);
  if (!right) throw new TypeError(`Not a semantic version: ${JSON.stringify(b)}`);

  for (const part of ['major', 'minor', 'patch']) {
    if (left[part] !== right[part]) return left[part] > right[part] ? 1 : -1;
  }
  return 0;
}

export function isNewerVersion(candidate, installed) {
  return compareSemver(candidate, installed) > 0;
}

/** Normalizes a release tag such as "v4.1.0" to "4.1.0". */
export function versionFromTag(tag) {
  const parsed = parseSemver(tag);
  return parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : null;
}

export function tagForVersion(version) {
  const parsed = parseSemver(version);
  if (!parsed) throw new TypeError(`Not a semantic version: ${JSON.stringify(version)}`);
  return `v${parsed.major}.${parsed.minor}.${parsed.patch}`;
}
