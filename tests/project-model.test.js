import { describe, expect, test } from 'vitest';

import {
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  applyProjectFieldUpdate,
  duplicateProject,
  nextCompletionStatus,
  normalizeProject
} from '../src/app/project-model.js';

describe('normalizeProject defaults (v3 parity)', () => {
  test('an empty object becomes a complete default project', () => {
    const project = normalizeProject({});
    expect(project).toMatchObject({
      name: 'Untitled Project',
      category: '',
      status: 'Planning',
      priority: 'Medium',
      progress: 0,
      deadline: '',
      link: '',
      nextAction: '',
      tags: [],
      notes: '',
      contentItems: []
    });
    expect(project.id).toBeTruthy();
    expect(project.createdAt).toBeTruthy();
    expect(project.updatedAt).toBeTruthy();
  });

  test('null input is tolerated', () => {
    expect(normalizeProject(null).name).toBe('Untitled Project');
  });

  test('unknown status and priority fall back to Planning and Medium', () => {
    expect(normalizeProject({ status: 'Zombie' }).status).toBe('Planning');
    expect(normalizeProject({ priority: 'Urgent' }).priority).toBe('Medium');
    for (const status of PROJECT_STATUSES) {
      expect(normalizeProject({ status }).status).toBe(status);
    }
    for (const priority of PROJECT_PRIORITIES) {
      expect(normalizeProject({ priority }).priority).toBe(priority);
    }
  });

  test('base progress is clamped to 0..99 even for a Complete project', () => {
    expect(normalizeProject({ progress: 250 }).progress).toBe(99);
    expect(normalizeProject({ progress: -10 }).progress).toBe(0);
    expect(normalizeProject({ progress: 42.9 }).progress).toBe(42);
    expect(normalizeProject({ progress: 100, status: 'Complete' }).progress).toBe(99);
  });

  test('tags are stringified, trimmed, and stripped of blanks', () => {
    expect(normalizeProject({ tags: ['  a ', '', 'b', '   ', 3] }).tags)
      .toEqual(['a', 'b', '3']);
    expect(normalizeProject({ tags: 'not-an-array' }).tags).toEqual([]);
  });

  test('existing timestamps are preserved', () => {
    const project = normalizeProject({
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2021-01-01T00:00:00.000Z'
    });
    expect(project.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(project.updatedAt).toBe('2021-01-01T00:00:00.000Z');
  });

  test('meaningless content items are dropped at load, as in v3', () => {
    const project = normalizeProject({
      contentItems: [
        { type: 'task', text: 'keep' },
        { type: 'task', text: '   ' },
        { type: 'link', label: '', url: '' },
        { type: 'image', src: 'not-a-data-url' }
      ]
    });
    expect(project.contentItems).toHaveLength(1);
    expect(project.contentItems[0].text).toBe('keep');
  });

  test('missing contentItems becomes an empty array', () => {
    expect(normalizeProject({ contentItems: 'nope' }).contentItems).toEqual([]);
  });

  test('unknown top-level fields are dropped by normalization', () => {
    // Documented deliberately: this is why migrateSchema3To4 must NOT normalize.
    // Normalizing inside a migration would violate the "preserve unrelated
    // fields" invariant in CLAUDE.md.
    const project = normalizeProject({ name: 'A', futureField: 'keep me' });
    expect(project.futureField).toBeUndefined();
  });
});

describe('applyProjectFieldUpdate (v3 parity)', () => {
  const base = () => normalizeProject({ name: 'Original', progress: 10 });

  test('an empty name reverts to the previous name', () => {
    const project = base();
    expect(applyProjectFieldUpdate(project, 'name', '')).toBe(true);
    expect(project.name).toBe('Original');
    applyProjectFieldUpdate(project, 'name', '    ');
    expect(project.name).toBe('Original');
  });

  test('a name is left-trimmed and capped at 140 characters', () => {
    const project = base();
    applyProjectFieldUpdate(project, 'name', '   Trimmed left only   ');
    expect(project.name).toBe('Trimmed left only   ');

    applyProjectFieldUpdate(project, 'name', 'x'.repeat(200));
    expect(project.name).toHaveLength(140);
  });

  test('text fields honour their v3 length caps', () => {
    const project = base();
    applyProjectFieldUpdate(project, 'category', 'c'.repeat(200));
    expect(project.category).toHaveLength(80);
    applyProjectFieldUpdate(project, 'nextAction', 'n'.repeat(500));
    expect(project.nextAction).toHaveLength(240);
    applyProjectFieldUpdate(project, 'link', 'l'.repeat(2000));
    expect(project.link).toHaveLength(1000);
    applyProjectFieldUpdate(project, 'notes', 'z'.repeat(5000));
    expect(project.notes).toHaveLength(5000);
  });

  test('status and priority reject values outside the allowed sets', () => {
    const project = base();
    expect(applyProjectFieldUpdate(project, 'status', 'Blocked')).toBe(true);
    expect(project.status).toBe('Blocked');
    expect(applyProjectFieldUpdate(project, 'status', 'Nonsense')).toBe(false);
    expect(project.status).toBe('Blocked');
    expect(applyProjectFieldUpdate(project, 'priority', 'Nope')).toBe(false);
    expect(project.priority).toBe('Medium');
  });

  test('progress is truncated and clamped to 0..99', () => {
    const project = base();
    applyProjectFieldUpdate(project, 'progress', '88.7');
    expect(project.progress).toBe(88);
    applyProjectFieldUpdate(project, 'progress', 300);
    expect(project.progress).toBe(99);
    applyProjectFieldUpdate(project, 'progress', 'abc');
    expect(project.progress).toBe(0);
  });

  test('tags are split on commas, trimmed, and blanks removed', () => {
    const project = base();
    applyProjectFieldUpdate(project, 'tags', ' hardware ,, research,  urgent ');
    expect(project.tags).toEqual(['hardware', 'research', 'urgent']);
  });

  test('an unknown field is ignored', () => {
    const project = base();
    expect(applyProjectFieldUpdate(project, 'somethingElse', 'x')).toBe(false);
    expect(project.somethingElse).toBeUndefined();
  });

  test('an unsafe url is stored as typed, exactly as v3 does', () => {
    const project = base();
    applyProjectFieldUpdate(project, 'link', 'javascript:alert(1)');
    expect(project.link).toBe('javascript:alert(1)');
  });
});

describe('duplicateProject (v3 parity)', () => {
  test('copies content with fresh ids, a Copy suffix, and reset timestamps', () => {
    const source = normalizeProject({
      name: 'Source',
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
      contentItems: [
        { id: 'i1', type: 'task', text: 'a', completed: true },
        { id: 'i2', type: 'image', src: 'data:image/png;base64,AA', displayWidth: 320 }
      ]
    });

    const copy = duplicateProject(source, '2026-08-15T00:00:00.000Z');

    expect(copy.name).toBe('Source (Copy)');
    expect(copy.id).not.toBe(source.id);
    expect(copy.createdAt).toBe('2026-08-15T00:00:00.000Z');
    expect(copy.updatedAt).toBe('2026-08-15T00:00:00.000Z');
    expect(copy.contentItems.map(item => item.id)).not.toEqual(['i1', 'i2']);
    expect(copy.contentItems[0]).toMatchObject({ text: 'a', completed: true });
    expect(copy.contentItems[1]).toMatchObject({
      src: 'data:image/png;base64,AA',
      displayWidth: 320
    });
    // The source must be untouched.
    expect(source.name).toBe('Source');
    expect(source.contentItems[0].id).toBe('i1');
  });
});

describe('nextCompletionStatus (v3 parity)', () => {
  test('reopening a Complete project always lands on Active, not the prior status', () => {
    expect(nextCompletionStatus('Complete')).toBe('Active');
    expect(nextCompletionStatus('Planning')).toBe('Complete');
    expect(nextCompletionStatus('Blocked')).toBe('Complete');
    expect(nextCompletionStatus('On Hold')).toBe('Complete');
  });
});
