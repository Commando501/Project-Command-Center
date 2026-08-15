#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DATA_END,
  DATA_START,
  LEGACY_DATA_END,
  LEGACY_DATA_START,
  LEGACY_DATA_START_TOKEN,
  METADATA_END,
  METADATA_START,
  countOccurrences,
  dataRegionRegex,
  metadataRegionRegex
} from '../src/persistence/markers.js';
import { CURRENT_SCHEMA_VERSION } from '../src/persistence/data-capsule.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Invariants the released artifact must satisfy. Every one of these is a
 * release gate: failing any of them means the file either is not standalone,
 * or cannot be safely updated later.
 */
export async function validateBuild(htmlPath, appVersion) {
  const html = await readFile(htmlPath, 'utf8');
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };

  check(countOccurrences(html, DATA_START) === 1, 'Expected exactly one Data Capsule start marker.');
  check(countOccurrences(html, DATA_END) === 1, 'Expected exactly one Data Capsule end marker.');
  check(countOccurrences(html, METADATA_START) === 1, 'Expected exactly one release metadata start marker.');
  check(countOccurrences(html, METADATA_END) === 1, 'Expected exactly one release metadata end marker.');

  // A live legacy marker in a v4 artifact would make the extractor ambiguous
  // about which format it is reading.
  check(countOccurrences(html, LEGACY_DATA_START) === 0, 'Artifact contains a legacy v3 start marker.');
  check(countOccurrences(html, LEGACY_DATA_END) === 0, 'Artifact contains a legacy v3 end marker.');
  check(countOccurrences(html, LEGACY_DATA_START_TOKEN) === 0, 'Artifact contains a legacy v3 marker token.');

  // An icon is required, and it must be embedded. A file:// page with no icon
  // makes the browser probe for one and log a cross-origin warning, and an
  // icon loaded from anywhere else would break the self-contained guarantee.
  const iconLinks = [...html.matchAll(/<link[^>]+rel\s*=\s*["']?icon["']?[^>]*>/gi)];
  check(iconLinks.length === 1, `Expected exactly one icon link, found ${iconLinks.length}.`);
  if (iconLinks.length === 1) {
    check(/href\s*=\s*["']data:/i.test(iconLinks[0][0]), 'The icon is not an embedded data URI.');
  }

  check(!/<script[^>]+\ssrc\s*=/i.test(html), 'Artifact loads an external script.');
  check(!/<link[^>]+rel\s*=\s*["']?stylesheet/i.test(html), 'Artifact loads an external stylesheet.');
  check(!/\ssrc\s*=\s*["']https?:/i.test(html), 'Artifact references a remote resource over http(s).');
  check(!/{{[A-Z_]+}}/.test(html), 'Artifact contains an unresolved build token.');

  const metadataMatch = html.match(metadataRegionRegex());
  check(Boolean(metadataMatch), 'Release metadata region is not parseable.');
  if (metadataMatch) {
    let metadata = null;
    try {
      metadata = JSON.parse(metadataMatch[1]);
    } catch {
      errors.push('Release metadata is not valid JSON.');
    }
    if (metadata) {
      check(metadata.appVersion === appVersion, `Release metadata appVersion is "${metadata.appVersion}", expected "${appVersion}".`);
      check(metadata.schemaVersion === CURRENT_SCHEMA_VERSION, `Release metadata schemaVersion is ${metadata.schemaVersion}, expected ${CURRENT_SCHEMA_VERSION}.`);
      check(Number.isInteger(metadata.minSchemaVersion), 'Release metadata minSchemaVersion is missing.');
      check(typeof metadata.repository === 'string' && metadata.repository.includes('/'), 'Release metadata repository is missing.');
    }
  }

  const dataMatch = html.match(dataRegionRegex());
  check(Boolean(dataMatch), 'Data Capsule region is not parseable.');
  if (dataMatch) {
    let capsule = null;
    try {
      capsule = JSON.parse(dataMatch[1]);
    } catch {
      errors.push('Embedded Data Capsule is not valid JSON.');
    }
    if (capsule) {
      check(capsule.schemaVersion === CURRENT_SCHEMA_VERSION, `Embedded capsule schemaVersion is ${capsule.schemaVersion}, expected ${CURRENT_SCHEMA_VERSION}.`);
      check(Array.isArray(capsule.projects), 'Embedded capsule projects is not an array.');
      check(Boolean(capsule.preferences), 'Embedded capsule preferences are missing.');
    }
  }

  // "Built file cannot parse" is a release gate. new Function compiles without
  // executing, which is exactly the check we want.
  for (const [index, script] of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].entries()) {
    try {
      // eslint-disable-next-line no-new-func
      new Function(script[1]);
    } catch (error) {
      errors.push(`Script block ${index + 1} does not parse: ${error.message}`);
    }
  }

  return { valid: errors.length === 0, errors, bytes: Buffer.byteLength(html) };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const packageJson = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const htmlPath = join(ROOT, 'dist', `Project-Command-Center-v${packageJson.version}.html`);

  const result = await validateBuild(htmlPath, packageJson.version).catch(error => ({
    valid: false,
    errors: [`Could not read ${htmlPath}: ${error.message}`]
  }));

  if (!result.valid) {
    console.error('Standalone build validation FAILED:');
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`Standalone build validated: ${htmlPath} (${result.bytes} bytes)`);
}
