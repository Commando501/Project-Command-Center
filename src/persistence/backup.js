import { CURRENT_SCHEMA_VERSION, createDataCapsule, normalizeDataCapsule } from './data-capsule.js';

/**
 * Reading a backup file back in.
 *
 * Two shapes are accepted, because the application has always written two:
 *
 *   update backup   { backupFormatVersion, backedUpAt, sourceAppVersion, data }
 *                   taken automatically before a migration
 *
 *   JSON export     { exportedAt, projectCount, projects }
 *                   the v3 "Export JSON Backup" shape, unchanged in v4
 *
 * Nothing here is executed; the text goes straight to JSON.parse.
 */

export class BackupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupError';
  }
}

export function readBackupPayload(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text ?? ''));
  } catch (error) {
    throw new BackupError(`That file is not valid JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BackupError('That file does not contain a Project Command Center backup.');
  }

  if (parsed.backupFormatVersion === 1 && parsed.data && typeof parsed.data === 'object') {
    return {
      format: 'update-backup',
      backedUpAt: String(parsed.backedUpAt || ''),
      sourceAppVersion: String(parsed.sourceAppVersion || ''),
      capsule: normalizeDataCapsule(parsed.data)
    };
  }

  if (Array.isArray(parsed.projects)) {
    // A bare export carries no schema version. Project shape did not change
    // between schema 3 and 4 -- only the envelope around it did -- so an
    // export from either version is read at the current schema.
    return {
      format: 'json-export',
      backedUpAt: String(parsed.exportedAt || ''),
      sourceAppVersion: '',
      capsule: createDataCapsule(parsed.projects)
    };
  }

  if (parsed.backupFormatVersion !== undefined) {
    throw new BackupError(
      `This backup uses format version ${JSON.stringify(parsed.backupFormatVersion)}, `
      + 'which this version does not understand.'
    );
  }

  throw new BackupError('That file is not a Project Command Center backup.');
}

export { CURRENT_SCHEMA_VERSION };
