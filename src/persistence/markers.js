/**
 * Permanent injection markers for the Project Command Center release artifact.
 *
 * WHY THE STRING CONCATENATION MATTERS
 * ------------------------------------
 * This module is bundled into the released HTML file. If it contained the
 * marker text contiguously, the released HTML would hold more than one copy of
 * its own injection region. The build validator (which requires exactly one
 * region), the extractor (which must find exactly one), and the injector (which
 * must replace exactly one) would then all be operating on ambiguous input.
 *
 * The legacy v3 application has exactly this defect: its legacy start marker
 * appears twice in `legacy/Project-Command-Center-v3.html` (once as the real
 * marker on line 686, and again as a template literal inside `buildUpdatedHtml`
 * on line 1416). v3 survives only because `String.prototype.replace` takes the
 * first match and the real marker happens to be lexically earlier.
 *
 * Every token below is therefore assembled from fragments at runtime, and
 * `tests/markers.test.js` fails the build if any bundled source file ever
 * contains one of them contiguously.
 *
 * These marker names are a permanent contract. Renaming one requires a
 * versioned installer that understands both the old and the new name.
 */

const PCC_PREFIX = '__PCC_';
const LEGACY_PREFIX = '__PROJECT_';

/** Bare tokens, without the surrounding comment syntax. */
export const DATA_START_TOKEN = PCC_PREFIX + 'DATA_START__';
export const DATA_END_TOKEN = PCC_PREFIX + 'DATA_END__';
export const METADATA_START_TOKEN = PCC_PREFIX + 'RELEASE_METADATA_START__';
export const METADATA_END_TOKEN = PCC_PREFIX + 'RELEASE_METADATA_END__';

/** Legacy v3 tokens. Read-only: v4 output must never contain these. */
export const LEGACY_DATA_START_TOKEN = LEGACY_PREFIX + 'DATA_START__';
export const LEGACY_DATA_END_TOKEN = LEGACY_PREFIX + 'DATA_END__';

/** Wraps a bare token in the block-comment syntax used inside the artifact. */
export function commentMarker(token) {
  return '/*' + token + '*/';
}

export const DATA_START = commentMarker(DATA_START_TOKEN);
export const DATA_END = commentMarker(DATA_END_TOKEN);
export const METADATA_START = commentMarker(METADATA_START_TOKEN);
export const METADATA_END = commentMarker(METADATA_END_TOKEN);
export const LEGACY_DATA_START = commentMarker(LEGACY_DATA_START_TOKEN);
export const LEGACY_DATA_END = commentMarker(LEGACY_DATA_END_TOKEN);

/**
 * Every token that must never appear inside serialized user data. If a project
 * note contained one of these, it could terminate the injection region early
 * and truncate the capsule on the next load.
 */
export const ALL_MARKER_TOKENS = Object.freeze([
  DATA_START_TOKEN,
  DATA_END_TOKEN,
  METADATA_START_TOKEN,
  METADATA_END_TOKEN,
  LEGACY_DATA_START_TOKEN,
  LEGACY_DATA_END_TOKEN
]);

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Non-greedy regex capturing the payload between a marker pair. */
export function regionRegex(startMarker, endMarker) {
  return new RegExp(
    escapeRegExp(startMarker) + '([\\s\\S]*?)' + escapeRegExp(endMarker)
  );
}

export function dataRegionRegex() {
  return regionRegex(DATA_START, DATA_END);
}

export function metadataRegionRegex() {
  return regionRegex(METADATA_START, METADATA_END);
}

export function legacyDataRegionRegex() {
  return regionRegex(LEGACY_DATA_START, LEGACY_DATA_END);
}

/** Literal, non-regex occurrence count. */
export function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  return String(haystack).split(needle).length - 1;
}

/**
 * Returns the marker tokens found in `text`, if any. Used to refuse to
 * serialize user data that would corrupt its own injection region.
 */
export function findMarkerTokens(text) {
  const value = String(text ?? '');
  return ALL_MARKER_TOKENS.filter(token => value.includes(token));
}
