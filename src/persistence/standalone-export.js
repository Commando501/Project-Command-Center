import { normalizeContentItems } from '../content/content-items.js';
import {
  DATA_END,
  DATA_START,
  LEGACY_DATA_END,
  LEGACY_DATA_START,
  METADATA_END,
  METADATA_START,
  countOccurrences,
  dataRegionRegex
} from './markers.js';

/** Comment-form markers that must never be reproducible from user data. */
const FORBIDDEN_IN_PAYLOAD = [
  DATA_START, DATA_END, METADATA_START, METADATA_END,
  LEGACY_DATA_START, LEGACY_DATA_END
];

/**
 * Serializes a value for embedding inside a script block.
 *
 * Four escapes, each closing a real hole:
 *
 *   less-than    a note containing a closing script tag would break out of
 *                the script element
 *   U+2028       a line separator would terminate a JavaScript string
 *   U+2029       likewise, for the paragraph separator
 *   star-slash   a note containing the end-marker text would terminate the
 *                injection region and truncate the capsule on the next load
 *
 * All four are legal JSON string escapes, so JSON.parse restores the original
 * characters exactly. The star-slash escape is what makes the marker contract
 * safe against hostile or merely unlucky user data; legacy v3 escapes only the
 * first three.
 */
export function serializeForEmbeddedJson(value) {
  const payload = JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003C')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/\*\//g, '*\\/');

  for (const marker of FORBIDDEN_IN_PAYLOAD) {
    if (payload.includes(marker)) {
      throw new Error('Refusing to serialize data that reproduces an injection marker.');
    }
  }
  return payload;
}

/**
 * Replaces exactly one Data Capsule region in a shell.
 *
 * The replacement is supplied as a FUNCTION, not a string. String.replace
 * interprets the dollar patterns inside a string replacement, so a project
 * note containing a dollar-quote would splice the remainder of the file into
 * the user's own data. Legacy v3 has exactly this bug at line 1417.
 */
export function injectDataCapsuleIntoShell(shellHtml, capsule) {
  const html = String(shellHtml);
  const starts = countOccurrences(html, DATA_START);
  const ends = countOccurrences(html, DATA_END);

  if (starts !== 1 || ends !== 1) {
    throw new Error(
      `Shell must contain exactly one Data Capsule region (found ${starts} start and ${ends} end markers).`
    );
  }

  const payload = serializeForEmbeddedJson(capsule);
  const region = dataRegionRegex();
  if (!region.test(html)) {
    throw new Error('Data Capsule markers are present but not correctly paired.');
  }

  return html.replace(region, () => `${DATA_START}${payload}${DATA_END}`);
}

/**
 * v3 export cleaning: content items are re-normalized and empty ones dropped,
 * so an empty link block added but never filled in does not survive a save.
 */
export function cleanProjectsForExport(projects) {
  return (projects || []).map(project => ({
    ...project,
    contentItems: normalizeContentItems(project.contentItems)
  }));
}

/** The v3 "Export JSON Backup" shape, preserved exactly. */
export function buildProjectsJsonBackup(projects, nowIso = new Date().toISOString()) {
  const cleaned = cleanProjectsForExport(projects);
  return {
    exportedAt: nowIso,
    projectCount: cleaned.length,
    projects: cleaned
  };
}
