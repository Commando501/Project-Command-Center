import { BackupError, readBackupPayload } from '../persistence/backup.js';
import { CURRENT_SCHEMA_VERSION } from '../persistence/data-capsule.js';
import { migrateToSchema } from './migrations.js';
import { validateDataCapsule } from './validator.js';

/**
 * Prepares a backup for restoring, through the same migration and validation
 * engine an update uses.
 *
 * An old backup is therefore upgraded exactly the way an old file is, and a
 * backup that cannot be validated is refused rather than half-restored.
 *
 * Nothing is applied here. The caller decides whether to accept the result,
 * and even accepting it only changes the page in memory -- the file on disk is
 * untouched until the user saves.
 */
export function prepareBackupRestore(text, { targetSchema = CURRENT_SCHEMA_VERSION } = {}) {
  const payload = readBackupPayload(text);

  let migration;
  try {
    migration = migrateToSchema(payload.capsule, targetSchema);
  } catch (error) {
    throw new BackupError(`This backup could not be migrated: ${error.message}`);
  }

  const validation = validateDataCapsule(migration.capsule, { targetSchema });
  if (!validation.valid) {
    throw new BackupError(
      `This backup did not validate, so nothing was restored: ${validation.errors.join('; ')}`
    );
  }

  return {
    format: payload.format,
    backedUpAt: payload.backedUpAt,
    sourceAppVersion: payload.sourceAppVersion,
    capsule: migration.capsule,
    projects: migration.capsule.projects,
    migrationsApplied: migration.applied,
    warnings: validation.warnings
  };
}

export { BackupError };
