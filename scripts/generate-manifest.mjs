#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { metadataRegionRegex } from '../src/persistence/markers.js';
import { validateUpdateManifest } from '../src/updater/manifest.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Generates the update manifest from the exact built HTML.
 *
 * The digest is taken over the file's bytes as they sit on disk, and nothing
 * may touch the HTML afterwards. Any formatter, banner injection, or newline
 * normalisation running after this point would publish a hash that no longer
 * describes the released asset, and every client would then refuse the update.
 */
export async function generateManifest({
  htmlPath,
  channel = 'stable',
  publishedAt = new Date().toISOString()
} = {}) {
  const bytes = await readFile(htmlPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const html = bytes.toString('utf8');
  const match = html.match(metadataRegionRegex());
  if (!match) {
    throw new Error(`${htmlPath} contains no release metadata region.`);
  }

  let metadata;
  try {
    metadata = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`Release metadata in ${htmlPath} is not valid JSON: ${error.message}`);
  }

  const manifest = {
    formatVersion: 1,
    appVersion: metadata.appVersion,
    schemaVersion: metadata.schemaVersion,
    minSchemaVersion: metadata.minSchemaVersion,
    channel,
    assetName: basename(htmlPath),
    sha256,
    publishedAt,
    releaseNotes: [],
    signature: null
  };

  // The same validator the application uses at runtime, so a manifest that
  // would be rejected by a client can never be published in the first place.
  const validation = validateUpdateManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Generated manifest is invalid: ${validation.errors.join('; ')}`);
  }

  return { manifest, sha256, bytes: bytes.length };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  try {
    const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    const htmlPath = join(ROOT, 'dist', `Project-Command-Center-v${packageJson.version}.html`);
    const manifestPath = join(ROOT, 'dist', 'update-manifest.json');

    const result = await generateManifest({
      htmlPath,
      publishedAt: process.env.PCC_PUBLISHED_AT || new Date().toISOString()
    });

    await writeFile(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${manifestPath}`);
    console.log(`  asset  ${result.manifest.assetName} (${result.bytes} bytes)`);
    console.log(`  sha256 ${result.sha256}`);
  } catch (error) {
    console.error(`Manifest generation failed: ${error.message}`);
    process.exit(1);
  }
}
