import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  ALL_MARKER_TOKENS,
  DATA_END,
  DATA_START,
  countOccurrences,
  dataRegionRegex,
  findMarkerTokens,
  metadataRegionRegex
} from '../src/persistence/markers.js';

async function collectSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(full)));
    } else if (/\.(js|html|css)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe('marker tokens', () => {
  test('no bundled source file contains a contiguous marker token', async () => {
    const files = await collectSourceFiles('src');
    expect(files.length).toBeGreaterThan(0);

    const offenders = [];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      for (const token of ALL_MARKER_TOKENS) {
        if (text.includes(token)) offenders.push(`${file} contains ${token}`);
      }
    }

    // A single contiguous token in bundled source would put a second copy of
    // the injection region into the released HTML.
    expect(offenders).toEqual([]);
  });

  test('markers.js itself exposes the exact contract names', () => {
    expect(DATA_START).toBe('/*__PCC_DATA_START__*/');
    expect(DATA_END).toBe('/*__PCC_DATA_END__*/');
    expect(ALL_MARKER_TOKENS).toContain('__PCC_RELEASE_METADATA_START__');
    expect(ALL_MARKER_TOKENS).toContain('__PCC_RELEASE_METADATA_END__');
    expect(ALL_MARKER_TOKENS).toContain('__PROJECT_DATA_START__');
    expect(ALL_MARKER_TOKENS).toContain('__PROJECT_DATA_END__');
  });
});

describe('region regexes', () => {
  test('data region regex captures only the payload', () => {
    const html = `x ${DATA_START}{"schemaVersion":4}${DATA_END} y`;
    const match = html.match(dataRegionRegex());
    expect(match[1]).toBe('{"schemaVersion":4}');
  });

  test('data region regex is non-greedy across two regions', () => {
    const html = `${DATA_START}A${DATA_END} middle ${DATA_START}B${DATA_END}`;
    expect(html.match(dataRegionRegex())[1]).toBe('A');
  });

  test('metadata region regex is independent of the data region', () => {
    const html = `${DATA_START}{}${DATA_END}`;
    expect(html.match(metadataRegionRegex())).toBeNull();
  });
});

describe('helpers', () => {
  test('countOccurrences counts literal, overlapping-free matches', () => {
    expect(countOccurrences(`${DATA_START}${DATA_START}`, DATA_START)).toBe(2);
    expect(countOccurrences('nothing here', DATA_START)).toBe(0);
  });

  test('findMarkerTokens detects marker text hidden in user data', () => {
    expect(findMarkerTokens('a note mentioning __PCC_DATA_END__ inline'))
      .toEqual(['__PCC_DATA_END__']);
    expect(findMarkerTokens('an ordinary note')).toEqual([]);
    expect(findMarkerTokens(null)).toEqual([]);
  });
});
