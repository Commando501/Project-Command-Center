import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

import { ExtractionError, extractDataFromHtml } from '../src/persistence/extract.js';
import {
  DATA_END,
  DATA_START,
  LEGACY_DATA_END,
  LEGACY_DATA_START
} from '../src/persistence/markers.js';

const pccHtml = (payload) => `<script>window.PCC_DATA =\n${DATA_START}${payload}${DATA_END};\n</script>`;
const legacyHtml = (payload) => `<script>const EMBEDDED_PROJECTS =\n${LEGACY_DATA_START}${payload}${LEGACY_DATA_END};\n</script>`;

describe('v4 capsule extraction', () => {
  test('reads a schema 4 capsule', () => {
    const result = extractDataFromHtml(
      pccHtml('{"schemaVersion":4,"projects":[{"id":"p1","name":"A"}],"preferences":{}}')
    );
    expect(result.sourceFormat).toBe('pcc-data');
    expect(result.capsule.schemaVersion).toBe(4);
    expect(result.capsule.projects[0].name).toBe('A');
  });

  test('fills default preferences when the capsule omits them', () => {
    const result = extractDataFromHtml(pccHtml('{"schemaVersion":4,"projects":[]}'));
    expect(result.capsule.preferences).toEqual({
      checkForUpdatesAutomatically: true,
      updateChannel: 'stable',
      automaticBackupBeforeUpdate: true
    });
  });

  test('rejects two capsule regions', () => {
    expect(() => extractDataFromHtml(pccHtml('{"schemaVersion":4}') + pccHtml('{"schemaVersion":4}')))
      .toThrow(ExtractionError);
  });

  test('rejects a start marker with no end marker', () => {
    expect(() => extractDataFromHtml(`<script>${DATA_START}{"schemaVersion":4}</script>`))
      .toThrow(/no matching end marker/);
  });

  test('rejects non-JSON marker content', () => {
    expect(() => extractDataFromHtml(pccHtml('{not json}')))
      .toThrow(/not valid JSON/);
  });

  test('never executes script from the candidate file', () => {
    globalThis.__PCC_EXTRACT_CANARY__ = false;
    const hostile = `<script>globalThis.__PCC_EXTRACT_CANARY__ = true;</script>`
      + pccHtml('{"schemaVersion":4,"projects":[]}');
    extractDataFromHtml(hostile);
    expect(globalThis.__PCC_EXTRACT_CANARY__).toBe(false);
    delete globalThis.__PCC_EXTRACT_CANARY__;
  });
});

describe('legacy v3 extraction', () => {
  test('wraps a bare project array as inferred schema 3', () => {
    const result = extractDataFromHtml(legacyHtml('[{"id":"p1","name":"Legacy"}]'));
    expect(result.sourceFormat).toBe('legacy-v3');
    expect(result.capsule.schemaVersion).toBe(3);
    expect(result.capsule.projects[0].name).toBe('Legacy');
  });

  test('tolerates the two marker regions every real v3 file contains', () => {
    // The second region is v3's own template literal inside buildUpdatedHtml.
    // The first region is the data, which is what v3 itself treats as
    // authoritative because String.replace takes the first match.
    const html = legacyHtml('[{"id":"real","name":"Real Data"}]')
      + '\nconst embedded = `' + LEGACY_DATA_START + '${serialize()}' + LEGACY_DATA_END + '`;';
    const result = extractDataFromHtml(html);
    expect(result.capsule.projects).toHaveLength(1);
    expect(result.capsule.projects[0].name).toBe('Real Data');
  });

  test('backfills a missing project id, as v3 does on load', () => {
    const result = extractDataFromHtml(legacyHtml('[{"name":"No Id"}]'));
    expect(result.capsule.projects[0].id).toBeTruthy();
    expect(result.capsule.projects[0].name).toBe('No Id');
  });

  test('preserves an existing project id untouched', () => {
    const result = extractDataFromHtml(legacyHtml('[{"id":"keep","name":"A"}]'));
    expect(result.capsule.projects[0].id).toBe('keep');
  });

  test('rejects legacy data that is not an array', () => {
    expect(() => extractDataFromHtml(legacyHtml('{"nope":true}')))
      .toThrow(/not an array/);
  });
});

describe('format precedence and failure', () => {
  test('the v4 contract wins when both marker families are present', () => {
    const html = pccHtml('{"schemaVersion":4,"projects":[{"id":"new","name":"V4"}]}')
      + legacyHtml('[{"id":"old","name":"V3"}]');
    const result = extractDataFromHtml(html);
    expect(result.sourceFormat).toBe('pcc-data');
    expect(result.capsule.projects[0].name).toBe('V4');
    expect(result.legacyMarkersPresent).toBe(true);
  });

  test('a clean v4 file reports no legacy markers', () => {
    expect(extractDataFromHtml(pccHtml('{"schemaVersion":4,"projects":[]}')).legacyMarkersPresent)
      .toBe(false);
  });

  test('a file with no markers at all is rejected', () => {
    expect(() => extractDataFromHtml('<html><body>Not our file</body></html>'))
      .toThrow(/No Project Command Center data markers/);
    expect(() => extractDataFromHtml('')).toThrow(ExtractionError);
  });
});

describe('the real legacy v3 application', () => {
  test('extracts as schema 3 despite containing two marker regions', async () => {
    const html = await readFile('legacy/Project-Command-Center-v3.html', 'utf8');
    const result = extractDataFromHtml(html);
    expect(result.sourceFormat).toBe('legacy-v3');
    expect(result.capsule.schemaVersion).toBe(3);
    // The shipped reference carries an empty project array.
    expect(result.capsule.projects).toEqual([]);
  });
});
