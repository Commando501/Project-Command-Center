import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, test } from 'vitest';

import { getBuiltArtifact } from './helpers/built-artifact.js';
import { generateManifest } from '../scripts/generate-manifest.mjs';
import { validateUpdateManifest } from '../src/updater/manifest.js';
import { metadataRegionRegex } from '../src/persistence/markers.js';

let build;
let metadata;

beforeAll(async () => {
  build = await getBuiltArtifact();
  const html = await readFile(build.path, 'utf8');
  metadata = JSON.parse(html.match(metadataRegionRegex())[1]);
}, 120000);

describe('generateManifest', () => {
  test('takes every version field from the embedded release metadata', async () => {
    const { manifest } = await generateManifest({
      htmlPath: build.path, publishedAt: '2026-08-15T00:00:00.000Z'
    });

    expect(manifest.appVersion).toBe(metadata.appVersion);
    expect(manifest.schemaVersion).toBe(metadata.schemaVersion);
    expect(manifest.minSchemaVersion).toBe(metadata.minSchemaVersion);
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.channel).toBe('stable');
    expect(manifest.publishedAt).toBe('2026-08-15T00:00:00.000Z');
  });

  test('names the asset exactly as the file is named', async () => {
    const { manifest } = await generateManifest({ htmlPath: build.path });
    expect(manifest.assetName).toBe(`Project-Command-Center-v${build.appVersion}.html`);
    expect(manifest.assetName).not.toContain('/');
  });

  test('hashes the exact bytes on disk', async () => {
    const { manifest } = await generateManifest({ htmlPath: build.path });
    const expected = createHash('sha256').update(await readFile(build.path)).digest('hex');
    expect(manifest.sha256).toBe(expected);
    expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('a single byte appended to the artifact changes the digest', async () => {
    const first = await generateManifest({ htmlPath: build.path });
    const tampered = `${build.path}.tampered.html`;
    await readFile(build.path).then(bytes =>
      import('node:fs/promises').then(fs => fs.writeFile(tampered, Buffer.concat([bytes, Buffer.from(' ')]))));

    const second = await generateManifest({ htmlPath: tampered });
    expect(second.sha256).not.toBe(first.sha256);

    await import('node:fs/promises').then(fs => fs.unlink(tampered));
  });

  test('the generated manifest passes the runtime validator', async () => {
    const { manifest } = await generateManifest({ htmlPath: build.path });
    const validation = validateUpdateManifest(manifest);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  test('publishedAt defaults to a valid ISO timestamp', async () => {
    const { manifest } = await generateManifest({ htmlPath: build.path });
    expect(new Date(manifest.publishedAt).toISOString()).toBe(manifest.publishedAt);
  });

  test('reserves the signature field as null rather than omitting it', async () => {
    const { manifest } = await generateManifest({ htmlPath: build.path });
    expect(manifest.signature).toBeNull();
  });
});

describe('generateManifest failure modes', () => {
  test('a file with no release metadata is refused', async () => {
    const path = `${build.path}.nometa.html`;
    await import('node:fs/promises').then(fs => fs.writeFile(path, '<html>nothing</html>'));
    await expect(generateManifest({ htmlPath: path }))
      .rejects.toThrow(/contains no release metadata region/);
    await import('node:fs/promises').then(fs => fs.unlink(path));
  });

  test('a missing file is refused rather than silently producing a manifest', async () => {
    await expect(generateManifest({ htmlPath: 'dist/does-not-exist.html' })).rejects.toThrow();
  });
});
