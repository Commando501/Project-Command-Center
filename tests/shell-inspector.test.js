import { describe, expect, test } from 'vitest';

import {
  DATA_END,
  DATA_START,
  METADATA_END,
  METADATA_START
} from '../src/persistence/markers.js';
import {
  ShellInspectionError,
  inspectReleaseShell,
  isSchemaSupportedByShell
} from '../src/updater/shell-inspector.js';

const METADATA = {
  appVersion: '4.1.0',
  schemaVersion: 4,
  minSchemaVersion: 3,
  updateChannel: 'stable',
  repository: 'owner/project-command-center'
};

const shell = ({ metadata = METADATA, dataRegions = 1, metadataRegions = 1 } = {}) => {
  const metaBlock = `${METADATA_START}${JSON.stringify(metadata)}${METADATA_END}`;
  const dataBlock = `${DATA_START}{"schemaVersion":4,"projects":[]}${DATA_END}`;
  return `<html><body><script>
${Array.from({ length: metadataRegions }, () => metaBlock).join('\n')}
${Array.from({ length: dataRegions }, () => dataBlock).join('\n')}
</script></body></html>`;
};

describe('inspecting a valid release shell', () => {
  test('returns the release identity', () => {
    expect(inspectReleaseShell(shell())).toEqual(METADATA);
  });

  test('defaults a missing channel to stable and a missing repository to blank', () => {
    const result = inspectReleaseShell(shell({
      metadata: { appVersion: '4.1.0', schemaVersion: 4, minSchemaVersion: 3 }
    }));
    expect(result.updateChannel).toBe('stable');
    expect(result.repository).toBe('');
  });

  test('never executes script from the candidate', () => {
    globalThis.__PCC_SHELL_CANARY__ = false;
    inspectReleaseShell(
      '<script>globalThis.__PCC_SHELL_CANARY__ = true;</script>' + shell()
    );
    expect(globalThis.__PCC_SHELL_CANARY__).toBe(false);
    delete globalThis.__PCC_SHELL_CANARY__;
  });
});

describe('rejected candidates', () => {
  test('a file with no release metadata', () => {
    expect(() => inspectReleaseShell('<html>Just a web page</html>'))
      .toThrow(/does not look like a Project Command Center release/);
    expect(() => inspectReleaseShell('')).toThrow(ShellInspectionError);
  });

  test('two release metadata regions', () => {
    expect(() => inspectReleaseShell(shell({ metadataRegions: 2 })))
      .toThrow(/found 2 start and 2 end markers/);
  });

  test('no Data Capsule region to inject into', () => {
    expect(() => inspectReleaseShell(shell({ dataRegions: 0 })))
      .toThrow(/exactly one Data Capsule region/);
  });

  test('two Data Capsule regions', () => {
    expect(() => inspectReleaseShell(shell({ dataRegions: 2 })))
      .toThrow(/exactly one Data Capsule region/);
  });

  test('metadata that is not valid JSON', () => {
    const broken = `<script>${METADATA_START}{nope}${METADATA_END}
${DATA_START}{}${DATA_END}</script>`;
    expect(() => inspectReleaseShell(broken)).toThrow(/not valid JSON/);
  });

  test('metadata that is not an object', () => {
    const arrayMetadata = `<script>${METADATA_START}[1,2]${METADATA_END}
${DATA_START}{}${DATA_END}</script>`;
    expect(() => inspectReleaseShell(arrayMetadata)).toThrow(/not an object/);
  });

  test('a missing or malformed application version', () => {
    for (const appVersion of [undefined, '', '4.1', 'latest', 42]) {
      expect(() => inspectReleaseShell(shell({ metadata: { ...METADATA, appVersion } })))
        .toThrow(/no usable application version/);
    }
  });

  test('missing schema versions', () => {
    expect(() => inspectReleaseShell(shell({ metadata: { ...METADATA, schemaVersion: undefined } })))
      .toThrow(/no usable schema version/);
    expect(() => inspectReleaseShell(shell({ metadata: { ...METADATA, minSchemaVersion: '3' } })))
      .toThrow(/no usable minimum schema version/);
  });

  test('a candidate whose schema is below its own minimum', () => {
    expect(() => inspectReleaseShell(shell({
      metadata: { ...METADATA, schemaVersion: 3, minSchemaVersion: 4 }
    }))).toThrow(/schema 3 is below its own minimum of 4/);
  });
});

describe('isSchemaSupportedByShell', () => {
  const metadata = { schemaVersion: 6, minSchemaVersion: 3 };

  test('accepts a schema inside the declared range', () => {
    expect(isSchemaSupportedByShell(3, metadata)).toBe(true);
    expect(isSchemaSupportedByShell(4, metadata)).toBe(true);
    expect(isSchemaSupportedByShell(6, metadata)).toBe(true);
  });

  test('rejects data older than the release supports', () => {
    expect(isSchemaSupportedByShell(2, metadata)).toBe(false);
  });

  test('rejects data newer than the release understands', () => {
    // Installing this would silently downgrade the user's data format.
    expect(isSchemaSupportedByShell(7, metadata)).toBe(false);
  });

  test('rejects a non-integer schema', () => {
    expect(isSchemaSupportedByShell('4', metadata)).toBe(false);
    expect(isSchemaSupportedByShell(undefined, metadata)).toBe(false);
  });
});
