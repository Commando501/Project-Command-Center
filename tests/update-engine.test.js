import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, test } from 'vitest';

import { buildStandalone } from '../scripts/build-standalone.mjs';
import { REPOSITORY, createFakeGitHub, offlineFetch, reversionShell } from './helpers/fake-github.js';
import { extractDataFromHtml } from '../src/persistence/extract.js';
import { inspectReleaseShell } from '../src/updater/shell-inspector.js';
import {
  UpdateError,
  applyUpdatePipeline,
  buildUpdateBackup,
  checkForOnlineUpdate,
  inspectManualUpdate,
  prepareManualUpdate,
  prepareOfficialUpdate
} from '../src/updater/update-engine.js';

const APP_METADATA = {
  appVersion: '4.0.0',
  schemaVersion: 4,
  minSchemaVersion: 3,
  updateChannel: 'stable',
  repository: REPOSITORY
};

const PREFERENCES = {
  checkForUpdatesAutomatically: true,
  updateChannel: 'stable',
  automaticBackupBeforeUpdate: true
};

const CAPSULE = {
  schemaVersion: 4,
  projects: [
    {
      id: 'p1',
      name: 'Kept Project',
      notes: 'A dollar pattern $& lives here.',
      contentItems: [
        { id: 'i1', type: 'task', text: 'done', completed: true },
        { id: 'i2', type: 'task', text: 'todo', completed: false },
        {
          id: 'i3', type: 'image', src: 'data:image/webp;base64,AAAA',
          caption: 'Shot', displayWidth: 512, sizeBytes: 999, mimeType: 'image/webp',
          width: 800, height: 600, filename: 'shot.webp'
        }
      ]
    },
    { id: 'p2', name: 'Second', contentItems: [] }
  ],
  preferences: PREFERENCES
};

let newerShell;

beforeAll(async () => {
  const build = await buildStandalone();
  const html = await readFile(build.path, 'utf8');
  newerShell = reversionShell(html, { appVersion: '4.1.0', repository: REPOSITORY });
}, 120000);

/* -------------------------------------------------------------- discovery */

describe('checkForOnlineUpdate', () => {
  test('reports an available update when everything lines up', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    const result = await checkForOnlineUpdate({
      appMetadata: APP_METADATA, preferences: PREFERENCES,
      installedSchemaVersion: 4, fetchImpl: github.fetchImpl
    });

    expect(result.status).toBe('available');
    expect(result.manifest.appVersion).toBe('4.1.0');
    expect(result.htmlAsset.name).toBe('Project-Command-Center-v4.1.0.html');
  });

  test('does not download the release asset merely to check', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    await checkForOnlineUpdate({
      appMetadata: APP_METADATA, preferences: PREFERENCES, fetchImpl: github.fetchImpl
    });
    expect(github.requests.some(request => request.url.includes('.html'))).toBe(false);
    expect(github.requests.map(request => request.url)).toEqual([
      'https://api.github.com/repos/owner/project-command-center/releases/latest',
      expect.stringContaining('update-manifest.json')
    ]);
  });

  test('reports current when the release is not newer', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell, version: '4.0.0' });
    const result = await checkForOnlineUpdate({
      appMetadata: APP_METADATA, preferences: PREFERENCES, fetchImpl: github.fetchImpl
    });
    expect(result.status).toBe('current');
  });

  test('ignores a release published on another channel', async () => {
    const github = await createFakeGitHub({
      shellHtml: newerShell, manifestOverrides: { channel: 'beta' }
    });
    const result = await checkForOnlineUpdate({
      appMetadata: APP_METADATA, preferences: PREFERENCES, fetchImpl: github.fetchImpl
    });
    expect(result.status).toBe('current');
    expect(result.reason).toMatch(/beta channel/);
  });

  test('reports incompatible when the installed schema is too old', async () => {
    // The manifest must stay internally consistent, so a release that dropped
    // support for schema 4 declares a newer schema too.
    const github = await createFakeGitHub({
      shellHtml: newerShell, manifestOverrides: { schemaVersion: 6, minSchemaVersion: 5 }
    });
    const result = await checkForOnlineUpdate({
      appMetadata: APP_METADATA, preferences: PREFERENCES,
      installedSchemaVersion: 4, fetchImpl: github.fetchImpl
    });
    expect(result.status).toBe('incompatible');
    expect(result.reason).toMatch(/intermediate release is required/);
  });

  test('honours the automatic-check preference, and force overrides it', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    const off = { ...PREFERENCES, checkForUpdatesAutomatically: false };

    expect(await checkForOnlineUpdate({
      appMetadata: APP_METADATA, preferences: off, fetchImpl: github.fetchImpl
    })).toEqual({ status: 'disabled' });
    expect(github.requests).toHaveLength(0);

    const forced = await checkForOnlineUpdate({
      appMetadata: APP_METADATA, preferences: off, fetchImpl: github.fetchImpl, force: true
    });
    expect(forced.status).toBe('available');
  });

  test('skips the check entirely for a local development build', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    const result = await checkForOnlineUpdate({
      appMetadata: { ...APP_METADATA, repository: 'local/project-command-center' },
      preferences: PREFERENCES, fetchImpl: github.fetchImpl
    });
    expect(result.status).toBe('unconfigured');
    expect(github.requests).toHaveLength(0);
  });

  test('a network failure is an error result, never a thrown exception', async () => {
    const result = await checkForOnlineUpdate({
      appMetadata: APP_METADATA, preferences: PREFERENCES, fetchImpl: offlineFetch
    });
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/Could not reach the update server/);
  });

  test('an invalid manifest is an error, not an offer to install', async () => {
    const github = await createFakeGitHub({
      shellHtml: newerShell, manifestOverrides: { sha256: 'not-a-digest' }
    });
    const result = await checkForOnlineUpdate({
      appMetadata: APP_METADATA, preferences: PREFERENCES, fetchImpl: github.fetchImpl
    });
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/Release manifest is invalid/);
  });

  test('a release missing its manifest or html asset is an error', async () => {
    const noManifest = await createFakeGitHub({ shellHtml: newerShell, omitManifestAsset: true });
    expect((await checkForOnlineUpdate({
      appMetadata: APP_METADATA, preferences: PREFERENCES, fetchImpl: noManifest.fetchImpl
    })).status).toBe('error');

    const noHtml = await createFakeGitHub({ shellHtml: newerShell, omitHtmlAsset: true });
    const result = await checkForOnlineUpdate({
      appMetadata: APP_METADATA, preferences: PREFERENCES, fetchImpl: noHtml.fetchImpl
    });
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/does not contain/);
  });
});

/* ------------------------------------------------------- official install */

describe('prepareOfficialUpdate success path', () => {
  let result;
  let github;

  beforeAll(async () => {
    github = await createFakeGitHub({ shellHtml: newerShell });
    result = await prepareOfficialUpdate({
      currentCapsule: CAPSULE,
      manifest: github.manifest,
      htmlAsset: github.release.assets.find(asset => asset.name.endsWith('.html')),
      appMetadata: APP_METADATA,
      fetchImpl: github.fetchImpl,
      nowIso: '2026-08-15T00:00:00.000Z'
    });
  });

  test('produces an upgraded file named for the new version', () => {
    expect(result.outputFilename).toBe('Project-Command-Center-v4.1.0.html');
    expect(inspectReleaseShell(result.outputHtml).appVersion).toBe('4.1.0');
  });

  test('carries the user data into the new shell intact', () => {
    const capsule = extractDataFromHtml(result.outputHtml).capsule;
    expect(capsule.projects).toHaveLength(2);
    expect(capsule.projects[0].name).toBe('Kept Project');
    expect(capsule.projects[0].notes).toBe('A dollar pattern $& lives here.');

    const image = capsule.projects[0].contentItems.find(item => item.type === 'image');
    expect(image.src).toBe('data:image/webp;base64,AAAA');
    expect(image.displayWidth).toBe(512);
    expect(image.sizeBytes).toBe(999);
  });

  test('records both digest checks as passed', () => {
    expect(result.verification).toMatchObject({
      trust: 'verified-official',
      manifestDigestMatched: true,
      assetDigestMatched: true
    });
    expect(result.verification.digest).toBe(github.digest);
  });

  test('produces a backup of the pre-migration data', () => {
    expect(result.backup).toMatchObject({
      backupFormatVersion: 1,
      backedUpAt: '2026-08-15T00:00:00.000Z',
      sourceAppVersion: '4.0.0'
    });
    expect(result.backup.data.projects).toHaveLength(2);
  });

  test('reports what happened', () => {
    expect(result.report).toMatchObject({
      oldAppVersion: '4.0.0',
      newAppVersion: '4.1.0',
      fromSchema: 4,
      toSchema: 4,
      migrationsApplied: [],
      projectsMigrated: 2,
      imagesPreserved: 1
    });
  });

  test('never mutates the live capsule', () => {
    expect(CAPSULE.projects[0].name).toBe('Kept Project');
    expect(CAPSULE.schemaVersion).toBe(4);
  });
});

describe('prepareOfficialUpdate abort paths', () => {
  const install = async (options) => {
    const github = await createFakeGitHub({ shellHtml: newerShell, ...options });
    return prepareOfficialUpdate({
      currentCapsule: CAPSULE,
      manifest: github.manifest,
      htmlAsset: github.release.assets.find(asset => asset.name.endsWith('.html'))
        ?? { browser_download_url: 'https://example.com/missing.html' },
      appMetadata: APP_METADATA,
      fetchImpl: github.fetchImpl
    });
  };

  test('tampered bytes fail the manifest hash check', async () => {
    await expect(install({ corruptBytes: true }))
      .rejects.toThrow(/does not match the expected release hash/);
  });

  test('a hash mismatch mentions that no data was changed', async () => {
    await expect(install({ corruptBytes: true })).rejects.toThrow(/No project data was changed/);
  });

  test('a wrong asset digest fails even when the manifest hash matches', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    const asset = github.release.assets.find(a => a.name.endsWith('.html'));
    await expect(prepareOfficialUpdate({
      currentCapsule: CAPSULE,
      manifest: github.manifest,
      htmlAsset: { ...asset, digest: `sha256:${'0'.repeat(64)}` },
      appMetadata: APP_METADATA,
      fetchImpl: github.fetchImpl
    })).rejects.toThrow(/release asset digest does not match/);
  });

  test('a shell whose version disagrees with the manifest is refused', async () => {
    await expect(install({ manifestOverrides: { appVersion: '4.2.0' } }))
      .rejects.toThrow(/reports version 4\.1\.0, but the release manifest describes 4\.2\.0/);
  });

  test('a shell whose schema disagrees with the manifest is refused', async () => {
    await expect(install({ manifestOverrides: { schemaVersion: 5 } }))
      .rejects.toThrow(/writes data schema 4, but the release manifest declares 5/);
  });

  test('every abort produces no output html at all', async () => {
    await expect(install({ corruptBytes: true })).rejects.toSatisfy(
      error => error instanceof UpdateError && error.outputHtml === undefined
    );
  });
});

/* ------------------------------------------------------- shared pipeline */

describe('applyUpdatePipeline', () => {
  const shellMetadata = { appVersion: '4.1.0', schemaVersion: 4, minSchemaVersion: 3, repository: REPOSITORY };

  test('refuses data older than the shell supports', () => {
    expect(() => applyUpdatePipeline({
      currentCapsule: { schemaVersion: 2, projects: [] },
      shellHtml: newerShell,
      shellMetadata,
      sourceAppVersion: '4.0.0'
    })).toThrow(/supports data schema 3 through 4/);
  });

  test('refuses data newer than the shell understands, rather than downgrading it', () => {
    expect(() => applyUpdatePipeline({
      currentCapsule: { schemaVersion: 9, projects: [] },
      shellHtml: newerShell,
      shellMetadata,
      sourceAppVersion: '4.0.0'
    })).toThrow(/supports data schema 3 through 4/);
  });

  test('a validation failure produces no file and says so', () => {
    expect(() => applyUpdatePipeline({
      currentCapsule: {
        schemaVersion: 4,
        projects: [{ id: 'p1', contentItems: [{ id: 'i1', type: 'image', src: 'https://example.com/a.png' }] }],
        preferences: {}
      },
      shellHtml: newerShell,
      shellMetadata,
      sourceAppVersion: '4.0.0'
    })).toThrow(/did not validate, so no upgraded file was produced/);
  });

  test('a shell with no injection region is refused', () => {
    expect(() => applyUpdatePipeline({
      currentCapsule: CAPSULE,
      shellHtml: '<html>not a release</html>',
      shellMetadata,
      sourceAppVersion: '4.0.0'
    })).toThrow(/Could not build the upgraded file/);
  });

  test('migrates a legacy schema 3 capsule through the same path', () => {
    const result = applyUpdatePipeline({
      currentCapsule: { schemaVersion: 3, projects: [{ id: 'p1', name: 'Legacy' }], preferences: {} },
      shellHtml: newerShell,
      shellMetadata,
      sourceAppVersion: '3.0.0'
    });
    expect(result.report.migrationsApplied).toEqual(['3 -> 4']);
    expect(extractDataFromHtml(result.outputHtml).capsule.projects[0].name).toBe('Legacy');
  });

  test('the backup is taken before migration, from the original capsule', () => {
    const backup = buildUpdateBackup({ schemaVersion: 3, projects: [{ id: 'p1' }] }, '4.0.0', 'T');
    expect(backup).toEqual({
      backupFormatVersion: 1,
      backedUpAt: 'T',
      sourceAppVersion: '4.0.0',
      data: { schemaVersion: 3, projects: [{ id: 'p1' }] }
    });
  });
});

/* ---------------------------------------------------------- manual update */

describe('inspectManualUpdate trust states', () => {
  test('matching bytes are verified against the official release', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    const inspection = await inspectManualUpdate(github.bytes, {
      repository: REPOSITORY, installedAppVersion: '4.0.0', fetchImpl: github.fetchImpl
    });
    expect(inspection.trust).toBe('verified-official');
    expect(inspection.versionRelation).toBe('newer');
  });

  test('modified bytes are a hard failure, never softened to unverified', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    const tampered = new TextEncoder().encode(`${newerShell}<!-- edited -->`);
    const inspection = await inspectManualUpdate(tampered, {
      repository: REPOSITORY, installedAppVersion: '4.0.0', fetchImpl: github.fetchImpl
    });
    expect(inspection.trust).toBe('verification-failed');
    expect(inspection.reason).toMatch(/modified, corrupted, or a copy you saved yourself/);
  });

  test('offline selection is unverified, not failed', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    const inspection = await inspectManualUpdate(github.bytes, {
      repository: REPOSITORY, installedAppVersion: '4.0.0', online: false, fetchImpl: github.fetchImpl
    });
    expect(inspection.trust).toBe('unverified-offline');
  });

  test('an unreachable release is unverified, because that is not evidence of tampering', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    const inspection = await inspectManualUpdate(github.bytes, {
      repository: REPOSITORY, installedAppVersion: '4.0.0', fetchImpl: offlineFetch
    });
    expect(inspection.trust).toBe('unverified-offline');
    expect(inspection.reason).toMatch(/could not be confirmed/);
  });

  test('reports when a selected file is the same version or older', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    expect((await inspectManualUpdate(github.bytes, {
      repository: REPOSITORY, installedAppVersion: '4.1.0', fetchImpl: github.fetchImpl
    })).versionRelation).toBe('same');

    expect((await inspectManualUpdate(github.bytes, {
      repository: REPOSITORY, installedAppVersion: '9.0.0', fetchImpl: github.fetchImpl
    })).versionRelation).toBe('older');
  });

  test('a file that is not a release at all is rejected outright', async () => {
    const notARelease = new TextEncoder().encode('<html><body>hello</body></html>');
    await expect(inspectManualUpdate(notARelease, { repository: REPOSITORY, online: false }))
      .rejects.toThrow(/does not look like a Project Command Center release/);
  });
});

describe('prepareManualUpdate', () => {
  const inspectionFor = async (overrides) => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    return {
      ...(await inspectManualUpdate(github.bytes, {
        repository: REPOSITORY, installedAppVersion: '4.0.0', fetchImpl: github.fetchImpl
      })),
      ...overrides
    };
  };

  test('a verified file installs through the shared pipeline', async () => {
    const result = prepareManualUpdate({
      currentCapsule: CAPSULE,
      inspection: await inspectionFor(),
      appMetadata: APP_METADATA
    });
    expect(result.verification.trust).toBe('verified-official');
    expect(extractDataFromHtml(result.outputHtml).capsule.projects).toHaveLength(2);
  });

  test('an unverified file requires explicit confirmation', async () => {
    const inspection = await inspectionFor({ trust: 'unverified-offline' });

    expect(() => prepareManualUpdate({
      currentCapsule: CAPSULE, inspection, appMetadata: APP_METADATA
    })).toThrow(/Explicit confirmation is required/);

    const confirmed = prepareManualUpdate({
      currentCapsule: CAPSULE, inspection, appMetadata: APP_METADATA, confirmedUnverified: true
    });
    expect(confirmed.verification.trust).toBe('unverified-offline');
    expect(confirmed.verification.confirmedUnverified).toBe(true);
  });

  test('a failed verification cannot be confirmed past', async () => {
    const inspection = await inspectionFor({ trust: 'verification-failed' });
    expect(() => prepareManualUpdate({
      currentCapsule: CAPSULE, inspection, appMetadata: APP_METADATA, confirmedUnverified: true
    })).toThrow(/does not match the official release and will not be installed/);
  });

  test('online and manual paths produce identical output for the same inputs', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    const official = await prepareOfficialUpdate({
      currentCapsule: CAPSULE,
      manifest: github.manifest,
      htmlAsset: github.release.assets.find(asset => asset.name.endsWith('.html')),
      appMetadata: APP_METADATA,
      fetchImpl: github.fetchImpl,
      nowIso: '2026-08-15T00:00:00.000Z'
    });
    const manual = prepareManualUpdate({
      currentCapsule: CAPSULE,
      inspection: await inspectionFor(),
      appMetadata: APP_METADATA,
      nowIso: '2026-08-15T00:00:00.000Z'
    });

    // One migration and export engine, not two.
    expect(manual.outputHtml).toBe(official.outputHtml);
    expect(manual.backup).toEqual(official.backup);
    expect(manual.report).toEqual(official.report);
  });
});
