import { cloneJson, makeId } from '../app/util.js';

/**
 * The Data Capsule is everything the user owns. It must survive App Shell
 * replacement, so it is stored and migrated independently of the application
 * version.
 */

export const CURRENT_SCHEMA_VERSION = 4;
export const MIN_SUPPORTED_SCHEMA_VERSION = 3;
export const UPDATE_CHANNELS = Object.freeze(['stable', 'beta', 'development']);

export function createDefaultPreferences() {
  return {
    checkForUpdatesAutomatically: true,
    updateChannel: 'stable',
    automaticBackupBeforeUpdate: true
  };
}

export function createDataCapsule(projects = [], preferences = {}) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    projects: Array.isArray(projects) ? cloneJson(projects) : [],
    preferences: {
      ...createDefaultPreferences(),
      ...(preferences && typeof preferences === 'object' ? cloneJson(preferences) : {})
    }
  };
}

export function normalizeDataCapsule(capsule) {
  const source = capsule && typeof capsule === 'object' ? capsule : {};
  return {
    schemaVersion: Number.isInteger(source.schemaVersion)
      ? source.schemaVersion
      : CURRENT_SCHEMA_VERSION,
    projects: Array.isArray(source.projects) ? cloneJson(source.projects) : [],
    preferences: {
      ...createDefaultPreferences(),
      ...(source.preferences && typeof source.preferences === 'object'
        ? cloneJson(source.preferences)
        : {})
    }
  };
}

/**
 * Wraps a bare legacy v3 project array as an inferred schema-3 capsule.
 *
 * This adapter — not the migration — backfills a missing project id. v3's own
 * loader assigns one in `normalizeProject`, so a hand-edited or v2-era file
 * that reaches us without ids is data v3 would have happily accepted. Doing it
 * here keeps `migrateSchema3To4` a pure pass-through, which is what lets it
 * honour the "preserve unrelated fields" migration rule.
 */
export function legacyV3ProjectsToSchema3(projects = []) {
  const list = Array.isArray(projects) ? cloneJson(projects) : [];
  return {
    schemaVersion: 3,
    projects: list.map(project => {
      if (!project || typeof project !== 'object') return project;
      return project.id ? project : { ...project, id: makeId() };
    }),
    preferences: {}
  };
}
