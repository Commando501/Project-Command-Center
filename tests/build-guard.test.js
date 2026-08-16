import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { DATA_END, DATA_START } from '../src/persistence/markers.js';
import {
  assertSafeToOverwrite,
  countEmbeddedProjects
} from '../scripts/build-guard.mjs';

/**
 * `npm run build` writes a fixed filename into dist/. On 2026-08-15 that
 * destroyed a tracker someone was actually using, because their live file sat
 * at exactly that path and dist/ is gitignored, so nothing could restore it.
 * This guard exists so a build refuses rather than repeats that.
 */

const shellWith = (projects) => `<!DOCTYPE html>
<html><body><script>
window.PCC_DATA =
${DATA_START}${JSON.stringify({ schemaVersion: 4, projects, preferences: {} })}${DATA_END};
</script></body></html>`;

describe('countEmbeddedProjects', () => {
  test('counts what a user would lose', () => {
    expect(countEmbeddedProjects(shellWith([{ id: 'a' }, { id: 'b' }]))).toBe(2);
  });

  test('a freshly built artifact carries nothing', () => {
    expect(countEmbeddedProjects(shellWith([]))).toBe(0);
  });

  test('unreadable content is not treated as user data', () => {
    expect(countEmbeddedProjects('<html>not a tracker</html>')).toBe(0);
    expect(countEmbeddedProjects('')).toBe(0);
  });
});

describe('assertSafeToOverwrite', () => {
  let dir;
  let target;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pcc-guard-'));
    target = join(dir, 'Project-Command-Center-v4.0.7.html');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('a missing target is fine — this is the normal CI case', async () => {
    await expect(assertSafeToOverwrite(target)).resolves.toEqual({
      overwriting: false,
      projectCount: 0
    });
  });

  test('overwriting a previous empty build is fine — this is the normal dev loop', async () => {
    await writeFile(target, shellWith([]), 'utf8');
    await expect(assertSafeToOverwrite(target)).resolves.toEqual({
      overwriting: true,
      projectCount: 0
    });
  });

  test('refuses to destroy a file holding projects', async () => {
    await writeFile(target, shellWith([{ id: 'a' }, { id: 'b' }, { id: 'c' }]), 'utf8');
    await expect(assertSafeToOverwrite(target)).rejects.toThrow(/3 project/);
  });

  test('the refusal explains how to proceed', async () => {
    await writeFile(target, shellWith([{ id: 'a' }]), 'utf8');
    const error = await assertSafeToOverwrite(target).catch(e => e);
    expect(error.message).toMatch(/PCC_ALLOW_OVERWRITE/);
    expect(error.message).toContain(target);
  });

  test('an explicit override still allows it', async () => {
    await writeFile(target, shellWith([{ id: 'a' }]), 'utf8');
    await expect(
      assertSafeToOverwrite(target, { allowOverwrite: true })
    ).resolves.toEqual({ overwriting: true, projectCount: 1 });
  });
});
