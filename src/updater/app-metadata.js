import { CURRENT_SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA_VERSION } from '../persistence/data-capsule.js';

/**
 * Release identity, injected at build time into the release-metadata marker
 * region. It describes the App Shell and is completely independent of the
 * user's Data Capsule.
 */

/** Builds that were not produced for a real repository use this slug. */
export const LOCAL_REPOSITORY_SLUG = 'local/project-command-center';

export const REPOSITORY_SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function createFallbackAppMetadata() {
  return {
    appVersion: '0.0.0',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    minSchemaVersion: MIN_SUPPORTED_SCHEMA_VERSION,
    updateChannel: 'stable',
    repository: LOCAL_REPOSITORY_SLUG
  };
}

export function readAppMetadata(globalRef = globalThis) {
  const raw = globalRef?.PCC_RELEASE_METADATA;
  if (!raw || typeof raw !== 'object') return createFallbackAppMetadata();
  return {
    ...createFallbackAppMetadata(),
    ...raw
  };
}

/**
 * Whether this build points at a real public repository. A development build
 * carries the local placeholder, and checking GitHub for it would produce a
 * guaranteed 404 on every start.
 */
export function hasReleaseRepository(metadata) {
  const repository = String(metadata?.repository || '');
  return repository !== LOCAL_REPOSITORY_SLUG
    && REPOSITORY_SLUG_PATTERN.test(repository);
}
