import { CURRENT_SCHEMA_VERSION } from '../persistence/data-capsule.js';
import { cloneJson } from '../app/util.js';
import { injectDataCapsuleIntoShell } from '../persistence/standalone-export.js';
import { hasReleaseRepository } from './app-metadata.js';
import {
  ReleaseClientError,
  downloadAssetBytes,
  downloadJsonAsset,
  findReleaseAsset,
  getLatestStableRelease,
  getReleaseForVersion
} from './github-release-client.js';
import { compareSemver, isNewerVersion, versionFromTag } from './version.js';
import { inspectReleaseShell, isSchemaSupportedByShell } from './shell-inspector.js';
import { migrateToSchema } from './migrations.js';
import { normalizeSha256, sha256Hex } from './sha256.js';
import { validateUpdateManifest } from './manifest.js';
import { validateDataCapsule } from './validator.js';

export const MANIFEST_ASSET_NAME = 'update-manifest.json';

/**
 * Release assets cannot be read from a file:// page.
 *
 * api.github.com sends Access-Control-Allow-Origin: *, but release asset URLs
 * redirect to objects.githubusercontent.com, which does not. A page opened
 * from disk has the opaque origin "null", so the browser blocks the read:
 *
 *   Access to fetch at 'https://github.com/.../update-manifest.json' from
 *   origin 'null' has been blocked by CORS policy: No
 *   'Access-Control-Allow-Origin' header is present on the requested resource.
 *
 * Opening from disk is the primary way this application is used, so anything
 * required for an update check has to come from the API response itself.
 * The manifest is still read when it is reachable, which it is whenever the
 * app is served over http(s).
 */
export function isAssetFetchBlocked(error) {
  return /failed to fetch|networkerror|load failed|cors/i.test(String(error?.message || ''));
}

/**
 * Turns a release body into readable review-panel lines.
 *
 * GitHub's auto-generated notes are markdown aimed at a repository page, not
 * at a dialog: a "What's Changed" heading, one bullet per pull request with a
 * "by @author in <url>" suffix, and a "Full Changelog" link. Rendered raw they
 * read as a changelog dump, with markdown artifacts left behind.
 */
export function releaseNotesFromBody(body, limit = 12) {
  return String(body || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line
      // Section headings and the trailing changelog link are navigation for a
      // web page, not descriptions of what changed.
      && !/^#{1,6}\s/.test(line)
      && !/^\*{0,2}full changelog\*{0,2}\s*:/i.test(line))
    .map(line => line
      // A list marker needs trailing whitespace to count, so the opening "**"
      // of a bold span is not mistaken for one and eaten before it can pair.
      .replace(/^\s*[-*+>]\s+/, '')
      // Author and pull-request attribution, before bare urls are removed, or
      // the "in <url>" tail would no longer match.
      .replace(/\s+by\s+@[\w-]+(\s+in\s+\S+)?$/i, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .trim())
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * Everything the updater needs about a candidate release, assembled from the
 * manifest when it can be read and from the API response when it cannot.
 *
 * `expectedDigest` is the value the downloaded bytes must match. Both sources
 * are GitHub's, delivered over TLS; the asset digest is computed by GitHub
 * over the stored bytes, so falling back to it does not weaken verification.
 *
 * `schemaVersion` is null when only the API was available, because the API
 * cannot report it. That is safe: the authoritative schema check reads the
 * candidate shell's own metadata immediately before migrating anything.
 */
export function buildUpdateCandidate({ release, manifest, htmlAsset }) {
  const fromManifest = Boolean(manifest);
  return {
    appVersion: fromManifest ? manifest.appVersion : versionFromTag(release?.tag_name),
    publishedAt: fromManifest ? manifest.publishedAt : release?.published_at || '',
    releaseNotes: fromManifest && manifest.releaseNotes?.length
      ? manifest.releaseNotes
      : releaseNotesFromBody(release?.body),
    sizeBytes: htmlAsset?.size || 0,
    expectedDigest: fromManifest
      ? manifest.sha256
      : normalizeSha256(htmlAsset?.digest),
    digestSource: fromManifest ? 'manifest' : 'release-asset',
    schemaVersion: fromManifest ? manifest.schemaVersion : null,
    minSchemaVersion: fromManifest ? manifest.minSchemaVersion : null,
    downloadUrl: htmlAsset?.browser_download_url || '',
    assetName: htmlAsset?.name || ''
  };
}

export class UpdateError extends Error {
  constructor(message, { stage = 'unknown' } = {}) {
    super(message);
    this.name = 'UpdateError';
    this.stage = stage;
  }
}

const decodeUtf8 = (bytes) => new TextDecoder('utf-8').decode(bytes);

/* ------------------------------------------------------------------ discovery */

/**
 * Non-blocking availability check. Downloads nothing but release metadata and
 * the manifest, and never begins an installation.
 */
export async function checkForOnlineUpdate({
  appMetadata,
  preferences = {},
  installedSchemaVersion = CURRENT_SCHEMA_VERSION,
  fetchImpl = fetch,
  force = false
} = {}) {
  if (!force && preferences.checkForUpdatesAutomatically === false) {
    return { status: 'disabled' };
  }
  if (!hasReleaseRepository(appMetadata)) {
    // A development build carries the local placeholder slug. Checking it
    // would 404 on every start.
    return { status: 'unconfigured', repository: appMetadata?.repository ?? '' };
  }

  const channel = preferences.updateChannel || 'stable';

  try {
    const release = await getLatestStableRelease(appMetadata.repository, fetchImpl);

    // Preferred when readable, but a file:// page cannot fetch release assets,
    // so a blocked manifest must not fail the whole check.
    let manifest = null;
    let manifestError = null;
    const manifestAsset = findReleaseAsset(release, MANIFEST_ASSET_NAME);
    if (manifestAsset) {
      try {
        const validation = validateUpdateManifest(await downloadJsonAsset(manifestAsset, fetchImpl));
        if (validation.valid) manifest = validation.manifest;
        else manifestError = `Release manifest is invalid: ${validation.errors.join('; ')}`;
      } catch (error) {
        if (!isAssetFetchBlocked(error)) throw error;
        manifestError = 'The release manifest could not be read from this page, '
          + 'so release details came from the GitHub API instead.';
      }
    }

    const candidateVersion = manifest ? manifest.appVersion : versionFromTag(release?.tag_name);
    if (!candidateVersion) {
      return { status: 'error', error: `The latest release has no usable version (tag ${release?.tag_name}).` };
    }

    // Only the manifest declares a channel. An API-only check trusts the
    // stable channel it was pointed at, which is the only channel published.
    if (manifest && manifest.channel !== channel) {
      return { status: 'current', reason: `The latest release is on the ${manifest.channel} channel.` };
    }
    if (!isNewerVersion(candidateVersion, appMetadata.appVersion)) {
      return { status: 'current', installedVersion: appMetadata.appVersion };
    }
    if (manifest && installedSchemaVersion < manifest.minSchemaVersion) {
      return {
        status: 'incompatible',
        reason: `This file uses data schema ${installedSchemaVersion}, but version ${manifest.appVersion} `
          + `can only upgrade schema ${manifest.minSchemaVersion} or newer. An intermediate release is required.`,
        manifest
      };
    }

    const assetName = manifest
      ? manifest.assetName
      : `Project-Command-Center-v${candidateVersion}.html`;
    const htmlAsset = findReleaseAsset(release, assetName);
    if (!htmlAsset) {
      return { status: 'error', error: `The release does not contain ${assetName}.` };
    }

    const candidate = buildUpdateCandidate({ release, manifest, htmlAsset });
    if (!candidate.expectedDigest) {
      // Without a digest there is nothing to verify against, and an official
      // update is never offered unverified.
      return {
        status: 'error',
        error: 'The release publishes no SHA-256 digest, so this update cannot be verified.'
      };
    }

    return { status: 'available', release, manifest, htmlAsset, candidate, manifestError };
  } catch (error) {
    // Offline, GitHub down, CORS blocked, rate limited: all non-blocking.
    return {
      status: 'error',
      error: error instanceof ReleaseClientError ? error.message : String(error?.message || error)
    };
  }
}

/* ------------------------------------------------------- the shared pipeline */

export function buildUpdateBackup(capsule, sourceAppVersion, nowIso) {
  return {
    backupFormatVersion: 1,
    backedUpAt: nowIso,
    sourceAppVersion,
    data: cloneJson(capsule)
  };
}

function countImages(capsule) {
  return (capsule.projects || []).reduce((total, project) => total
    + (Array.isArray(project?.contentItems) ? project.contentItems : [])
      .filter(item => item?.type === 'image').length, 0);
}

/**
 * The one migration and export path, shared by online and manual updates.
 *
 * Nothing is written and nothing is returned unless every stage succeeds, so a
 * failure anywhere leaves both the live data and the existing file untouched.
 */
export function applyUpdatePipeline({
  currentCapsule,
  shellHtml,
  shellMetadata,
  sourceAppVersion,
  nowIso = new Date().toISOString()
}) {
  if (!isSchemaSupportedByShell(currentCapsule?.schemaVersion, shellMetadata)) {
    throw new UpdateError(
      `This update supports data schema ${shellMetadata.minSchemaVersion} through `
      + `${shellMetadata.schemaVersion}, but this file uses schema ${currentCapsule?.schemaVersion}.`,
      { stage: 'compatibility' }
    );
  }

  // The backup is taken from the live capsule before anything is migrated.
  const backup = buildUpdateBackup(currentCapsule, sourceAppVersion, nowIso);

  let migration;
  try {
    migration = migrateToSchema(currentCapsule, shellMetadata.schemaVersion);
  } catch (error) {
    throw new UpdateError(
      `Migration failed: ${error.message} Your existing file and project data are unchanged.`,
      { stage: 'migration' }
    );
  }

  const validation = validateDataCapsule(migration.capsule, {
    targetSchema: shellMetadata.schemaVersion
  });
  if (!validation.valid) {
    throw new UpdateError(
      `The migrated data did not validate, so no upgraded file was produced: ${validation.errors.join('; ')}`,
      { stage: 'validation' }
    );
  }

  let outputHtml;
  try {
    outputHtml = injectDataCapsuleIntoShell(shellHtml, migration.capsule);
  } catch (error) {
    throw new UpdateError(`Could not build the upgraded file: ${error.message}`, { stage: 'injection' });
  }

  return {
    outputHtml,
    outputFilename: `Project-Command-Center-v${shellMetadata.appVersion}.html`,
    migratedCapsule: migration.capsule,
    backup,
    report: {
      oldAppVersion: sourceAppVersion,
      newAppVersion: shellMetadata.appVersion,
      fromSchema: currentCapsule.schemaVersion,
      toSchema: migration.capsule.schemaVersion,
      migrationsApplied: migration.applied,
      projectsMigrated: (migration.capsule.projects || []).length,
      imagesPreserved: countImages(migration.capsule),
      warnings: validation.warnings
    }
  };
}

/* ------------------------------------------------------------ official update */

/**
 * Downloads, verifies, migrates, and produces an upgraded file.
 *
 * There is no way to skip verification on this path. A digest mismatch is a
 * hard stop, and the user is never offered an override.
 */
export async function prepareOfficialUpdate({
  currentCapsule,
  candidate,
  htmlAsset,
  appMetadata,
  fetchImpl = fetch,
  cryptoRef,
  nowIso = new Date().toISOString()
}) {
  let bytes;
  try {
    bytes = await downloadAssetBytes(htmlAsset, fetchImpl);
  } catch (error) {
    if (isAssetFetchBlocked(error)) {
      // Expected when the app runs from disk. The user can still download the
      // release through the browser and install it from file, which verifies
      // against the same digest.
      throw new UpdateError(
        'This page cannot download the release directly, because a file opened from disk '
        + 'is not allowed to read files from another site. Use Download Release, then '
        + 'Install Update From File to continue. Nothing has been changed.',
        { stage: 'download-blocked' }
      );
    }
    throw error;
  }

  const actualDigest = await sha256Hex(bytes, cryptoRef);
  const expectedDigest = normalizeSha256(candidate.expectedDigest);
  if (actualDigest !== expectedDigest) {
    throw new UpdateError(
      'Update verification failed. The downloaded update does not match the expected release hash. '
      + 'No project data was changed.',
      { stage: 'verification' }
    );
  }

  // Independent second opinion from the release provider, when it offers one.
  const assetDigest = normalizeSha256(htmlAsset?.digest);
  if (htmlAsset?.digest && assetDigest !== actualDigest) {
    throw new UpdateError(
      'Update verification failed. The release asset digest does not match the downloaded bytes. '
      + 'No project data was changed.',
      { stage: 'verification' }
    );
  }

  const shellHtml = decodeUtf8(bytes);
  const shellMetadata = inspectReleaseShell(shellHtml);

  if (shellMetadata.appVersion !== candidate.appVersion) {
    throw new UpdateError(
      `The downloaded file reports version ${shellMetadata.appVersion}, but the release `
      + `describes ${candidate.appVersion}. No project data was changed.`,
      { stage: 'verification' }
    );
  }
  // Only the manifest declares a schema version. When the check ran from the
  // API alone this is null, and the shell's own metadata is authoritative --
  // applyUpdatePipeline gates on it before anything is migrated.
  if (candidate.schemaVersion !== null && shellMetadata.schemaVersion !== candidate.schemaVersion) {
    throw new UpdateError(
      `The downloaded file writes data schema ${shellMetadata.schemaVersion}, but the release manifest `
      + `declares ${candidate.schemaVersion}. No project data was changed.`,
      { stage: 'verification' }
    );
  }

  return {
    ...applyUpdatePipeline({
      currentCapsule,
      shellHtml,
      shellMetadata,
      sourceAppVersion: appMetadata.appVersion,
      nowIso
    }),
    shellHtml,
    shellMetadata,
    verification: {
      trust: 'verified-official',
      digest: actualDigest,
      digestSource: candidate.digestSource,
      manifestDigestMatched: candidate.digestSource === 'manifest',
      assetDigestMatched: Boolean(htmlAsset?.digest)
    }
  };
}

/* --------------------------------------------------------------- manual update */

export const MANUAL_TRUST_STATES = Object.freeze([
  'verified-official', 'unverified-offline', 'verification-failed'
]);

/**
 * Examines a user-selected file and decides how much can honestly be claimed
 * about it.
 *
 *   verified-official  its bytes match the official release of that version
 *   verification-failed  a known mismatch; never softened into "unverified"
 *   unverified-offline  authenticity could not be established either way
 *
 * Offline is not the same as failed, and the distinction is preserved because
 * telling a user their file "failed verification" when we simply could not
 * reach the network would be a lie in the more alarming direction.
 */
export async function inspectManualUpdate(fileBytes, {
  repository,
  installedAppVersion,
  fetchImpl = fetch,
  online = true,
  cryptoRef
} = {}) {
  const bytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes);
  const shellHtml = decodeUtf8(bytes);

  // Throws for anything that is not a Project Command Center release.
  const shellMetadata = inspectReleaseShell(shellHtml);
  const digest = await sha256Hex(bytes, cryptoRef);

  const versionRelation = installedAppVersion
    ? ['older', 'same', 'newer'][compareSemver(shellMetadata.appVersion, installedAppVersion) + 1]
    : 'unknown';

  const base = { shellHtml, shellMetadata, digest, versionRelation };

  if (!online || !repository) {
    return { ...base, trust: 'unverified-offline', reason: 'No network check was performed.' };
  }

  try {
    const release = await getReleaseForVersion(repository, shellMetadata.appVersion, fetchImpl);
    const manifestAsset = findReleaseAsset(release, MANIFEST_ASSET_NAME);
    const htmlAsset = findReleaseAsset(release, `Project-Command-Center-v${shellMetadata.appVersion}.html`);

    let expected = null;
    if (manifestAsset) {
      try {
        const validation = validateUpdateManifest(await downloadJsonAsset(manifestAsset, fetchImpl));
        if (validation.valid) expected = validation.manifest.sha256;
      } catch (error) {
        // A file:// page cannot read release assets. Guarding this fetch on
        // its own is what keeps the asset-digest fallback below reachable;
        // without it the throw escapes to the outer catch and a perfectly
        // verifiable file is reported as merely unverified.
        if (!isAssetFetchBlocked(error)) throw error;
      }
    }
    if (!expected && htmlAsset?.digest) expected = normalizeSha256(htmlAsset.digest);

    if (!expected) {
      return {
        ...base,
        trust: 'unverified-offline',
        reason: 'The official release published no digest to compare against.'
      };
    }

    if (expected !== digest) {
      // A known mismatch is a hard failure and must never be presented as the
      // generic unverified state.
      return {
        ...base,
        trust: 'verification-failed',
        expectedDigest: expected,
        reason: 'This file does not match the official release of that version. '
          + 'It may be modified, corrupted, or a copy you saved yourself.'
      };
    }

    return { ...base, trust: 'verified-official', expectedDigest: expected };
  } catch (error) {
    // Could not reach the release. That is not evidence of tampering.
    return {
      ...base,
      trust: 'unverified-offline',
      reason: `Authenticity could not be confirmed: ${error.message}`
    };
  }
}

/**
 * Runs a manual update through the same pipeline as an official one.
 *
 * An unverified file requires `confirmedUnverified` from the caller, which
 * exists so the confirmation is an explicit user decision rather than a
 * default.
 */
export function prepareManualUpdate({
  currentCapsule,
  inspection,
  appMetadata,
  confirmedUnverified = false,
  nowIso = new Date().toISOString()
}) {
  if (inspection.trust === 'verification-failed') {
    throw new UpdateError(
      'This file does not match the official release and will not be installed. '
      + 'No project data was changed.',
      { stage: 'verification' }
    );
  }
  if (inspection.trust === 'unverified-offline' && !confirmedUnverified) {
    throw new UpdateError(
      'This update file could not be confirmed as an official Project Command Center release. '
      + 'Explicit confirmation is required before it can be used.',
      { stage: 'confirmation' }
    );
  }

  return {
    ...applyUpdatePipeline({
      currentCapsule,
      shellHtml: inspection.shellHtml,
      shellMetadata: inspection.shellMetadata,
      sourceAppVersion: appMetadata.appVersion,
      nowIso
    }),
    shellMetadata: inspection.shellMetadata,
    verification: {
      trust: inspection.trust,
      digest: inspection.digest,
      confirmedUnverified: inspection.trust === 'unverified-offline'
    }
  };
}
