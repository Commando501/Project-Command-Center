import { createDefaultPreferences } from '../persistence/data-capsule.js';
import { cloneJson } from '../app/util.js';

/**
 * Sequential schema migrations, one version at a time.
 *
 * There is deliberately no "figure out what this is and fix it" function. Each
 * migration accepts exactly one known input schema and returns exactly the
 * next one, so every historical path is explicit and independently testable.
 *
 * Migrations must PRESERVE UNRELATED FIELDS. That is why none of them calls
 * normalizeProject: normalization drops unknown keys, which would silently
 * destroy data written by a newer version than the one doing the migrating.
 */

export class MigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationError';
  }
}

/**
 * Schema 3 (the legacy v3 project array, wrapped by the extractor) becomes
 * schema 4 (the Data Capsule). Projects pass through untouched; only the
 * envelope and the update preferences are added.
 */
export function migrateSchema3To4(input) {
  if (!input || typeof input !== 'object') {
    throw new MigrationError('Migration 3 -> 4 requires a capsule object.');
  }
  if (input.schemaVersion !== 3) {
    throw new MigrationError(
      `Migration 3 -> 4 received schema ${input.schemaVersion}.`
    );
  }

  const source = cloneJson(input);
  return {
    ...source,
    schemaVersion: 4,
    projects: Array.isArray(source.projects) ? source.projects : [],
    preferences: {
      ...createDefaultPreferences(),
      ...(source.preferences && typeof source.preferences === 'object'
        ? source.preferences
        : {})
    }
  };
}

/** Registered migrations, keyed by the schema they accept. */
export const MIGRATIONS = new Map([
  [3, migrateSchema3To4]
]);

export function migrateToSchema(capsule, targetSchema) {
  if (!capsule || typeof capsule !== 'object') {
    throw new MigrationError('Nothing to migrate.');
  }
  if (!Number.isInteger(capsule.schemaVersion)) {
    throw new MigrationError(
      `Data Capsule has no usable schema version (received ${JSON.stringify(capsule.schemaVersion)}).`
    );
  }
  if (!Number.isInteger(targetSchema)) {
    throw new MigrationError('Target schema must be an integer.');
  }

  if (capsule.schemaVersion > targetSchema) {
    throw new MigrationError(
      `Cannot downgrade data from schema ${capsule.schemaVersion} to schema ${targetSchema}. `
      + 'This update is older than the file you are using.'
    );
  }

  // The live capsule is never touched; everything happens on a clone.
  let working = cloneJson(capsule);
  const applied = [];

  while (working.schemaVersion < targetSchema) {
    const from = working.schemaVersion;
    const migrate = MIGRATIONS.get(from);
    if (!migrate) {
      throw new MigrationError(
        `No migration is registered for schema ${from}. `
        + 'An intermediate release is required to upgrade this file.'
      );
    }

    working = migrate(working);
    applied.push(`${from} -> ${working.schemaVersion}`);

    if (working.schemaVersion <= from) {
      throw new MigrationError(
        `Migration from schema ${from} did not advance the schema version.`
      );
    }
  }

  if (working.schemaVersion !== targetSchema) {
    throw new MigrationError(
      `Cannot migrate schema ${capsule.schemaVersion} to ${targetSchema}.`
    );
  }

  return { capsule: working, applied };
}

/** Whether a source schema can reach the target through registered steps. */
export function canMigrate(fromSchema, targetSchema) {
  if (!Number.isInteger(fromSchema) || !Number.isInteger(targetSchema)) return false;
  if (fromSchema > targetSchema) return false;
  let current = fromSchema;
  while (current < targetSchema) {
    if (!MIGRATIONS.has(current)) return false;
    current += 1;
  }
  return true;
}
