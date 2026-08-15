import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { beforeAll, describe, expect, test } from 'vitest';

import { getBuiltArtifact } from './helpers/built-artifact.js';
import { CURRENT_SCHEMA_VERSION } from '../src/persistence/data-capsule.js';
import { extractDataFromHtml } from '../src/persistence/extract.js';
import { injectDataCapsuleIntoShell } from '../src/persistence/standalone-export.js';
import { legacyDataRegionRegex } from '../src/persistence/markers.js';
import { migrateToSchema } from '../src/updater/migrations.js';
import { validateDataCapsule } from '../src/updater/validator.js';

/**
 * Gate B: a real legacy v3 HTML file becomes a working v4 file.
 *
 * The source is the actual reference application with fixture data injected
 * the way v3 itself would have written it, so this exercises the genuine
 * two-marker-region legacy layout rather than a convenient stand-in.
 *
 * The legacy file on disk is only ever read.
 */

let legacyWithData;
let v4Shell;
let fixture;

beforeAll(async () => {
  const [referenceHtml, fixtureJson, build] = await Promise.all([
    readFile('legacy/Project-Command-Center-v3.html', 'utf8'),
    readFile('tests/fixtures/legacy-v3-projects.json', 'utf8'),
    getBuiltArtifact()
  ]);

  fixture = JSON.parse(fixtureJson);

  // Write the fixture into the FIRST legacy region, exactly as v3's own save
  // does. BOTH replacements need a function replacer: the fixture contains
  // "$&", and a string replacement would substitute the matched text for it.
  // (Writing this the obvious way reproduced the v3 bug immediately: the note
  // "Watch the $& edge case." came back as "Watch the [] edge case.")
  let replaced = 0;
  const payload = JSON.stringify(fixture);
  legacyWithData = referenceHtml.replace(legacyDataRegionRegex(), (match) => {
    replaced += 1;
    return match.replace('[]', () => payload);
  });
  if (replaced !== 1) throw new Error(`expected to fill one legacy region, filled ${replaced}`);

  v4Shell = await readFile(build.path, 'utf8');
}, 120000);

describe('extraction from a real v3 file', () => {
  test('is recognised as legacy and inferred as schema 3', () => {
    const result = extractDataFromHtml(legacyWithData);
    expect(result.sourceFormat).toBe('legacy-v3');
    expect(result.capsule.schemaVersion).toBe(3);
    expect(result.capsule.projects).toHaveLength(3);
  });

  test('reads the data region, not v3 own template literal', () => {
    const { capsule } = extractDataFromHtml(legacyWithData);
    expect(capsule.projects.map(project => project.name))
      .toEqual(['Solar Battery Rig', 'Research Notes', 'Shipped Thing']);
  });
});

describe('the full upgrade pipeline', () => {
  let upgradedHtml;
  let finalCapsule;

  beforeAll(() => {
    const { capsule } = extractDataFromHtml(legacyWithData);
    const migration = migrateToSchema(capsule, CURRENT_SCHEMA_VERSION);
    const validation = validateDataCapsule(migration.capsule);
    if (!validation.valid) throw new Error(validation.errors.join('; '));

    upgradedHtml = injectDataCapsuleIntoShell(v4Shell, migration.capsule);
    finalCapsule = extractDataFromHtml(upgradedHtml).capsule;
  });

  test('migrates 3 to 4 and validates without errors or warnings', () => {
    const { capsule } = extractDataFromHtml(legacyWithData);
    const migration = migrateToSchema(capsule, CURRENT_SCHEMA_VERSION);

    expect(migration.applied).toEqual(['3 -> 4']);
    const validation = validateDataCapsule(migration.capsule);
    expect(validation.errors).toEqual([]);
    // The fixture deliberately contains a half-typed link url, which v3 stores
    // happily. It must warn, not block.
    expect(validation.warnings).toEqual([
      'projects[0].contentItems[6].url: is not an http(s) url and will not be clickable.'
    ]);
    expect(validation.valid).toBe(true);
  });

  test('re-extracts as a schema 4 capsule', () => {
    expect(finalCapsule.schemaVersion).toBe(4);
    expect(finalCapsule.projects).toHaveLength(3);
  });

  test('preserves every project field verbatim', () => {
    expect(finalCapsule.projects).toEqual(fixture);
  });

  test('preserves the embedded image byte for byte', () => {
    const source = fixture[0].contentItems.find(item => item.type === 'image');
    const result = finalCapsule.projects[0].contentItems.find(item => item.type === 'image');
    expect(result).toEqual(source);
    expect(result.src).toBe(source.src);
    expect(result.displayWidth).toBe(640);
    expect(result.sizeBytes).toBe(54321);
    expect(result.mimeType).toBe('image/webp');
    expect(result.caption).toBe('Prototype wiring, see https://example.com/wiring');
  });

  test('preserves task completion state', () => {
    const tasks = finalCapsule.projects[0].contentItems.filter(item => item.type === 'task');
    expect(tasks.map(task => task.completed)).toEqual([true, true, true, false]);
  });

  test('preserves links, including the unsafe one, exactly as stored', () => {
    const links = finalCapsule.projects[0].contentItems.filter(item => item.type === 'link');
    expect(links[0].url).toBe('https://example.com/datasheet.pdf');
    expect(links[1].url).toBe('htp://not-a-real-scheme');
  });

  test('preserves a note containing a dollar pattern', () => {
    expect(finalCapsule.projects[0].notes).toContain('Budget is $500 & climbing.');
    expect(finalCapsule.projects[0].notes).toContain('Watch the $& edge case.');
  });

  test('adds update preferences without touching project data', () => {
    expect(finalCapsule.preferences).toEqual({
      checkForUpdatesAutomatically: true,
      updateChannel: 'stable',
      automaticBackupBeforeUpdate: true
    });
  });

  test('the upgraded file carries no legacy marker', () => {
    expect(upgradedHtml).not.toContain('/*__PROJECT_DATA_START__*/');
    expect(upgradedHtml).not.toContain('/*__PROJECT_DATA_END__*/');
    expect(extractDataFromHtml(upgradedHtml).legacyMarkersPresent).toBe(false);
  });

  test('the upgraded file is a working application', () => {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    const dom = new JSDOM(upgradedHtml, {
      runScripts: 'dangerously',
      url: 'file:///upgraded.html',
      virtualConsole
    });
    const { document } = dom.window;

    expect([...document.querySelectorAll('.project-card .inline-name')].map(input => input.value))
      .toEqual(['Solar Battery Rig', 'Shipped Thing', 'Research Notes']);
    expect(document.querySelector('#metricTotal').textContent).toBe('3');
    expect(document.querySelector('#metricComplete').textContent).toBe('1');

    // 42 base with 3 of 4 tasks, and an explicitly Complete project at 100%.
    expect(document.querySelector('[data-project-id="legacy-p1"] .progress-value').textContent)
      .toBe('42.75%');
    expect(document.querySelector('[data-project-id="legacy-p3"] .progress-value').textContent)
      .toBe('100%');

    // The image survived into a rendered element.
    expect(document.querySelector('[data-item-id="l-i8"] .embedded-image').getAttribute('src'))
      .toBe(fixture[0].contentItems.find(item => item.type === 'image').src);

    // The unsafe link is inert.
    const unsafeBlock = document.querySelector('[data-item-id="l-i7"]');
    expect(unsafeBlock.querySelector('a')).toBeNull();
    expect(unsafeBlock.textContent).toContain('Invalid/empty URL');
  });

  test('the original v3 file is not modified by any of this', async () => {
    const onDisk = await readFile('legacy/Project-Command-Center-v3.html');
    expect(onDisk.length).toBe(77837);
  });
});

describe('the upgrade refuses to produce output when data is unsafe', () => {
  test('a remote image blocks the upgrade and no file is generated', () => {
    const capsule = {
      schemaVersion: 3,
      projects: [{
        id: 'p1',
        contentItems: [{ id: 'i1', type: 'image', src: 'https://example.com/remote.png' }]
      }],
      preferences: {}
    };

    const migration = migrateToSchema(capsule, CURRENT_SCHEMA_VERSION);
    const validation = validateDataCapsule(migration.capsule);

    expect(validation.valid).toBe(false);
    expect(validation.errors[0]).toMatch(/remote url/);
    // The caller must stop here; nothing downstream runs.
  });

  test('an unmigratable schema blocks before any output is produced', () => {
    expect(() => migrateToSchema({ schemaVersion: 2, projects: [] }, CURRENT_SCHEMA_VERSION))
      .toThrow(/No migration is registered for schema 2/);
  });
});
