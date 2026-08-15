import { describe, expect, test } from 'vitest';

import {
  DATA_END,
  DATA_START,
  METADATA_END,
  METADATA_START,
  dataRegionRegex
} from '../src/persistence/markers.js';
import {
  buildProjectsJsonBackup,
  cleanProjectsForExport,
  injectDataCapsuleIntoShell,
  serializeForEmbeddedJson
} from '../src/persistence/standalone-export.js';

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

const shell = (dataPayload = '{"schemaVersion":4,"projects":[]}') => `<!DOCTYPE html>
<html><body>
<script>
window.PCC_RELEASE_METADATA =
${METADATA_START}{"appVersion":"4.1.0","schemaVersion":4,"minSchemaVersion":3}${METADATA_END};
window.PCC_DATA =
${DATA_START}${dataPayload}${DATA_END};
</script>
</body></html>`;

/** Pulls the capsule back out the way the extractor will. */
const extract = (html) => JSON.parse(html.match(dataRegionRegex())[1]);

describe('serializeForEmbeddedJson', () => {
  test('escapes every character that could break out of the script block', () => {
    const payload = serializeForEmbeddedJson({
      lt: '</script>',
      ls: `a${LS}b`,
      ps: `a${PS}b`,
      comment: 'ends a comment */ here'
    });

    expect(payload).not.toContain('</script>');
    expect(payload).not.toContain(LS);
    expect(payload).not.toContain(PS);
    expect(payload).not.toContain('*/');
    expect(payload).toContain('\\u003C');
    expect(payload).toContain('\\u2028');
    expect(payload).toContain('*\\/');
  });

  test('every escape round-trips through JSON.parse unchanged', () => {
    const original = {
      lt: '</script><img onerror=alert(1)>',
      ls: `a${LS}b`,
      ps: `a${PS}b`,
      comment: 'ends a comment */ here',
      unicode: 'emoji 🚀 and accents éàü'
    };
    expect(JSON.parse(serializeForEmbeddedJson(original))).toEqual(original);
  });

  test('refuses to emit data that reproduces an injection marker', () => {
    // Escaping star-slash already prevents this, so reaching the guard means
    // an escape was removed. The guard is the backstop for that regression.
    const payload = serializeForEmbeddedJson({ note: `text ${DATA_END} text` });
    expect(payload).not.toContain(DATA_END);
    expect(JSON.parse(payload).note).toBe(`text ${DATA_END} text`);
  });
});

describe('injectDataCapsuleIntoShell', () => {
  test('replaces the data region and leaves release metadata intact', () => {
    const result = injectDataCapsuleIntoShell(shell(), {
      schemaVersion: 4,
      projects: [{ id: 'p1', name: 'Preserved' }],
      preferences: {}
    });

    expect(result).toContain('"name": "Preserved"');
    expect(result).toContain('"appVersion":"4.1.0"');
    expect(extract(result).projects[0].name).toBe('Preserved');
  });

  test('rejects a shell with no data region', () => {
    expect(() => injectDataCapsuleIntoShell('<html></html>', { schemaVersion: 4 }))
      .toThrow(/exactly one Data Capsule region/);
  });

  test('rejects a shell with two data regions', () => {
    const doubled = shell() + shell();
    expect(() => injectDataCapsuleIntoShell(doubled, { schemaVersion: 4 }))
      .toThrow(/exactly one Data Capsule region/);
  });

  test('replacing twice is stable and does not nest regions', () => {
    const once = injectDataCapsuleIntoShell(shell(), {
      schemaVersion: 4, projects: [{ id: 'a', name: 'One' }], preferences: {}
    });
    const twice = injectDataCapsuleIntoShell(once, {
      schemaVersion: 4, projects: [{ id: 'b', name: 'Two' }], preferences: {}
    });

    expect(extract(twice).projects[0].name).toBe('Two');
    expect(twice.split(DATA_START)).toHaveLength(2);
    expect(twice.split(DATA_END)).toHaveLength(2);
  });
});

describe('dollar-pattern corruption (legacy v3 bug, line 1417)', () => {
  // v3 passes the payload to String.replace as a STRING, so these patterns are
  // interpreted as replacement directives and splice document text into the
  // user's data. Verified against v3: a note of "price $& and $' here" comes
  // back as "price /*S*/[]/*E*/ and <rest of file> here".
  const HOSTILE = [
    'price $& and more',
    "quote $' tail",
    'backtick $` head',
    'group $1 reference',
    'literal $$ dollars',
    'all of them $& $` $\' $1 $$'
  ];

  test.each(HOSTILE)('a note containing %j survives a save verbatim', (notes) => {
    const capsule = {
      schemaVersion: 4,
      projects: [{ id: 'p1', name: 'Money', notes }],
      preferences: {}
    };

    const result = injectDataCapsuleIntoShell(shell(), capsule);
    expect(extract(result).projects[0].notes).toBe(notes);
  });

  test('a dollar pattern cannot leak surrounding document text into data', () => {
    const result = injectDataCapsuleIntoShell(shell(), {
      schemaVersion: 4,
      projects: [{ id: 'p1', notes: "$'" }],
      preferences: {}
    });
    const notes = extract(result).projects[0].notes;
    expect(notes).toBe("$'");
    expect(notes).not.toContain('script');
    expect(notes).not.toContain('PCC');
  });
});

describe('marker text hidden in user data', () => {
  test('a note containing the end marker cannot truncate the capsule', () => {
    const notes = `sneaky ${DATA_END} still mine`;
    const result = injectDataCapsuleIntoShell(shell(), {
      schemaVersion: 4,
      projects: [
        { id: 'p1', name: 'First', notes },
        { id: 'p2', name: 'Survives after the marker' }
      ],
      preferences: {}
    });

    const capsule = extract(result);
    expect(capsule.projects).toHaveLength(2);
    expect(capsule.projects[0].notes).toBe(notes);
    expect(capsule.projects[1].name).toBe('Survives after the marker');
  });

  test('a note containing the legacy v3 marker is equally safe', () => {
    const notes = 'legacy /*__PROJECT_DATA_END__*/ text';
    const result = injectDataCapsuleIntoShell(shell(), {
      schemaVersion: 4, projects: [{ id: 'p1', notes }], preferences: {}
    });
    expect(extract(result).projects[0].notes).toBe(notes);
    // The v4 artifact must never contain a live legacy marker.
    expect(result).not.toContain('/*__PROJECT_DATA_END__*/');
  });
});

describe('cleanProjectsForExport (v3 parity)', () => {
  test('drops empty content items but keeps the project', () => {
    const cleaned = cleanProjectsForExport([{
      id: 'p1',
      name: 'A',
      contentItems: [
        { id: '1', type: 'task', text: 'keep' },
        { id: '2', type: 'task', text: '   ' },
        { id: '3', type: 'link', label: '', url: '' },
        { id: '4', type: 'image', src: '' }
      ]
    }]);

    expect(cleaned[0].contentItems).toHaveLength(1);
    expect(cleaned[0].name).toBe('A');
  });

  test('preserves unrelated project fields', () => {
    const cleaned = cleanProjectsForExport([{ id: 'p1', futureField: 'kept' }]);
    expect(cleaned[0].futureField).toBe('kept');
  });
});

describe('buildProjectsJsonBackup (v3 parity)', () => {
  test('matches the v3 JSON backup shape exactly', () => {
    const backup = buildProjectsJsonBackup(
      [{ id: 'p1', name: 'A', contentItems: [] }],
      '2026-08-15T00:00:00.000Z'
    );
    expect(Object.keys(backup)).toEqual(['exportedAt', 'projectCount', 'projects']);
    expect(backup).toMatchObject({
      exportedAt: '2026-08-15T00:00:00.000Z',
      projectCount: 1
    });
  });
});
