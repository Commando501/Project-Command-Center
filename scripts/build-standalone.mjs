#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

import {
  DATA_END,
  DATA_START,
  METADATA_END,
  METADATA_START
} from '../src/persistence/markers.js';
import {
  CURRENT_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  createDataCapsule
} from '../src/persistence/data-capsule.js';
import {
  LOCAL_REPOSITORY_SLUG,
  REPOSITORY_SLUG_PATTERN
} from '../src/updater/app-metadata.js';
import { assertSafeToOverwrite } from './build-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = join(ROOT, 'dist');

/**
 * Token substitution uses split/join rather than String.replace.
 *
 * The bundle contains our own regex-escaping source, which includes the
 * literal text "$&". A string replacement would interpret it as a
 * back-reference directive and corrupt the emitted JavaScript.
 */
function substitute(template, token, value) {
  if (!template.includes(token)) throw new Error(`Build token ${token} is missing.`);
  return template.split(token).join(value);
}

function resolveRepositorySlug() {
  const slug = process.env.PCC_REPO_SLUG || LOCAL_REPOSITORY_SLUG;
  if (process.env.RELEASE_BUILD === '1' && !REPOSITORY_SLUG_PATTERN.test(slug)) {
    throw new Error(
      `A release build requires PCC_REPO_SLUG in "owner/repository" form (received "${slug}").`
    );
  }
  return slug;
}

async function bundleApplication() {
  const result = await esbuild.build({
    entryPoints: [join(ROOT, 'src', 'main.js')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    // Deliberately unminified. Users are asked to trust this file with their
    // data and to verify its hash; keeping it readable makes that meaningful,
    // and the artifact is dominated by embedded image bytes in any case.
    minify: false,
    charset: 'utf8',
    legalComments: 'inline'
  });

  if (result.errors.length) throw new Error('esbuild reported errors.');
  return result.outputFiles[0].text.trimEnd();
}

export async function buildStandalone() {
  const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const appVersion = packageJson.version;
  const repository = resolveRepositorySlug();

  const metadata = {
    appVersion,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    minSchemaVersion: MIN_SUPPORTED_SCHEMA_VERSION,
    updateChannel: 'stable',
    repository
  };

  const metadataBlock = [
    'window.PCC_RELEASE_METADATA =',
    METADATA_START,
    JSON.stringify(metadata, null, 2),
    `${METADATA_END};`
  ].join('\n');

  const dataBlock = [
    'window.PCC_DATA =',
    DATA_START,
    JSON.stringify(createDataCapsule([]), null, 2),
    `${DATA_END};`
  ].join('\n');

  let html = await readFile(join(ROOT, 'src', 'index.html'), 'utf8');
  html = substitute(html, '{{PCC_STYLES}}', await readFile(join(ROOT, 'src', 'styles', 'app.css'), 'utf8'));
  html = substitute(html, '{{PCC_RELEASE_METADATA_BLOCK}}', metadataBlock);
  html = substitute(html, '{{PCC_DATA_BLOCK}}', dataBlock);
  html = substitute(html, '{{PCC_BUNDLE}}', await bundleApplication());

  const filename = `Project-Command-Center-v${appVersion}.html`;
  const outputPath = join(OUTPUT_DIR, filename);
  await mkdir(OUTPUT_DIR, { recursive: true });
  // Checked after the build succeeds but before anything is written, so a
  // refusal costs nothing and a partial write is impossible.
  await assertSafeToOverwrite(outputPath);
  await writeFile(outputPath, html, 'utf8');

  return { filename, path: join(OUTPUT_DIR, filename), appVersion, repository, bytes: Buffer.byteLength(html) };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  buildStandalone()
    .then(result => {
      console.log(`Built ${result.filename} (${result.bytes} bytes) for ${result.repository}`);
    })
    .catch(error => {
      console.error(`Build failed: ${error.message}`);
      process.exit(1);
    });
}
