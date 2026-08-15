import { describe, expect, test } from 'vitest';

import { validateDataCapsule } from '../src/updater/validator.js';

const capsule = (overrides = {}) => ({
  schemaVersion: 4,
  projects: [],
  preferences: { checkForUpdatesAutomatically: true, updateChannel: 'stable', automaticBackupBeforeUpdate: true },
  ...overrides
});

const withProject = (project) => capsule({ projects: [{ id: 'p1', ...project }] });

const errorText = (result) => result.errors.join(' | ');
const warningText = (result) => result.warnings.join(' | ');

describe('structural errors abort the update', () => {
  test('a valid capsule passes cleanly', () => {
    const result = validateDataCapsule(capsule());
    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  test('a non-object capsule', () => {
    expect(validateDataCapsule(null).valid).toBe(false);
    expect(validateDataCapsule([]).valid).toBe(false);
    expect(validateDataCapsule('nope').valid).toBe(false);
  });

  test('the wrong schema version', () => {
    const result = validateDataCapsule(capsule({ schemaVersion: 3 }));
    expect(result.valid).toBe(false);
    expect(errorText(result)).toMatch(/expected 4, received 3/);
  });

  test('projects that are not an array', () => {
    const result = validateDataCapsule(capsule({ projects: 'nope' }));
    expect(result.valid).toBe(false);
    expect(errorText(result)).toMatch(/projects: expected an array/);
  });

  test('a project without an id, because edits would hit the wrong record', () => {
    for (const id of [undefined, '', '   ', 42, null]) {
      const result = validateDataCapsule(capsule({ projects: [{ id }] }));
      expect(result.valid).toBe(false);
      expect(errorText(result)).toMatch(/must have a non-empty id/);
    }
  });

  test('contentItems that are not an array', () => {
    const result = validateDataCapsule(withProject({ contentItems: 'nope' }));
    expect(result.valid).toBe(false);
    expect(errorText(result)).toMatch(/contentItems: expected an array/);
  });

  test('preferences that are not an object', () => {
    const result = validateDataCapsule(capsule({ preferences: [] }));
    expect(result.valid).toBe(false);
  });

  test('reports every problem rather than stopping at the first', () => {
    const result = validateDataCapsule(capsule({
      schemaVersion: 9,
      projects: [{ id: '' }, { id: '' }, 'not an object']
    }));
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe('a remote image is the one content error', () => {
  test('an http(s) image src aborts, because it breaks self-containment', () => {
    const result = validateDataCapsule(withProject({
      contentItems: [{ id: 'i1', type: 'image', src: 'https://example.com/remote.png' }]
    }));
    expect(result.valid).toBe(false);
    expect(errorText(result)).toMatch(/remote url.*self-contained/);
  });

  test('an embedded data url is accepted', () => {
    const result = validateDataCapsule(withProject({
      contentItems: [{ id: 'i1', type: 'image', src: 'data:image/webp;base64,AAAA' }]
    }));
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  test('an unusable but local src is only a warning', () => {
    const result = validateDataCapsule(withProject({
      contentItems: [{ id: 'i1', type: 'image', src: 'data:image/svg+xml;base64,AAAA' }]
    }));
    expect(result.valid).toBe(true);
    expect(warningText(result)).toMatch(/cleared on load/);
  });
});

describe('data that v3 itself tolerates must not abort an upgrade', () => {
  // These are the cases that decide whether a real user with an ordinary file
  // can upgrade at all. v3 stores each of them happily and neutralises them at
  // render time, so refusing to migrate would be a regression, not a safeguard.

  test('a half-typed or non-http link url is a warning', () => {
    for (const url of ['htp://typo.example', 'ftp://files.example', 'mailto:a@b.c', 'javascript:alert(1)']) {
      const result = validateDataCapsule(withProject({
        contentItems: [{ id: 'i1', type: 'link', label: 'L', url }]
      }));
      expect(result.valid).toBe(true);
      expect(warningText(result)).toMatch(/not an http\(s\) url/);
    }
  });

  test('a non-http project link is a warning', () => {
    const result = validateDataCapsule(withProject({ link: 'not a url' }));
    expect(result.valid).toBe(true);
    expect(warningText(result)).toMatch(/link: is not an http\(s\) url/);
  });

  test('an unknown status or priority is a warning', () => {
    const result = validateDataCapsule(withProject({ status: 'Zombie', priority: 'Urgent' }));
    expect(result.valid).toBe(true);
    expect(warningText(result)).toMatch(/unrecognised status/);
    expect(warningText(result)).toMatch(/unrecognised priority/);
  });

  test('out of range progress is a warning', () => {
    expect(validateDataCapsule(withProject({ progress: 250 })).valid).toBe(true);
    expect(warningText(validateDataCapsule(withProject({ progress: 250 }))))
      .toMatch(/outside 0\.\.99/);
  });

  test('an unknown content item type is a warning', () => {
    const result = validateDataCapsule(withProject({
      contentItems: [{ id: 'i1', type: 'sticker', text: 'x' }]
    }));
    expect(result.valid).toBe(true);
    expect(warningText(result)).toMatch(/unrecognised type/);
  });

  test('a content item without an id is a warning, since one is generated on load', () => {
    const result = validateDataCapsule(withProject({
      contentItems: [{ type: 'task', text: 'x' }]
    }));
    expect(result.valid).toBe(true);
    expect(warningText(result)).toMatch(/one will be generated/);
  });

  test('duplicate project ids warn rather than block', () => {
    const result = validateDataCapsule(capsule({
      projects: [{ id: 'same' }, { id: 'same' }]
    }));
    expect(result.valid).toBe(true);
    expect(warningText(result)).toMatch(/duplicate project id/);
  });

  test('an unrecognised update channel is a warning', () => {
    const result = validateDataCapsule(capsule({
      preferences: { updateChannel: 'nightly' }
    }));
    expect(result.valid).toBe(true);
    expect(warningText(result)).toMatch(/unrecognised channel/);
  });

  test('tags of the wrong type warn rather than block', () => {
    const result = validateDataCapsule(withProject({ tags: 'hardware' }));
    expect(result.valid).toBe(true);
    expect(warningText(result)).toMatch(/tags: expected an array/);
  });
});

describe('error paths identify the offending record', () => {
  test('paths include project and item indexes', () => {
    const result = validateDataCapsule(capsule({
      projects: [
        { id: 'ok' },
        { id: 'p2', contentItems: [{ id: 'i1', type: 'image', src: 'http://x.example/a.png' }] }
      ]
    }));
    expect(errorText(result)).toContain('projects[1].contentItems[0].src');
  });
});
