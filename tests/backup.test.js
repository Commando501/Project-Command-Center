import { describe, expect, test } from 'vitest';

import { BackupError, readBackupPayload } from '../src/persistence/backup.js';
import { prepareBackupRestore } from '../src/updater/restore.js';

const updateBackup = (data) => JSON.stringify({
  backupFormatVersion: 1,
  backedUpAt: '2026-08-01T00:00:00.000Z',
  sourceAppVersion: '4.0.0',
  data
});

describe('readBackupPayload', () => {
  test('reads the update-backup shape', () => {
    const payload = readBackupPayload(updateBackup({
      schemaVersion: 4, projects: [{ id: 'p1', name: 'A' }], preferences: {}
    }));

    expect(payload.format).toBe('update-backup');
    expect(payload.sourceAppVersion).toBe('4.0.0');
    expect(payload.backedUpAt).toBe('2026-08-01T00:00:00.000Z');
    expect(payload.capsule.projects[0].name).toBe('A');
  });

  test('reads the v3 JSON export shape', () => {
    const payload = readBackupPayload(JSON.stringify({
      exportedAt: '2026-01-01T00:00:00.000Z',
      projectCount: 1,
      projects: [{ id: 'p1', name: 'From export' }]
    }));

    expect(payload.format).toBe('json-export');
    // Project shape is identical across schema 3 and 4; only the envelope
    // changed, so a bare export is read at the current schema.
    expect(payload.capsule.schemaVersion).toBe(4);
    expect(payload.capsule.projects[0].name).toBe('From export');
  });

  test('an empty export is valid, not an error', () => {
    expect(readBackupPayload('{"exportedAt":"x","projectCount":0,"projects":[]}').capsule.projects)
      .toEqual([]);
  });

  test('rejects anything that is not a backup', () => {
    for (const text of ['', 'not json', '[]', 'null', '"a string"', '{"nope":1}', '42']) {
      expect(() => readBackupPayload(text)).toThrow(BackupError);
    }
  });

  test('names the problem when the JSON itself is malformed', () => {
    expect(() => readBackupPayload('{oops}')).toThrow(/not valid JSON/);
  });

  test('refuses a future backup format rather than guessing at it', () => {
    expect(() => readBackupPayload(JSON.stringify({ backupFormatVersion: 99, data: {} })))
      .toThrow(/format version 99/);
  });
});

describe('prepareBackupRestore', () => {
  test('returns projects ready to apply', () => {
    const restore = prepareBackupRestore(updateBackup({
      schemaVersion: 4,
      projects: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
      preferences: {}
    }));

    expect(restore.projects.map(project => project.name)).toEqual(['A', 'B']);
    expect(restore.migrationsApplied).toEqual([]);
    expect(restore.warnings).toEqual([]);
  });

  test('upgrades an older backup through the same migration engine', () => {
    const restore = prepareBackupRestore(updateBackup({
      schemaVersion: 3,
      projects: [{ id: 'p1', name: 'Old', contentItems: [{ id: 'i1', type: 'image', src: 'data:image/webp;base64,AA' }] }],
      preferences: {}
    }));

    expect(restore.migrationsApplied).toEqual(['3 -> 4']);
    expect(restore.capsule.schemaVersion).toBe(4);
    expect(restore.projects[0].contentItems[0].src).toBe('data:image/webp;base64,AA');
  });

  test('refuses a backup that cannot be validated, restoring nothing', () => {
    expect(() => prepareBackupRestore(updateBackup({
      schemaVersion: 4,
      projects: [{ id: 'p1', contentItems: [{ id: 'i1', type: 'image', src: 'https://example.com/a.png' }] }],
      preferences: {}
    }))).toThrow(/did not validate, so nothing was restored/);
  });

  test('refuses a backup too old to migrate', () => {
    expect(() => prepareBackupRestore(updateBackup({
      schemaVersion: 2, projects: [], preferences: {}
    }))).toThrow(/could not be migrated/);
  });

  test('reports warnings without blocking a usable restore', () => {
    const restore = prepareBackupRestore(updateBackup({
      schemaVersion: 4,
      projects: [{ id: 'p1', name: 'A', link: 'htp://typo.example' }],
      preferences: {}
    }));

    expect(restore.projects).toHaveLength(1);
    expect(restore.warnings.join(' ')).toMatch(/not an http\(s\) url/);
  });
});
