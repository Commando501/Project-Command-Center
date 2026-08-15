import { UPDATE_CHANNELS } from '../persistence/data-capsule.js';
import { isValidSemver } from './version.js';
import { normalizeSha256 } from './sha256.js';

/**
 * Update manifest validation.
 *
 * The manifest is fetched from a public release before anything is downloaded
 * or installed, so it is untrusted input. Every field is checked; nothing is
 * inferred from a partially valid manifest.
 */

export const SUPPORTED_MANIFEST_FORMAT_VERSION = 1;

export const REQUIRED_MANIFEST_FIELDS = Object.freeze([
  'formatVersion', 'appVersion', 'schemaVersion',
  'minSchemaVersion', 'channel', 'assetName', 'sha256', 'publishedAt'
]);

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  // Reject loose formats that Date happens to accept, such as "2026".
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

export function validateUpdateManifest(manifest) {
  const errors = [];
  const fail = (field, message) => errors.push(`${field}: ${message}`);

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['manifest: expected an object.'], manifest: null };
  }

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null) {
      fail(field, 'is required.');
    }
  }

  if (manifest.formatVersion !== undefined
    && manifest.formatVersion !== SUPPORTED_MANIFEST_FORMAT_VERSION) {
    fail('formatVersion', `unsupported manifest format ${JSON.stringify(manifest.formatVersion)}; this build understands ${SUPPORTED_MANIFEST_FORMAT_VERSION}.`);
  }

  if (manifest.appVersion !== undefined && !isValidSemver(manifest.appVersion)) {
    fail('appVersion', `not a semantic version: ${JSON.stringify(manifest.appVersion)}.`);
  }

  if (manifest.channel !== undefined && !UPDATE_CHANNELS.includes(manifest.channel)) {
    fail('channel', `unsupported channel ${JSON.stringify(manifest.channel)}.`);
  }

  const schemaVersion = manifest.schemaVersion;
  const minSchemaVersion = manifest.minSchemaVersion;
  if (schemaVersion !== undefined && !Number.isInteger(schemaVersion)) {
    fail('schemaVersion', 'must be an integer.');
  }
  if (minSchemaVersion !== undefined && !Number.isInteger(minSchemaVersion)) {
    fail('minSchemaVersion', 'must be an integer.');
  }
  if (Number.isInteger(schemaVersion) && Number.isInteger(minSchemaVersion)
    && schemaVersion < minSchemaVersion) {
    fail('schemaVersion', `is ${schemaVersion}, below minSchemaVersion ${minSchemaVersion}.`);
  }

  if (manifest.assetName !== undefined) {
    if (typeof manifest.assetName !== 'string' || !manifest.assetName.trim()) {
      fail('assetName', 'must be a non-empty string.');
    } else if (!manifest.assetName.toLowerCase().endsWith('.html')) {
      fail('assetName', `must name an .html release asset (received ${JSON.stringify(manifest.assetName)}).`);
    } else if (/[/\\]/.test(manifest.assetName)) {
      // A path separator would let a manifest point somewhere other than the
      // release asset it claims to describe.
      fail('assetName', 'must be a bare file name, not a path.');
    }
  }

  if (manifest.sha256 !== undefined && !normalizeSha256(manifest.sha256)) {
    fail('sha256', 'must be a 64 character hex digest, optionally prefixed with "sha256:".');
  }

  if (manifest.publishedAt !== undefined && !isIsoTimestamp(manifest.publishedAt)) {
    fail('publishedAt', `not an ISO 8601 timestamp: ${JSON.stringify(manifest.publishedAt)}.`);
  }

  if (manifest.releaseNotes !== undefined && !Array.isArray(manifest.releaseNotes)) {
    fail('releaseNotes', 'must be an array when present.');
  }

  if (errors.length) return { valid: false, errors, manifest: null };

  return {
    valid: true,
    errors: [],
    manifest: {
      ...manifest,
      sha256: normalizeSha256(manifest.sha256),
      // Reserved for future signed releases; absent means unsigned, which is
      // the expected state for the first v4 releases.
      signature: manifest.signature ?? null
    }
  };
}
