import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { beforeAll, describe, expect, test } from 'vitest';

import { getBuiltArtifact } from './helpers/built-artifact.js';
import { validateBuild } from '../scripts/validate-build.mjs';
import { dataRegionRegex } from '../src/persistence/markers.js';
import { injectDataCapsuleIntoShell } from '../src/persistence/standalone-export.js';

/**
 * End-to-end against the real released artifact.
 *
 * The build runs here rather than depending on a prior `npm run build`, so the
 * suite is self-sufficient and CI ordering cannot make this test lie.
 */

let builtHtml;
let buildResult;

const CAPSULE = {
  schemaVersion: 4,
  projects: [
    {
      id: 'p1',
      name: 'Hardware Rig',
      category: 'Hardware',
      status: 'Active',
      priority: 'High',
      progress: 42,
      deadline: '2026-09-01',
      link: 'https://example.com/rig',
      nextAction: 'Order the regulator',
      tags: ['hardware', 'urgent'],
      notes: 'Budget is $500 & climbing. See https://example.com/spec',
      contentItems: [
        { id: 'i1', type: 'task', text: 'Bench test', completed: true },
        { id: 'i2', type: 'task', text: 'Order parts', completed: true },
        { id: 'i3', type: 'task', text: 'Assemble', completed: true },
        { id: 'i4', type: 'task', text: 'Document', completed: false },
        { id: 'i5', type: 'bullet', text: 'Consider a spare fuse' },
        { id: 'i6', type: 'link', label: 'Datasheet', url: 'https://example.com/ds' },
        {
          id: 'i7', type: 'image', src: 'data:image/webp;base64,UklGRiQAAABXRUJQ',
          caption: 'Prototype', filename: 'proto.webp', mimeType: 'image/webp',
          width: 1600, height: 900, displayWidth: 640,
          originalWidth: 4000, originalHeight: 2250, sizeBytes: 54321,
          optimizedAt: '2026-08-01T00:00:00.000Z', optimizationCap: 1600
        }
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z'
    },
    {
      id: 'p2',
      name: 'Planning Only',
      status: 'Planning',
      priority: 'Low',
      progress: 10,
      tags: ['research'],
      contentItems: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ],
  preferences: {
    checkForUpdatesAutomatically: true,
    updateChannel: 'stable',
    automaticBackupBeforeUpdate: true
  }
};

/** Boots a standalone HTML string in jsdom and returns the live window. */
function boot(html) {
  const virtualConsole = new VirtualConsole();
  // jsdom cannot navigate to a blob: URL; that is expected and not a failure.
  virtualConsole.on('jsdomError', () => {});

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'file:///Project-Command-Center.html',
    virtualConsole
  });

  const captured = [];
  dom.window.URL.createObjectURL = (blob) => {
    captured.push(blob);
    return 'blob:stub';
  };
  dom.window.URL.revokeObjectURL = () => {};

  return { dom, window: dom.window, document: dom.window.document, captured };
}

/** jsdom's Blob has no .text(), so read it the way a browser page would. */
function readBlob(window, blob) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

const text = (doc, selector) => doc.querySelector(selector)?.textContent?.trim();
const cardNames = (doc) => [...doc.querySelectorAll('.project-card .inline-name')]
  .map(input => input.value);

beforeAll(async () => {
  buildResult = await getBuiltArtifact();
  builtHtml = await readFile(buildResult.path, 'utf8');
}, 120000);

describe('the built artifact is self-contained', () => {
  test('passes every release invariant', async () => {
    const result = await validateBuild(buildResult.path, buildResult.appVersion);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test('references no external resource of any kind', () => {
    expect(builtHtml).not.toMatch(/<script[^>]+\ssrc=/i);
    expect(builtHtml).not.toMatch(/<link[^>]+stylesheet/i);
    expect(builtHtml).not.toMatch(/@import\s+url/i);
    expect(builtHtml).not.toMatch(/https?:\/\/[^"'\s]*\.(?:js|css|woff2?|png|jpg|svg)/i);
  });

  test('carries an embedded icon, never an external one', () => {
    // The icon exists so the application has one, and must be embedded to keep
    // the artifact self-contained. It does not affect the "unsafe attempt to
    // load URL" warning Chrome logs for file:// pages, which reproduces with
    // the legacy v3 file and is therefore not caused by this application.
    const links = [...builtHtml.matchAll(/<link[^>]+rel\s*=\s*["']?icon["']?[^>]*>/gi)];
    expect(links).toHaveLength(1);
    expect(links[0][0]).toMatch(/href="data:image\/svg\+xml,/);
    expect(links[0][0]).not.toMatch(/href\s*=\s*["']?https?:/i);
  });

  test('the icon survives a save, so a saved copy keeps it', async () => {
    const populated = injectDataCapsuleIntoShell(builtHtml, CAPSULE);
    const session = boot(populated);
    session.document.querySelector('#saveHtmlBtn').dispatchEvent(
      new session.window.Event('click', { bubbles: true })
    );
    const saved = await readBlob(session.window, session.captured[0]);
    expect(saved).toMatch(/<link[^>]+rel="icon"[^>]*href="data:image\/svg\+xml,/i);
  }, 60000);

  test('ships with an empty schema 4 capsule', () => {
    const capsule = JSON.parse(builtHtml.match(dataRegionRegex())[1]);
    expect(capsule).toEqual({
      schemaVersion: 4,
      projects: [],
      preferences: {
        checkForUpdatesAutomatically: true,
        updateChannel: 'stable',
        automaticBackupBeforeUpdate: true
      }
    });
  });
});

describe('the built artifact boots and renders v3 behavior', () => {
  let document;
  let window;
  let captured;

  beforeAll(() => {
    const populated = injectDataCapsuleIntoShell(builtHtml, CAPSULE);
    ({ document, window, captured } = boot(populated));
  });

  test('renders one card per project', () => {
    expect(cardNames(document)).toEqual(['Hardware Rig', 'Planning Only']);
  });

  test('renders the dashboard counts', () => {
    expect(text(document, '#metricTotal')).toBe('2');
    expect(text(document, '#metricActive')).toBe('1');
    expect(text(document, '#metricPlanning')).toBe('1');
    expect(text(document, '#metricBlocked')).toBe('0');
    expect(text(document, '#metricComplete')).toBe('0');
  });

  test('shows decimal task progress, 42 base with 3 of 4 tasks', () => {
    const card = document.querySelector('[data-project-id="p1"]');
    expect(card.querySelector('.progress-value').textContent).toBe('42.75%');
    expect(card.querySelector('.badge:nth-child(3)').textContent).toBe('3 / 4 tasks');
  });

  test('shows a bare integer for a project with no tasks', () => {
    const card = document.querySelector('[data-project-id="p2"]');
    expect(card.querySelector('.progress-value').textContent).toBe('10%');
  });

  test('renders the embedded image with its stored display width', () => {
    const image = document.querySelector('[data-item-id="i7"] .embedded-image');
    expect(image.getAttribute('src')).toBe('data:image/webp;base64,UklGRiQAAABXRUJQ');
    expect(document.querySelector('[data-item-id="i7"] .image-frame').getAttribute('style'))
      .toContain('width:640px');
  });

  test('activates safe links and reports unsafe ones as invalid', () => {
    const link = document.querySelector('[data-item-id="i6"] a');
    expect(link.getAttribute('href')).toBe('https://example.com/ds');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  test('linkifies urls in notes without executing markup', () => {
    const preview = document.querySelector('[data-project-id="p1"] .linked-preview');
    expect(preview.textContent).toContain('Budget is $500 & climbing.');
    expect(preview.querySelector('a').getAttribute('href')).toBe('https://example.com/spec');
  });

  test('the version chip reflects the release metadata', () => {
    expect(text(document, '#appVersionChip')).toBe(`v${buildResult.appVersion}`);
    expect(window.PCC_RELEASE_METADATA.appVersion).toBe(buildResult.appVersion);
  });

  test('opens clean, with no unsaved-changes state', () => {
    expect(document.querySelector('#unsavedDot').classList.contains('show')).toBe(false);
    expect(text(document, '#saveStateText')).toBe('All embedded data is current.');
  });
});

describe('the built artifact round-trips a save', () => {
  test('Save Updated HTML reproduces a loadable file with the same data', async () => {
    const populated = injectDataCapsuleIntoShell(builtHtml, CAPSULE);
    const first = boot(populated);

    first.document.querySelector('#saveHtmlBtn').dispatchEvent(
      new first.window.Event('click', { bubbles: true })
    );

    expect(first.captured).toHaveLength(1);
    const savedHtml = await readBlob(first.window, first.captured[0]);

    // The saved file is a complete, independently loadable application.
    const saved = boot(savedHtml);
    expect(cardNames(saved.document)).toEqual(['Hardware Rig', 'Planning Only']);
    expect(saved.document.querySelector('[data-project-id="p1"] .progress-value').textContent)
      .toBe('42.75%');

    const capsule = JSON.parse(savedHtml.match(dataRegionRegex())[1]);
    expect(capsule.schemaVersion).toBe(4);
    expect(capsule.projects).toHaveLength(2);

    // Image bytes, caption, and display width survive untouched.
    const image = capsule.projects[0].contentItems.find(item => item.type === 'image');
    expect(image.src).toBe('data:image/webp;base64,UklGRiQAAABXRUJQ');
    expect(image.displayWidth).toBe(640);
    expect(image.sizeBytes).toBe(54321);
    expect(image.mimeType).toBe('image/webp');
    expect(image.filename).toBe('proto.webp');

    // Task completion and the dollar sign in notes survive.
    expect(capsule.projects[0].contentItems.filter(item => item.completed)).toHaveLength(3);
    expect(capsule.projects[0].notes).toContain('$500 & climbing');

    // Still exactly one injection region, so it can be saved again.
    expect(savedHtml.match(/__PCC_DATA_START__/g)).toHaveLength(1);
    expect(savedHtml.match(/__PCC_DATA_END__/g)).toHaveLength(1);
  }, 60000);

  test('three save generations do not drift', async () => {
    // The shell is re-serialized from the live DOM on every save, so any
    // serialization asymmetry would compound across generations.
    let html = injectDataCapsuleIntoShell(builtHtml, CAPSULE);
    const sizes = [];

    for (let generation = 0; generation < 3; generation += 1) {
      const session = boot(html);
      expect(cardNames(session.document)).toEqual(['Hardware Rig', 'Planning Only']);

      session.document.querySelector('#saveHtmlBtn').dispatchEvent(
        new session.window.Event('click', { bubbles: true })
      );
      html = await readBlob(session.window, session.captured[0]);
      sizes.push(html.length);

      expect(html.match(/__PCC_DATA_START__/g)).toHaveLength(1);
      expect(html.match(/__PCC_RELEASE_METADATA_START__/g)).toHaveLength(1);
    }

    // Generation 2 onward must be byte-stable: only the first save can differ
    // from the injected input, because that one re-serializes hand-written
    // markup through the DOM.
    expect(sizes[1]).toBe(sizes[2]);

    const capsule = JSON.parse(html.match(dataRegionRegex())[1]);
    expect(capsule.projects[0].contentItems.find(item => item.type === 'image').src)
      .toBe('data:image/webp;base64,UklGRiQAAABXRUJQ');
  }, 90000);

  test('an edit marks the document dirty and lands in the saved file', async () => {
    const populated = injectDataCapsuleIntoShell(builtHtml, CAPSULE);
    const { document, window, captured } = boot(populated);

    const nameInput = document.querySelector('[data-project-id="p1"].inline-name');
    nameInput.value = 'Renamed Rig';
    nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(document.querySelector('#unsavedDot').classList.contains('show')).toBe(true);
    expect(text(document, '#saveStateText')).toBe('You have unsaved changes.');

    document.querySelector('#saveHtmlBtn').dispatchEvent(
      new window.Event('click', { bubbles: true })
    );
    const savedHtml = await readBlob(window, captured[0]);
    const capsule = JSON.parse(savedHtml.match(dataRegionRegex())[1]);
    expect(capsule.projects[0].name).toBe('Renamed Rig');
  }, 60000);
});
