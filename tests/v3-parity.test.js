import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, test } from 'vitest';

import { computeProgress, taskStats } from '../src/app/progress.js';
import { normalizeProject } from '../src/app/project-model.js';
import { projectMatchesActiveTags } from '../src/app/filters.js';
import {
  contentItemHasMeaningfulData,
  normalizeContentItem
} from '../src/content/content-items.js';

/**
 * Differential parity against the real legacy application.
 *
 * v3 delimits its own dependency-free logic with __PURE_LOGIC_START__ /
 * __PURE_LOGIC_END__ markers, so that block can be executed directly and its
 * output compared with the extracted modules. This is a proof of equivalence
 * rather than a restatement of what the port was believed to do.
 *
 * The legacy file is never modified; it is only read.
 */

const LEGACY_PATH = 'legacy/Project-Command-Center-v3.html';
// Assembled from fragments so this file never trips the marker-hygiene test.
const PURE_START = '/*__PURE_LOGIC' + '_START__*/';
const PURE_END = '/*__PURE_LOGIC' + '_END__*/';

let v3;

beforeAll(async () => {
  const html = await readFile(LEGACY_PATH, 'utf8');
  const start = html.indexOf(PURE_START);
  const end = html.indexOf(PURE_END);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const body = html.slice(start + PURE_START.length, end);
  v3 = new Function(`${body}
    return {
      clamp, makeId, normalizeContentItem, contentItemHasMeaningfulData,
      normalizeProject, taskStats, computeProgress, projectMatchesActiveTags
    };`)();
});

/** Content-item inputs, each carrying an explicit id so output is comparable. */
const CONTENT_ITEM_CASES = [
  { id: 'a', type: 'task', text: 'plain task', completed: false },
  { id: 'b', type: 'task', text: 'done task', completed: 'truthy string' },
  { id: 'c', type: 'bullet', text: 'a bullet', completed: true },
  { id: 'd', type: 'bullet', text: '' },
  { id: 'e', type: 'link', label: 'Docs', url: 'https://example.com/docs' },
  { id: 'f', type: 'link', label: '', url: 'javascript:alert(1)' },
  { id: 'g', type: 'link' },
  { id: 'h', type: 'unknown-type', text: 'falls back to task' },
  { id: 'i', type: 'image', src: 'data:image/webp;base64,AAAA' },
  {
    id: 'j', type: 'image', src: 'data:image/png;base64,AA', caption: 'Cap',
    filename: 'a.png', mimeType: 'image/png', width: 1600, height: 900,
    displayWidth: 640, originalWidth: 4000, originalHeight: 2250,
    sizeBytes: 12345, optimizedAt: '2026-01-01T00:00:00.000Z', optimizationCap: 2400
  },
  { id: 'k', type: 'image', src: 'https://example.com/remote.png', width: 100 },
  { id: 'l', type: 'image', src: 'data:image/gif;base64,AA', width: 300, displayWidth: null },
  { id: 'm', type: 'image', src: 'data:image/gif;base64,AA', width: 300, displayWidth: '' },
  { id: 'n', type: 'image', src: 'data:image/gif;base64,AA', width: 300, displayWidth: 0 },
  { id: 'o', type: 'image', src: 'data:image/gif;base64,AA', width: 300, displayWidth: 40 },
  { id: 'p', type: 'image', src: 'data:image/gif;base64,AA', width: 300, displayWidth: 'abc' },
  { id: 'q', type: 'image', src: 'data:image/gif;base64,AA', width: 0, displayWidth: 0 },
  { id: 'r', type: 'image', src: 'data:image/avif;base64,AA', optimizationCap: 'source' },
  { id: 's', type: 'image', src: 'data:image/avif;base64,AA', optimizationCap: 0 },
  { id: 't', type: 'image', src: 'data:image/jpeg;base64,AA', width: -5, height: -5, sizeBytes: -9 },
  { id: 'u', type: 'image', src: 'DATA:IMAGE/PNG;base64,AA' },
  { id: 'v', type: 'image', src: 'data:image/svg+xml;base64,AA' },
  { id: 'w', type: 'task', text: 12345 },
  { id: 'x', type: 'task' },
  null,
  {}
];

/** Project inputs with explicit ids and timestamps, so output is comparable. */
const PROJECT_CASES = [
  {},
  null,
  { id: 'p1', name: 'Plain', createdAt: 'C', updatedAt: 'U' },
  {
    id: 'p2', name: 'Full', category: 'Hardware', status: 'Active', priority: 'High',
    progress: 42, deadline: '2026-08-14', link: 'https://example.com',
    nextAction: 'Ship it', tags: [' a ', '', 'b', 3], notes: 'n',
    createdAt: 'C', updatedAt: 'U', contentItems: CONTENT_ITEM_CASES
  },
  { id: 'p3', status: 'Zombie', priority: 'Urgent', progress: 250, createdAt: 'C', updatedAt: 'U' },
  { id: 'p4', progress: -20, createdAt: 'C', updatedAt: 'U' },
  { id: 'p5', progress: '88.9', createdAt: 'C', updatedAt: 'U' },
  { id: 'p6', progress: 100, status: 'Complete', createdAt: 'C', updatedAt: 'U' },
  { id: 'p7', tags: 'not-an-array', contentItems: 'not-an-array', createdAt: 'C', updatedAt: 'U' },
  { id: 'p8', name: '', category: null, notes: undefined, createdAt: 'C', updatedAt: 'U' },
  {
    id: 'p9', name: 'Future', futureField: 'unrelated', createdAt: 'C', updatedAt: 'U',
    contentItems: [{ id: 'z', type: 'task', text: 'a', completed: true, futureItemField: 1 }]
  },
  {
    id: 'p10', name: 'Empties', createdAt: 'C', updatedAt: 'U',
    contentItems: [
      { id: 'e1', type: 'task', text: '   ' },
      { id: 'e2', type: 'link', label: '', url: '' },
      { id: 'e3', type: 'image', src: '' }
    ]
  }
];

describe('normalizeContentItem matches legacy v3 exactly', () => {
  test.each(CONTENT_ITEM_CASES.map((item, index) => [index, item]))(
    'case %i',
    (_index, item) => {
      const ours = normalizeContentItem(item);
      const theirs = v3.normalizeContentItem(item);

      // An input without an id gets a fresh random one from each
      // implementation, so those cannot be compared directly.
      if (!item?.id) {
        expect(ours.id).toBeTruthy();
        expect(theirs.id).toBeTruthy();
        ours.id = theirs.id;
      }

      expect(ours).toEqual(theirs);
    }
  );

  test('generated ids are only used when the source has none', () => {
    expect(normalizeContentItem({ type: 'task' }).id).not.toBe('');
    expect(v3.normalizeContentItem({ type: 'task' }).id).not.toBe('');
  });
});

describe('contentItemHasMeaningfulData matches legacy v3 exactly', () => {
  test.each(CONTENT_ITEM_CASES.map((item, index) => [index, item]))(
    'case %i',
    (_index, item) => {
      expect(contentItemHasMeaningfulData(item))
        .toBe(v3.contentItemHasMeaningfulData(item));
    }
  );
});

describe('normalizeProject matches legacy v3 exactly', () => {
  test.each(PROJECT_CASES.map((project, index) => [index, project]))(
    'case %i',
    (_index, project) => {
      const ours = normalizeProject(project, 'NOW');
      const theirs = v3.normalizeProject(project);

      // Only fields the legacy code fills from `new Date()` may differ, and
      // only when the input omitted them.
      if (!project?.createdAt) {
        expect(ours.createdAt).toBe('NOW');
        ours.createdAt = theirs.createdAt;
        ours.updatedAt = theirs.updatedAt;
      }
      if (!project?.id) {
        expect(ours.id).toBeTruthy();
        ours.id = theirs.id;
      }

      expect(ours).toEqual(theirs);
    }
  );

  test('both implementations drop unrelated top-level fields', () => {
    const input = PROJECT_CASES.find(item => item?.id === 'p9');
    expect(normalizeProject(input, 'NOW').futureField).toBeUndefined();
    expect(v3.normalizeProject(input).futureField).toBeUndefined();
  });
});

describe('progress matches legacy v3 exactly', () => {
  const PROGRESS_CASES = [];
  for (const status of ['Planning', 'Active', 'Blocked', 'On Hold', 'Complete']) {
    for (const base of [0, 1, 42, 50, 98, 99]) {
      for (const taskCount of [0, 1, 2, 3, 4, 7]) {
        for (const completedCount of [0, 1, taskCount]) {
          if (completedCount > taskCount) continue;
          PROGRESS_CASES.push({
            id: 'x', name: 'x', status, progress: base,
            createdAt: 'C', updatedAt: 'U',
            contentItems: Array.from({ length: taskCount }, (_item, index) => ({
              id: `t${index}`, type: 'task', text: `t${index}`,
              completed: index < completedCount
            }))
          });
        }
      }
    }
  }

  test(`covers ${PROGRESS_CASES.length} status/base/task combinations`, () => {
    expect(PROGRESS_CASES.length).toBeGreaterThan(100);
    for (const input of PROGRESS_CASES) {
      const ours = normalizeProject(input, 'NOW');
      const theirs = v3.normalizeProject(input);
      expect(taskStats(ours)).toEqual(v3.taskStats(theirs));
      expect(computeProgress(ours)).toBe(v3.computeProgress(theirs));
    }
  });

  test('non-task content never moves the number, in either implementation', () => {
    const input = {
      id: 'x', name: 'x', status: 'Active', progress: 33,
      createdAt: 'C', updatedAt: 'U',
      contentItems: [
        { id: '1', type: 'bullet', text: 'b' },
        { id: '2', type: 'link', label: 'L', url: 'https://a.example' },
        { id: '3', type: 'image', src: 'data:image/png;base64,AA' }
      ]
    };
    expect(computeProgress(normalizeProject(input, 'NOW'))).toBe(33);
    expect(v3.computeProgress(v3.normalizeProject(input))).toBe(33);
  });
});

describe('tag filtering matches legacy v3 exactly', () => {
  const project = { tags: ['Hardware', 'Research', 'urgent'] };
  const TAG_CASES = [
    [], ['hardware'], ['HARDWARE'], ['hardware', 'research'],
    ['hardware', 'missing'], ['missing'], ['urgent', 'Hardware', 'RESEARCH']
  ];

  test.each(TAG_CASES.map((tags, index) => [index, tags]))('case %i', (_index, tags) => {
    expect(projectMatchesActiveTags(project, new Set(tags)))
      .toBe(v3.projectMatchesActiveTags(project, new Set(tags)));
  });
});

describe('legacy file integrity', () => {
  test('the reference application is unmodified in this working tree', async () => {
    const html = await readFile(LEGACY_PATH, 'utf8');
    expect(html).toContain('Project Command Center v3');
    // Byte length, not character length: the file contains multi-byte glyphs
    // (em dash, arrows, bullets) so the two differ by 40.
    expect((await readFile(LEGACY_PATH)).length).toBe(77837);
    expect(html.length).toBe(77797);
  });
});
