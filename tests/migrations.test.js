import { describe, expect, test } from 'vitest';

import {
  MIGRATIONS,
  MigrationError,
  canMigrate,
  migrateSchema3To4,
  migrateToSchema
} from '../src/updater/migrations.js';

const schema3 = (overrides = {}) => ({
  schemaVersion: 3,
  projects: [],
  preferences: {},
  ...overrides
});

describe('migrateSchema3To4', () => {
  test('produces schema 4 with default update preferences', () => {
    const output = migrateSchema3To4(schema3());
    expect(output.schemaVersion).toBe(4);
    expect(output.preferences).toEqual({
      checkForUpdatesAutomatically: true,
      updateChannel: 'stable',
      automaticBackupBeforeUpdate: true
    });
  });

  test('carries embedded images, captions, and display widths through untouched', () => {
    const src = 'data:image/webp;base64,AAAA';
    const output = migrateSchema3To4(schema3({
      projects: [{
        id: 'p1',
        name: 'Image Project',
        contentItems: [{
          id: 'i1', type: 'image', src, caption: 'Prototype',
          displayWidth: 640, sizeBytes: 54321, mimeType: 'image/webp',
          width: 1600, height: 900, filename: 'proto.webp'
        }]
      }]
    }));

    expect(output.projects[0].contentItems[0]).toEqual({
      id: 'i1', type: 'image', src, caption: 'Prototype',
      displayWidth: 640, sizeBytes: 54321, mimeType: 'image/webp',
      width: 1600, height: 900, filename: 'proto.webp'
    });
  });

  test('preserves task completion, links, and bullets exactly', () => {
    const contentItems = [
      { id: 'i1', type: 'task', text: 'a', completed: true },
      { id: 'i2', type: 'task', text: 'b', completed: false },
      { id: 'i3', type: 'bullet', text: 'c' },
      { id: 'i4', type: 'link', label: 'L', url: 'https://a.example' }
    ];
    const output = migrateSchema3To4(schema3({ projects: [{ id: 'p1', contentItems }] }));
    expect(output.projects[0].contentItems).toEqual(contentItems);
  });

  test('preserves unrelated fields rather than normalizing them away', () => {
    // Migrations must not call normalizeProject: it drops unknown keys, which
    // would silently destroy data written by a newer version.
    const output = migrateSchema3To4(schema3({
      customTopLevel: { keep: true },
      projects: [{
        id: 'p1',
        futureField: 'kept',
        contentItems: [{ id: 'i1', type: 'task', text: 'a', futureItemField: 7 }]
      }]
    }));

    expect(output.customTopLevel).toEqual({ keep: true });
    expect(output.projects[0].futureField).toBe('kept');
    expect(output.projects[0].contentItems[0].futureItemField).toBe(7);
  });

  test('keeps existing preferences and only fills the gaps', () => {
    const output = migrateSchema3To4(schema3({
      preferences: { updateChannel: 'beta', somethingElse: 1 }
    }));
    expect(output.preferences.updateChannel).toBe('beta');
    expect(output.preferences.somethingElse).toBe(1);
    expect(output.preferences.automaticBackupBeforeUpdate).toBe(true);
  });

  test('refuses any input that is not schema 3', () => {
    expect(() => migrateSchema3To4({ schemaVersion: 4 })).toThrow(MigrationError);
    expect(() => migrateSchema3To4({ schemaVersion: 2 })).toThrow(/received schema 2/);
    expect(() => migrateSchema3To4(null)).toThrow(MigrationError);
  });

  test('never mutates its input', () => {
    const input = schema3({ projects: [{ id: 'p1', contentItems: [{ id: 'i1', type: 'task' }] }] });
    const snapshot = structuredClone(input);
    migrateSchema3To4(input);
    expect(input).toEqual(snapshot);
  });
});

describe('migrateToSchema', () => {
  test('runs the chain and reports the steps applied', () => {
    const result = migrateToSchema(schema3(), 4);
    expect(result.capsule.schemaVersion).toBe(4);
    expect(result.applied).toEqual(['3 -> 4']);
  });

  test('a capsule already at the target is returned unchanged', () => {
    const capsule = { schemaVersion: 4, projects: [{ id: 'p1' }], preferences: {} };
    const result = migrateToSchema(capsule, 4);
    expect(result.applied).toEqual([]);
    expect(result.capsule).toEqual(capsule);
  });

  test('never mutates the live capsule', () => {
    const input = schema3({ projects: [{ id: 'p1', name: 'Live' }] });
    const snapshot = structuredClone(input);
    migrateToSchema(input, 4);
    expect(input).toEqual(snapshot);
  });

  test('refuses to downgrade, with an explanation', () => {
    expect(() => migrateToSchema({ schemaVersion: 5, projects: [] }, 4))
      .toThrow(/Cannot downgrade data from schema 5 to schema 4/);
  });

  test('refuses a schema with no registered migration', () => {
    expect(() => migrateToSchema({ schemaVersion: 2, projects: [] }, 4))
      .toThrow(/No migration is registered for schema 2/);
  });

  test('rejects a capsule with no usable schema version', () => {
    expect(() => migrateToSchema({ projects: [] }, 4)).toThrow(/no usable schema version/);
    expect(() => migrateToSchema({ schemaVersion: '3', projects: [] }, 4))
      .toThrow(/no usable schema version/);
    expect(() => migrateToSchema(null, 4)).toThrow(/Nothing to migrate/);
  });
});

describe('the migration registry', () => {
  test('registers exactly the migrations v4 ships with', () => {
    expect([...MIGRATIONS.keys()]).toEqual([3]);
  });

  test('canMigrate reports reachability without running anything', () => {
    expect(canMigrate(3, 4)).toBe(true);
    expect(canMigrate(4, 4)).toBe(true);
    expect(canMigrate(2, 4)).toBe(false);
    expect(canMigrate(4, 5)).toBe(false);
    expect(canMigrate(5, 4)).toBe(false);
  });

  test('every registered migration advances by exactly one version', () => {
    for (const [from, migrate] of MIGRATIONS) {
      const output = migrate({ schemaVersion: from, projects: [], preferences: {} });
      expect(output.schemaVersion).toBe(from + 1);
    }
  });
});
