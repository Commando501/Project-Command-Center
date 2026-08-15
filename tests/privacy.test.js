import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, test } from 'vitest';

import { getBuiltArtifact } from './helpers/built-artifact.js';
import { REPOSITORY, createFakeGitHub, reversionShell } from './helpers/fake-github.js';
import {
  buildUpdateCandidate,
  checkForOnlineUpdate,
  inspectManualUpdate,
  prepareOfficialUpdate
} from '../src/updater/update-engine.js';

/**
 * User project data must never leave the browser during an update.
 *
 * Every sentinel below is placed in a different part of the capsule. If any of
 * them ever appears in a request URL, header, or body, this suite fails.
 */

const SENTINELS = Object.freeze([
  'PRIVATE_PROJECT_NAME_DO_NOT_SEND',
  'PRIVATE_IMAGE_DATA_DO_NOT_SEND',
  'PRIVATE_NOTE_DO_NOT_SEND',
  'PRIVATE_TAG_DO_NOT_SEND',
  'PRIVATE_LINK_DO_NOT_SEND',
  'PRIVATE_TASK_DO_NOT_SEND',
  'PRIVATE_CATEGORY_DO_NOT_SEND',
  'PRIVATE_NEXT_ACTION_DO_NOT_SEND',
  'PRIVATE_FILENAME_DO_NOT_SEND',
  'PRIVATE_CAPTION_DO_NOT_SEND'
]);

const PRIVATE_CAPSULE = {
  schemaVersion: 4,
  projects: [{
    id: 'PRIVATE_ID_DO_NOT_SEND',
    name: 'PRIVATE_PROJECT_NAME_DO_NOT_SEND',
    category: 'PRIVATE_CATEGORY_DO_NOT_SEND',
    status: 'Active',
    priority: 'High',
    progress: 42,
    nextAction: 'PRIVATE_NEXT_ACTION_DO_NOT_SEND',
    tags: ['PRIVATE_TAG_DO_NOT_SEND'],
    notes: 'PRIVATE_NOTE_DO_NOT_SEND',
    link: 'https://example.com/PRIVATE_LINK_DO_NOT_SEND',
    contentItems: [
      { id: 'i1', type: 'task', text: 'PRIVATE_TASK_DO_NOT_SEND', completed: true },
      {
        id: 'i2', type: 'image',
        src: 'data:image/webp;base64,PRIVATE_IMAGE_DATA_DO_NOT_SEND',
        caption: 'PRIVATE_CAPTION_DO_NOT_SEND',
        filename: 'PRIVATE_FILENAME_DO_NOT_SEND.webp',
        mimeType: 'image/webp', width: 100, height: 100, displayWidth: 100,
        originalWidth: 100, originalHeight: 100, sizeBytes: 10, optimizationCap: 1600
      }
    ]
  }],
  preferences: {
    checkForUpdatesAutomatically: true,
    updateChannel: 'stable',
    automaticBackupBeforeUpdate: true
  }
};

const APP_METADATA = {
  appVersion: '4.0.0',
  schemaVersion: 4,
  minSchemaVersion: 3,
  updateChannel: 'stable',
  repository: REPOSITORY
};

/** Everything a request could possibly carry, flattened to one string. */
function requestSurface(request) {
  const { url, init = {} } = request;
  return [
    url,
    JSON.stringify(init.headers ?? {}),
    typeof init.body === 'string' ? init.body : JSON.stringify(init.body ?? null),
    JSON.stringify(init.referrer ?? ''),
    JSON.stringify(init)
  ].join('   ');
}

function assertNoSentinels(requests) {
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    const surface = requestSurface(request);
    for (const sentinel of SENTINELS) {
      expect(surface).not.toContain(sentinel);
    }
    expect(surface).not.toContain('PRIVATE_ID_DO_NOT_SEND');
  }
}

let newerShell;

beforeAll(async () => {
  const build = await getBuiltArtifact();
  const html = await readFile(build.path, 'utf8');
  newerShell = reversionShell(html, { appVersion: '4.1.0', repository: REPOSITORY });
}, 120000);

describe('update discovery sends no project data', () => {
  test('an availability check carries nothing but the repository slug', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    await checkForOnlineUpdate({
      appMetadata: APP_METADATA,
      preferences: PRIVATE_CAPSULE.preferences,
      installedSchemaVersion: PRIVATE_CAPSULE.schemaVersion,
      fetchImpl: github.fetchImpl
    });
    assertNoSentinels(github.requests);
  });

  test('no request carries a body at all', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    await checkForOnlineUpdate({
      appMetadata: APP_METADATA, preferences: PRIVATE_CAPSULE.preferences, fetchImpl: github.fetchImpl
    });
    for (const request of github.requests) {
      expect(request.init.body).toBeUndefined();
      expect(request.init.method).toBe('GET');
    }
  });

  test('no request carries credentials or a referrer', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    await checkForOnlineUpdate({
      appMetadata: APP_METADATA, preferences: PRIVATE_CAPSULE.preferences, fetchImpl: github.fetchImpl
    });
    for (const request of github.requests) {
      expect(request.init.credentials).toBe('omit');
      expect(request.init.referrerPolicy).toBe('no-referrer');
    }
  });

  test('only the two documented endpoints are contacted', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    await checkForOnlineUpdate({
      appMetadata: APP_METADATA, preferences: PRIVATE_CAPSULE.preferences, fetchImpl: github.fetchImpl
    });
    for (const request of github.requests) {
      expect(request.url).toMatch(/^https:\/\/(api\.github\.com|github\.com)\//);
    }
  });
});

describe('installing an update sends no project data', () => {
  test('the whole download and migrate path stays private', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    const htmlAsset = github.release.assets.find(asset => asset.name.endsWith('.html'));
    const result = await prepareOfficialUpdate({
      currentCapsule: PRIVATE_CAPSULE,
      candidate: buildUpdateCandidate({
        release: github.release,
        htmlAsset,
        manifest: github.manifest
      }),
      htmlAsset,
      appMetadata: APP_METADATA,
      fetchImpl: github.fetchImpl
    });

    assertNoSentinels(github.requests);

    // The data did travel -- into the new shell, locally, which is the point.
    expect(result.outputHtml).toContain('PRIVATE_PROJECT_NAME_DO_NOT_SEND');
  });

  test('verifying a manual file sends only the version tag', async () => {
    const github = await createFakeGitHub({ shellHtml: newerShell });
    await inspectManualUpdate(github.bytes, {
      repository: REPOSITORY,
      installedAppVersion: '4.0.0',
      fetchImpl: github.fetchImpl
    });
    assertNoSentinels(github.requests);
    expect(github.requests[0].url).toContain('/releases/tags/v4.1.0');
  });
});

describe('the shipped artifact contains no telemetry', () => {
  test('no network origin outside the allowlist appears in the artifact', async () => {
    const build = await getBuiltArtifact();
    const html = await readFile(build.path, 'utf8');

    // Real hostnames only: this deliberately does not match the "https://..."
    // placeholder text on the link inputs.
    const ALLOWED = new Set([
      'https://api.github.com',
      'https://github.com',
      'http://www.w3.org'
    ]);
    const origins = [...html.matchAll(/https?:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)]
      .map(match => match[0].toLowerCase());

    expect([...new Set(origins)].filter(origin => !ALLOWED.has(origin))).toEqual([]);
  });

  test('no analytics, beacon, or websocket call exists anywhere in the artifact', async () => {
    const build = await getBuiltArtifact();
    const html = await readFile(build.path, 'utf8');
    for (const pattern of [/sendBeacon/i, /new WebSocket/i, /XMLHttpRequest/i, /navigator\.connection/i]) {
      expect(html).not.toMatch(pattern);
    }
  });
});
