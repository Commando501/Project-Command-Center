import {
  DATA_END,
  DATA_START,
  METADATA_END,
  METADATA_START,
  countOccurrences,
  metadataRegionRegex
} from '../persistence/markers.js';
import { isValidSemver } from './version.js';

/**
 * Inspects a candidate release shell without executing any of it.
 *
 * Only the JSON in the release-metadata marker region is read. The candidate's
 * script is never evaluated, so pointing this at an unknown or hostile file is
 * safe: the worst outcome is a rejection.
 */

export class ShellInspectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShellInspectionError';
  }
}

export function inspectReleaseShell(html) {
  const source = String(html || '');

  const metadataStarts = countOccurrences(source, METADATA_START);
  const metadataEnds = countOccurrences(source, METADATA_END);

  if (metadataStarts === 0 || metadataEnds === 0) {
    throw new ShellInspectionError(
      'This file does not look like a Project Command Center release: no release metadata was found.'
    );
  }
  if (metadataStarts > 1 || metadataEnds > 1) {
    throw new ShellInspectionError(
      `Expected one release metadata region, found ${metadataStarts} start and ${metadataEnds} end markers.`
    );
  }

  const dataStarts = countOccurrences(source, DATA_START);
  const dataEnds = countOccurrences(source, DATA_END);
  if (dataStarts !== 1 || dataEnds !== 1) {
    throw new ShellInspectionError(
      `A release shell must contain exactly one Data Capsule region (found ${dataStarts} start and ${dataEnds} end markers).`
    );
  }

  const match = source.match(metadataRegionRegex());
  if (!match) {
    throw new ShellInspectionError('Release metadata markers are present but not correctly paired.');
  }

  let metadata;
  try {
    metadata = JSON.parse(match[1]);
  } catch (error) {
    throw new ShellInspectionError(`Release metadata is not valid JSON: ${error.message}`);
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new ShellInspectionError('Release metadata is not an object.');
  }

  const { appVersion, schemaVersion, minSchemaVersion, updateChannel, repository } = metadata;

  if (!isValidSemver(appVersion)) {
    throw new ShellInspectionError(
      `Release metadata has no usable application version (received ${JSON.stringify(appVersion)}).`
    );
  }
  if (!Number.isInteger(schemaVersion)) {
    throw new ShellInspectionError(
      `Release metadata has no usable schema version (received ${JSON.stringify(schemaVersion)}).`
    );
  }
  if (!Number.isInteger(minSchemaVersion)) {
    throw new ShellInspectionError(
      `Release metadata has no usable minimum schema version (received ${JSON.stringify(minSchemaVersion)}).`
    );
  }
  if (schemaVersion < minSchemaVersion) {
    throw new ShellInspectionError(
      `Release metadata is inconsistent: schema ${schemaVersion} is below its own minimum of ${minSchemaVersion}.`
    );
  }

  return {
    appVersion,
    schemaVersion,
    minSchemaVersion,
    updateChannel: typeof updateChannel === 'string' ? updateChannel : 'stable',
    repository: typeof repository === 'string' ? repository : ''
  };
}

/** Whether an installed capsule schema is within a candidate's supported range. */
export function isSchemaSupportedByShell(installedSchema, shellMetadata) {
  return Number.isInteger(installedSchema)
    && installedSchema >= shellMetadata.minSchemaVersion
    && installedSchema <= shellMetadata.schemaVersion;
}
