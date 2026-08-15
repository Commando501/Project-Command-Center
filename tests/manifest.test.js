import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

import {
  REQUIRED_MANIFEST_FIELDS,
  SUPPORTED_MANIFEST_FORMAT_VERSION,
  validateUpdateManifest
} from '../src/updater/manifest.js';

const DIGEST = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

const valid = (overrides = {}) => ({
  formatVersion: 1,
  appVersion: '4.1.0',
  schemaVersion: 4,
  minSchemaVersion: 3,
  channel: 'stable',
  assetName: 'Project-Command-Center-v4.1.0.html',
  sha256: DIGEST,
  publishedAt: '2026-08-14T22:00:00Z',
  releaseNotes: [],
  ...overrides
});

const errorText = (manifest) => validateUpdateManifest(manifest).errors.join(' | ');

describe('a well-formed manifest', () => {
  test('validates and returns a normalized copy', () => {
    const result = validateUpdateManifest(valid());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.manifest.sha256).toBe(DIGEST);
    expect(result.manifest.signature).toBeNull();
  });

  test('normalizes the GitHub sha256: digest form', () => {
    const result = validateUpdateManifest(valid({ sha256: `sha256:${DIGEST.toUpperCase()}` }));
    expect(result.valid).toBe(true);
    expect(result.manifest.sha256).toBe(DIGEST);
  });

  test('the checked-in valid fixture passes', async () => {
    const fixture = JSON.parse(await readFile('tests/fixtures/release-manifest-valid.json', 'utf8'));
    expect(validateUpdateManifest(fixture).valid).toBe(true);
  });
});

describe('required fields', () => {
  test.each(REQUIRED_MANIFEST_FIELDS)('%s is required', (field) => {
    const manifest = valid();
    delete manifest[field];
    const result = validateUpdateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' | ')).toContain(`${field}: is required.`);
  });

  test('null counts as missing', () => {
    expect(errorText(valid({ appVersion: null }))).toContain('appVersion: is required.');
  });
});

describe('field rules', () => {
  test('an unsupported manifest format is rejected', () => {
    expect(errorText(valid({ formatVersion: 2 }))).toMatch(/unsupported manifest format 2/);
    expect(SUPPORTED_MANIFEST_FORMAT_VERSION).toBe(1);
  });

  test('appVersion must be a strict semantic version', () => {
    expect(errorText(valid({ appVersion: '4.1' }))).toMatch(/not a semantic version/);
    expect(errorText(valid({ appVersion: 'latest' }))).toMatch(/not a semantic version/);
  });

  test('the channel must be one this build understands', () => {
    expect(errorText(valid({ channel: 'nightly' }))).toMatch(/unsupported channel/);
    for (const channel of ['stable', 'beta', 'development']) {
      expect(validateUpdateManifest(valid({ channel })).valid).toBe(true);
    }
  });

  test('schemaVersion below minSchemaVersion is contradictory', () => {
    expect(errorText(valid({ schemaVersion: 2, minSchemaVersion: 4 })))
      .toMatch(/below minSchemaVersion 4/);
  });

  test('schema versions must be integers', () => {
    expect(errorText(valid({ schemaVersion: '4' }))).toMatch(/schemaVersion: must be an integer/);
    expect(errorText(valid({ minSchemaVersion: 3.5 }))).toMatch(/minSchemaVersion: must be an integer/);
  });

  test('the asset must be a bare .html file name', () => {
    expect(errorText(valid({ assetName: 'release.txt' }))).toMatch(/must name an \.html release asset/);
    expect(errorText(valid({ assetName: '' }))).toMatch(/assetName: is required|non-empty string/);
    // A path would let a manifest point away from the release asset it names.
    expect(errorText(valid({ assetName: '../evil.html' }))).toMatch(/bare file name, not a path/);
    expect(errorText(valid({ assetName: 'dir/app.html' }))).toMatch(/bare file name, not a path/);
  });

  test('the digest must be 64 hex characters', () => {
    expect(errorText(valid({ sha256: 'abc' }))).toMatch(/64 character hex digest/);
    expect(errorText(valid({ sha256: `${DIGEST}00` }))).toMatch(/64 character hex digest/);
  });

  test('publishedAt must be a real ISO 8601 timestamp', () => {
    expect(errorText(valid({ publishedAt: 'sometime last week' }))).toMatch(/not an ISO 8601 timestamp/);
    expect(errorText(valid({ publishedAt: '2026' }))).toMatch(/not an ISO 8601 timestamp/);
    expect(validateUpdateManifest(valid({ publishedAt: '2026-08-14T22:00:00.123Z' })).valid).toBe(true);
    expect(validateUpdateManifest(valid({ publishedAt: '2026-08-14T22:00:00+02:00' })).valid).toBe(true);
  });

  test('releaseNotes must be an array when present', () => {
    expect(errorText(valid({ releaseNotes: 'nope' }))).toMatch(/must be an array/);
    const withoutNotes = valid();
    delete withoutNotes.releaseNotes;
    expect(validateUpdateManifest(withoutNotes).valid).toBe(true);
  });
});

describe('hostile and malformed input', () => {
  test('non-objects are rejected outright', () => {
    for (const value of [null, undefined, 'manifest', 42, []]) {
      const result = validateUpdateManifest(value);
      expect(result.valid).toBe(false);
      expect(result.manifest).toBeNull();
    }
  });

  test('an invalid manifest never yields a usable manifest object', () => {
    expect(validateUpdateManifest(valid({ sha256: 'bad' })).manifest).toBeNull();
  });

  test('the checked-in invalid fixture fails on every count', async () => {
    const fixture = JSON.parse(await readFile('tests/fixtures/release-manifest-invalid.json', 'utf8'));
    const result = validateUpdateManifest(fixture);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(7);
  });
});
