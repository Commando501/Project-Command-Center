import { describe, expect, test } from 'vitest';

import {
  compareSemver,
  isNewerVersion,
  isValidSemver,
  parseSemver,
  tagForVersion,
  versionFromTag
} from '../src/updater/version.js';

describe('parseSemver', () => {
  test('parses three numeric components', () => {
    expect(parseSemver('4.1.0')).toEqual({ major: 4, minor: 1, patch: 0 });
    expect(parseSemver('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 });
  });

  test('accepts a leading v, as release tags carry', () => {
    expect(parseSemver('v4.1.0')).toEqual({ major: 4, minor: 1, patch: 0 });
    expect(parseSemver('  v4.1.0  ')).toEqual({ major: 4, minor: 1, patch: 0 });
  });

  test('rejects anything that is not strictly three numeric components', () => {
    for (const value of [
      '4.1', '4', '4.1.0.0', '4.1.x', 'four.one.zero', '',
      null, undefined, '4.1.0-beta.1', '4.1.0+build', 'v', '-1.0.0'
    ]) {
      expect(parseSemver(value)).toBeNull();
      expect(isValidSemver(value)).toBe(false);
    }
  });
});

describe('compareSemver', () => {
  test('orders by major, then minor, then patch', () => {
    expect(compareSemver('4.1.0', '4.0.9')).toBe(1);
    expect(compareSemver('4.0.0', '4.0.0')).toBe(0);
    expect(compareSemver('4.0.0', '5.0.0')).toBe(-1);
    expect(compareSemver('4.2.0', '4.10.0')).toBe(-1);
    expect(compareSemver('4.0.10', '4.0.9')).toBe(1);
  });

  test('compares a tag with a plain version', () => {
    expect(compareSemver('v4.1.0', '4.1.0')).toBe(0);
  });

  test('throws rather than guessing at malformed input', () => {
    expect(() => compareSemver('4.1', '4.1.0')).toThrow(/Not a semantic version/);
    expect(() => compareSemver('4.1.0', 'latest')).toThrow(/Not a semantic version/);
  });
});

describe('isNewerVersion', () => {
  test('only a strictly greater version counts as an update', () => {
    expect(isNewerVersion('4.1.0', '4.0.0')).toBe(true);
    expect(isNewerVersion('4.0.0', '4.0.0')).toBe(false);
    expect(isNewerVersion('3.9.9', '4.0.0')).toBe(false);
  });
});

describe('release tags', () => {
  test('round-trip between tag and version', () => {
    expect(versionFromTag('v4.1.0')).toBe('4.1.0');
    expect(versionFromTag('4.1.0')).toBe('4.1.0');
    expect(versionFromTag('release-4')).toBeNull();
    expect(tagForVersion('4.1.0')).toBe('v4.1.0');
    expect(() => tagForVersion('4.1')).toThrow();
  });
});
