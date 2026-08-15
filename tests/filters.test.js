import { describe, expect, test } from 'vitest';

import {
  contentItemSearchText,
  projectMatchesActiveTags,
  selectProjects,
  sortProjects
} from '../src/app/filters.js';
import { normalizeProject } from '../src/app/project-model.js';

const project = (overrides) => normalizeProject({
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides
});

const names = (list) => list.map(item => item.name);

describe('contentItemSearchText (v3 parity)', () => {
  test('each item type contributes its own searchable fields', () => {
    expect(contentItemSearchText({ type: 'link', label: 'Docs', url: 'https://a.example' }))
      .toBe('Docs https://a.example');
    expect(contentItemSearchText({
      type: 'image', caption: 'Cap', filename: 'a.webp', mimeType: 'image/webp'
    })).toBe('Cap a.webp image/webp');
    expect(contentItemSearchText({ type: 'task', text: 'Do it' })).toBe('Do it');
    expect(contentItemSearchText(null)).toBe('');
  });
});

describe('projectMatchesActiveTags (v3 parity)', () => {
  const tagged = project({ name: 'A', tags: ['Hardware', 'Research'] });

  test('no active tags matches everything', () => {
    expect(projectMatchesActiveTags(tagged, new Set())).toBe(true);
    expect(projectMatchesActiveTags(tagged, null)).toBe(true);
  });

  test('tag matching is case insensitive', () => {
    expect(projectMatchesActiveTags(tagged, new Set(['hardware']))).toBe(true);
    expect(projectMatchesActiveTags(tagged, new Set(['HARDWARE']))).toBe(true);
  });

  test('multiple active tags are ANDed, not ORed', () => {
    expect(projectMatchesActiveTags(tagged, new Set(['hardware', 'research']))).toBe(true);
    expect(projectMatchesActiveTags(tagged, new Set(['hardware', 'missing']))).toBe(false);
  });
});

describe('search (v3 parity)', () => {
  const projects = [
    project({ name: 'Alpha', notes: 'secret note', tags: ['x'] }),
    project({ name: 'Beta', category: 'Hardware' }),
    project({
      name: 'Gamma',
      contentItems: [
        { type: 'task', text: 'buried task text' },
        { type: 'link', label: 'Spec', url: 'https://spec.example' },
        { type: 'image', src: 'data:image/png;base64,AA', caption: 'buried caption' }
      ]
    })
  ];

  const search = (query) => names(selectProjects(projects, { query }));

  test('searches name, category, notes, and tags', () => {
    expect(search('alpha')).toEqual(['Alpha']);
    expect(search('secret')).toEqual(['Alpha']);
    expect(search('hardware')).toEqual(['Beta']);
  });

  test('searches nested task, link, and image content', () => {
    expect(search('buried task')).toEqual(['Gamma']);
    expect(search('spec.example')).toEqual(['Gamma']);
    expect(search('buried caption')).toEqual(['Gamma']);
  });

  test('search is case insensitive and an empty query matches all', () => {
    expect(search('ALPHA')).toEqual(['Alpha']);
    expect(search('')).toHaveLength(3);
    expect(search('   ')).toHaveLength(3);
  });
});

describe('status, priority, and tag filters (v3 parity)', () => {
  const projects = [
    project({ name: 'A', status: 'Active', priority: 'High', tags: ['red', 'blue'] }),
    project({ name: 'B', status: 'Blocked', priority: 'Low', tags: ['red'] }),
    project({ name: 'C', status: 'Active', priority: 'Low', tags: [] })
  ];

  test('filters combine as AND', () => {
    expect(names(selectProjects(projects, { status: 'Active' }))).toEqual(['A', 'C']);
    expect(names(selectProjects(projects, { priority: 'Low' }))).toEqual(['B', 'C']);
    expect(names(selectProjects(projects, { status: 'Active', priority: 'Low' })))
      .toEqual(['C']);
  });

  test('active tag filters require every tag', () => {
    expect(names(selectProjects(projects, { activeTags: new Set(['red']) })))
      .toEqual(['A', 'B']);
    expect(names(selectProjects(projects, { activeTags: new Set(['red', 'blue']) })))
      .toEqual(['A']);
  });

  test('an empty filter value means no filtering', () => {
    expect(selectProjects(projects, { status: '', priority: '' })).toHaveLength(3);
  });
});

describe('sorting (v3 parity)', () => {
  const projects = [
    project({ name: 'Beta', priority: 'Low', progress: 50, deadline: '2026-03-01', updatedAt: '2026-01-02T00:00:00.000Z' }),
    project({ name: 'alpha', priority: 'High', progress: 10, deadline: '', updatedAt: '2026-01-03T00:00:00.000Z' }),
    project({ name: 'Gamma', priority: 'Medium', progress: 90, deadline: '2026-01-01', updatedAt: '2026-01-01T00:00:00.000Z' })
  ];

  test('updated-desc is the default and is most-recent first', () => {
    expect(names(sortProjects(projects, 'updated-desc'))).toEqual(['alpha', 'Beta', 'Gamma']);
    expect(names(sortProjects(projects, 'anything-unknown')))
      .toEqual(['alpha', 'Beta', 'Gamma']);
  });

  test('name-asc uses locale comparison, so case does not split the order', () => {
    expect(names(sortProjects(projects, 'name-asc'))).toEqual(['alpha', 'Beta', 'Gamma']);
  });

  test('priority-desc orders High, Medium, Low', () => {
    expect(names(sortProjects(projects, 'priority-desc'))).toEqual(['alpha', 'Gamma', 'Beta']);
  });

  test('priority-desc breaks ties on most recently updated', () => {
    const tied = [
      project({ name: 'Older', priority: 'High', updatedAt: '2026-01-01T00:00:00.000Z' }),
      project({ name: 'Newer', priority: 'High', updatedAt: '2026-02-01T00:00:00.000Z' })
    ];
    expect(names(sortProjects(tied, 'priority-desc'))).toEqual(['Newer', 'Older']);
  });

  test('progress-desc is highest first and breaks ties on name', () => {
    expect(names(sortProjects(projects, 'progress-desc'))).toEqual(['Gamma', 'Beta', 'alpha']);
  });

  test('deadline-asc puts blank deadlines last', () => {
    expect(names(sortProjects(projects, 'deadline-asc'))).toEqual(['Gamma', 'Beta', 'alpha']);
  });

  test('sorting does not mutate the input array', () => {
    const input = [...projects];
    sortProjects(input, 'name-asc');
    expect(names(input)).toEqual(['Beta', 'alpha', 'Gamma']);
  });

  test('progress-desc uses computed progress, so tasks break the tie', () => {
    const withTasks = [
      project({ name: 'NoTasks', progress: 50 }),
      project({
        name: 'WithTasks',
        progress: 50,
        contentItems: [{ type: 'task', text: 'a', completed: true }]
      })
    ];
    expect(names(sortProjects(withTasks, 'progress-desc'))).toEqual(['WithTasks', 'NoTasks']);
  });
});
