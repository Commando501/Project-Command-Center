import { legacyV3ProjectsToSchema3, normalizeDataCapsule } from './data-capsule.js';
import {
  DATA_END,
  DATA_START,
  LEGACY_DATA_END,
  LEGACY_DATA_START,
  countOccurrences,
  dataRegionRegex,
  legacyDataRegionRegex
} from './markers.js';

/**
 * Reads a Data Capsule out of an HTML file.
 *
 * Nothing from the candidate file is ever executed. Only the JSON text between
 * known marker comments is read, and it goes straight to JSON.parse. That is
 * what makes it safe to point this at a file of unknown provenance.
 */

export class ExtractionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExtractionError';
  }
}

function parseRegion(json, label) {
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new ExtractionError(`${label} is not valid JSON: ${error.message}`);
  }
}

function extractPccCapsule(html) {
  const starts = countOccurrences(html, DATA_START);
  const ends = countOccurrences(html, DATA_END);

  // v4 guarantees exactly one region: markers.js keeps the marker text out of
  // bundled source, and validate-build fails the release otherwise.
  if (starts > 1 || ends > 1) {
    throw new ExtractionError(
      `Expected one Data Capsule region, found ${starts} start and ${ends} end markers.`
    );
  }
  if (starts === 1 && ends === 0) {
    throw new ExtractionError('Data Capsule start marker has no matching end marker.');
  }

  const match = html.match(dataRegionRegex());
  if (!match) return null;
  return normalizeDataCapsule(parseRegion(match[1], 'Data Capsule'));
}

function extractLegacyCapsule(html) {
  const starts = countOccurrences(html, LEGACY_DATA_START);
  const ends = countOccurrences(html, LEGACY_DATA_END);
  if (starts === 0) return null;
  if (ends === 0) {
    throw new ExtractionError('Legacy v3 start marker has no matching end marker.');
  }

  // EVERY genuine v3 file contains TWO legacy regions: the real data near the
  // top of the script, and a second copy inside buildUpdatedHtml, where the
  // markers appear in a template literal. v3's own save works because
  // String.replace takes the first match. Rejecting multiple regions here
  // would therefore reject every real v3 file, so the first region wins —
  // exactly the region v3 itself treats as authoritative.
  const match = html.match(legacyDataRegionRegex());
  if (!match) {
    throw new ExtractionError('Legacy v3 markers are present but not correctly paired.');
  }

  const projects = parseRegion(match[1], 'Legacy v3 project data');
  if (!Array.isArray(projects)) {
    throw new ExtractionError('Legacy v3 project data is not an array.');
  }
  return legacyV3ProjectsToSchema3(projects);
}

/**
 * Returns `{ sourceFormat, capsule, legacyMarkersPresent }`.
 *
 * `sourceFormat` is `'pcc-data'` for v4 and later, `'legacy-v3'` for the
 * original marker format.
 */
export function extractDataFromHtml(html) {
  const source = String(html || '');

  const capsule = extractPccCapsule(source);
  const legacyMarkersPresent = countOccurrences(source, LEGACY_DATA_START) > 0;

  if (capsule) {
    // The v4 contract wins when both are present. A v4 artifact should carry
    // no legacy marker at all, so this is surfaced rather than silently
    // ignored.
    return { sourceFormat: 'pcc-data', capsule, legacyMarkersPresent };
  }

  const legacyCapsule = extractLegacyCapsule(source);
  if (legacyCapsule) {
    return { sourceFormat: 'legacy-v3', capsule: legacyCapsule, legacyMarkersPresent: true };
  }

  throw new ExtractionError(
    'No Project Command Center data markers were found in this file.'
  );
}
