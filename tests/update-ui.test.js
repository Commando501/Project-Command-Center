import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { JSDOM, VirtualConsole } from 'jsdom';
import { beforeAll, describe, expect, test } from 'vitest';

import { getBuiltArtifact } from './helpers/built-artifact.js';
import { REPOSITORY, createFakeGitHub, offlineFetch, reversionShell } from './helpers/fake-github.js';
import { dataRegionRegex } from '../src/persistence/markers.js';
import { injectDataCapsuleIntoShell } from '../src/persistence/standalone-export.js';

/**
 * The update UI, driven through the actual built artifact.
 *
 * fetch is installed with jsdom's beforeParse hook so the application's own
 * startup check runs against a controlled fake GitHub, rather than testing a
 * reimplementation of the flow.
 */

let builtHtml;
let releaseShell;
let installedVersion;

const CAPSULE = {
  schemaVersion: 4,
  projects: [{
    id: 'p1',
    name: 'Existing Project',
    contentItems: [{ id: 'i1', type: 'task', text: 'a', completed: true }]
  }],
  preferences: {
    checkForUpdatesAutomatically: true,
    updateChannel: 'stable',
    automaticBackupBeforeUpdate: true
  }
};

/** Boots the artifact with a configured repository and an injected fetch. */
function boot(html, { fetchImpl, capsule = CAPSULE, repository = REPOSITORY, withCrypto = true } = {}) {
  const configured = reversionShell(injectDataCapsuleIntoShell(html, capsule), { repository });

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});

  const captured = [];
  const dom = new JSDOM(configured, {
    runScripts: 'dangerously',
    url: 'file:///Project-Command-Center.html',
    virtualConsole,
    beforeParse(window) {
      // jsdom does not put the Encoding API on the window. Every browser does,
      // including on file:// pages, so this fills a test-harness gap rather
      // than papering over a product limitation.
      window.TextDecoder = TextDecoder;
      window.TextEncoder = TextEncoder;

      // jsdom exposes crypto.getRandomValues but not crypto.subtle. Browsers
      // provide subtle on file:// pages, which count as secure contexts, and
      // the release-candidate smoke test confirms that in a real browser.
      if (withCrypto && !window.crypto?.subtle) {
        Object.defineProperty(window, 'crypto', {
          value: webcrypto, configurable: true, writable: true
        });
      }
      if (!window.Blob.prototype.arrayBuffer) {
        window.Blob.prototype.arrayBuffer = function arrayBuffer() {
          return new Promise((resolve, reject) => {
            const reader = new window.FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(this);
          });
        };
      }

      if (fetchImpl) window.fetch = fetchImpl;
      window.URL.createObjectURL = (blob) => {
        captured.push(blob);
        return 'blob:stub';
      };
      window.URL.revokeObjectURL = () => {};
      // jsdom has no dialog implementation; the flow only needs open/close.
      window.HTMLDialogElement.prototype.showModal = function showModal() {
        this.setAttribute('open', '');
      };
      window.HTMLDialogElement.prototype.close = function close() {
        this.removeAttribute('open');
      };
    }
  });

  return { dom, window: dom.window, document: dom.window.document, captured };
}

const click = (session, id) => session.document.getElementById(id)
  .dispatchEvent(new session.window.Event('click', { bubbles: true }));

const visible = (session, id) => !session.document.getElementById(id).classList.contains('hidden');
const text = (session, id) => session.document.getElementById(id).textContent.trim();

async function waitFor(check, { timeout = 3000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting for a condition.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function readBlob(window, blob) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

beforeAll(async () => {
  const build = await getBuiltArtifact();
  installedVersion = build.appVersion;
  builtHtml = await readFile(build.path, 'utf8');
  releaseShell = reversionShell(builtHtml, { appVersion: '4.1.0', repository: REPOSITORY });
}, 120000);

describe('the startup check never blocks the tracker', () => {
  test('projects render before any network work completes', async () => {
    let releaseFetch;
    const blocked = new Promise(resolve => { releaseFetch = resolve; });

    const session = boot(builtHtml, { fetchImpl: () => blocked });

    // The check is still pending, and the app is already fully usable.
    expect(session.document.querySelectorAll('.project-card')).toHaveLength(1);
    expect(text(session, 'metricTotal')).toBe('1');
    expect(visible(session, 'updateBanner')).toBe(false);

    releaseFetch({ ok: false, status: 500, json: async () => ({}) });
  });

  test('a network failure leaves the app working and shows no banner', async () => {
    const session = boot(builtHtml, { fetchImpl: offlineFetch });

    await waitFor(() => text(session, 'updateStatusText').includes('failed'));
    expect(visible(session, 'updateBanner')).toBe(false);
    expect(session.document.querySelectorAll('.project-card')).toHaveLength(1);

    // The tracker still edits normally.
    const nameInput = session.document.querySelector('[data-project-id="p1"].inline-name');
    nameInput.value = 'Still Editable';
    nameInput.dispatchEvent(new session.window.Event('input', { bubbles: true }));
    expect(session.document.querySelector('#unsavedDot').classList.contains('show')).toBe(true);
  });

  test('a local development build never touches the network', async () => {
    const requests = [];
    const session = boot(builtHtml, {
      repository: 'local/project-command-center',
      fetchImpl: async (url) => {
        requests.push(url);
        return { ok: false, status: 404, json: async () => ({}) };
      }
    });

    click(session, 'updatesBtn');
    await waitFor(() => text(session, 'updateStatusText').includes('not configured'));
    expect(requests).toEqual([]);
  });

  test('the check is skipped when the preference is off', async () => {
    const requests = [];
    const session = boot(builtHtml, {
      capsule: { ...CAPSULE, preferences: { ...CAPSULE.preferences, checkForUpdatesAutomatically: false } },
      fetchImpl: async (url) => {
        requests.push(url);
        return { ok: false, status: 404, json: async () => ({}) };
      }
    });

    click(session, 'updatesBtn');
    await waitFor(() => text(session, 'updateStatusText').includes('switched off'));
    expect(requests).toEqual([]);
    expect(session.document.getElementById('prefAutoCheck').checked).toBe(false);
  });
});

describe('the availability banner', () => {
  test('appears when a newer release exists, and installs nothing', async () => {
    const github = await createFakeGitHub({ shellHtml: releaseShell });
    const session = boot(builtHtml, { fetchImpl: github.fetchImpl });

    await waitFor(() => visible(session, 'updateBanner'));
    expect(text(session, 'updateBannerText')).toBe('Project Command Center 4.1.0 is available');

    // Only metadata and the manifest were fetched. Nothing was installed.
    expect(github.requests.some(request => request.url.includes('.html'))).toBe(false);
    expect(session.captured).toHaveLength(0);
    expect(visible(session, 'updateResultPanel')).toBe(false);
  });

  test('Dismiss hides it without touching the capsule', async () => {
    const github = await createFakeGitHub({ shellHtml: releaseShell });
    const session = boot(builtHtml, { fetchImpl: github.fetchImpl });

    await waitFor(() => visible(session, 'updateBanner'));
    click(session, 'dismissUpdateBtn');

    expect(visible(session, 'updateBanner')).toBe(false);
    // Dismissal is session-only, so the document is still clean.
    expect(session.document.querySelector('#unsavedDot').classList.contains('show')).toBe(false);
  });

  test('View Update opens the review panel without downloading', async () => {
    const github = await createFakeGitHub({ shellHtml: releaseShell });
    const session = boot(builtHtml, { fetchImpl: github.fetchImpl });

    await waitFor(() => visible(session, 'updateBanner'));
    click(session, 'viewUpdateBtn');

    expect(visible(session, 'updateReviewPanel')).toBe(true);
    expect(text(session, 'reviewInstalledVersion')).toBe(installedVersion);
    expect(text(session, 'reviewCandidateVersion')).toBe('4.1.0');
    expect(text(session, 'reviewSchema')).toBe('4 → 4');
    expect(text(session, 'reviewCompatibility')).toBe('Supported');
    expect(text(session, 'reviewNotes')).toContain('Verified update pipeline');
    expect(github.requests.some(request => request.url.includes('.html'))).toBe(false);
  });
});

describe('installing an official update', () => {
  test('downloads, verifies, and offers the upgraded file', async () => {
    const github = await createFakeGitHub({ shellHtml: releaseShell });
    const session = boot(builtHtml, { fetchImpl: github.fetchImpl });

    await waitFor(() => visible(session, 'updateBanner'));
    click(session, 'viewUpdateBtn');
    click(session, 'installUpdateBtn');

    await waitFor(() => visible(session, 'updateResultPanel'));
    expect(text(session, 'resultOldVersion')).toBe(installedVersion);
    expect(text(session, 'resultNewVersion')).toBe('4.1.0');
    expect(text(session, 'resultProjects')).toBe('1');
    expect(text(session, 'resultVerification')).toBe('Verified official release');

    // The panel must say that nothing has happened yet and what to do next.
    // Closing the dialog here loses the work, so "created successfully" alone
    // was actively misleading.
    expect(text(session, 'resultSummary')).toContain('Nothing has been written to disk yet');
    const steps = [...session.document.querySelectorAll('#resultNextSteps li')]
      .map(item => item.textContent);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toContain('Download Updated HTML');
    expect(steps[0]).toContain('Project-Command-Center-v4.1.0.html');
    expect(steps[1]).toContain('Open that new file');
    expect(steps[2]).toContain('rollback');

    // Producing the file still requires an explicit click.
    expect(session.captured).toHaveLength(0);
    expect(visible(session, 'downloadUpdatedBtn')).toBe(true);
    expect(visible(session, 'downloadBackupBtn')).toBe(true);

    click(session, 'downloadUpdatedBtn');
    const upgraded = await readBlob(session.window, session.captured[0]);
    const capsule = JSON.parse(upgraded.match(dataRegionRegex())[1]);
    expect(capsule.projects[0].name).toBe('Existing Project');
    expect(upgraded).toContain('"appVersion": "4.1.0"');
  });

  test('a tampered download is refused and produces nothing', async () => {
    const github = await createFakeGitHub({ shellHtml: releaseShell, corruptBytes: true });
    const session = boot(builtHtml, { fetchImpl: github.fetchImpl });

    await waitFor(() => visible(session, 'updateBanner'));
    click(session, 'viewUpdateBtn');
    click(session, 'installUpdateBtn');

    await waitFor(() => text(session, 'reviewVerification').includes('verification failed'));
    expect(text(session, 'reviewVerification')).toContain('No project data was changed');
    expect(visible(session, 'updateResultPanel')).toBe(false);
    expect(session.captured).toHaveLength(0);
    // The tracker is untouched.
    expect(session.document.querySelectorAll('.project-card')).toHaveLength(1);
  });
});

describe('opened from disk, where release assets cannot be read', () => {
  // Reproduces the real failure: from a file:// page the manifest fetch is
  // blocked by CORS, which previously killed the whole check and showed
  // "Update check failed: Could not download the release: Failed to fetch"
  // with no banner at all.

  test('the banner still appears, using the API digest', async () => {
    const github = await createFakeGitHub({ shellHtml: releaseShell, blockAssetFetch: true });
    const session = boot(builtHtml, { fetchImpl: github.fetchImpl });

    await waitFor(() => visible(session, 'updateBanner'));
    expect(text(session, 'updateBannerText')).toBe('Project Command Center 4.1.0 is available');
  });

  test('the review panel offers Download Release and explains the schema check', async () => {
    const github = await createFakeGitHub({ shellHtml: releaseShell, blockAssetFetch: true });
    const session = boot(builtHtml, { fetchImpl: github.fetchImpl });

    await waitFor(() => visible(session, 'updateBanner'));
    click(session, 'viewUpdateBtn');

    expect(visible(session, 'downloadReleaseBtn')).toBe(true);
    expect(session.document.getElementById('downloadReleaseBtn').getAttribute('href'))
      .toContain('Project-Command-Center-v4.1.0.html');
    expect(text(session, 'reviewSchema')).toContain('checked before migrating');
    expect(text(session, 'reviewCompatibility')).toBe('Confirmed at install');
  });

  test('pressing Install explains the download route instead of erroring', async () => {
    const github = await createFakeGitHub({ shellHtml: releaseShell, blockAssetFetch: true });
    const session = boot(builtHtml, { fetchImpl: github.fetchImpl });

    await waitFor(() => visible(session, 'updateBanner'));
    click(session, 'viewUpdateBtn');
    click(session, 'installUpdateBtn');

    await waitFor(() => text(session, 'reviewVerification').includes('Install Update From File'));
    expect(text(session, 'reviewVerification')).toContain('Nothing has been changed');
    expect(visible(session, 'updateResultPanel')).toBe(false);
    expect(session.captured).toHaveLength(0);
  });

  test('the downloaded file then installs and verifies from disk', async () => {
    const github = await createFakeGitHub({ shellHtml: releaseShell, blockAssetFetch: true });
    const session = boot(builtHtml, { fetchImpl: github.fetchImpl });

    const input = session.document.getElementById('updateFileInput');
    const file = new session.window.File([releaseShell], 'Project-Command-Center-v4.1.0.html', { type: 'text/html' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new session.window.Event('change', { bubbles: true }));

    await waitFor(() => visible(session, 'updateReviewPanel'));
    expect(text(session, 'reviewVerification')).toContain('Verified against the official 4.1.0 release');
    expect(session.document.getElementById('installUpdateBtn').disabled).toBe(false);

    click(session, 'installUpdateBtn');
    await waitFor(() => visible(session, 'updateResultPanel'));
    expect(text(session, 'resultVerification')).toBe('Verified official release');
  });
});

describe('a browser without Web Crypto degrades honestly', () => {
  // Verification is mandatory and cannot be skipped, so a browser that cannot
  // hash must say so and refuse, never quietly install something unchecked.
  test('the tracker still works and the install button is refused', async () => {
    const github = await createFakeGitHub({ shellHtml: releaseShell });
    const session = boot(builtHtml, { fetchImpl: github.fetchImpl, withCrypto: false });

    // The tracker itself is unaffected.
    expect(session.document.querySelectorAll('.project-card')).toHaveLength(1);

    await waitFor(() => visible(session, 'updateBanner'));
    click(session, 'viewUpdateBtn');

    expect(text(session, 'reviewVerification')).toContain('cannot verify updates');
    expect(session.document.getElementById('installUpdateBtn').disabled).toBe(true);
    expect(session.captured).toHaveLength(0);
  });
});

describe('manual update files', () => {
  const selectFile = async (session, bytes, name = 'Project-Command-Center-v4.1.0.html') => {
    const input = session.document.getElementById('updateFileInput');
    const file = new session.window.File([bytes], name, { type: 'text/html' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new session.window.Event('change', { bubbles: true }));
  };

  test('the picker accepts html files', async () => {
    const session = boot(builtHtml, { fetchImpl: offlineFetch });
    expect(session.document.getElementById('updateFileInput').getAttribute('accept'))
      .toBe('.html,text/html');
  });

  test('a file matching the official release is marked verified', async () => {
    const github = await createFakeGitHub({ shellHtml: releaseShell });
    const session = boot(builtHtml, { fetchImpl: github.fetchImpl });

    await selectFile(session, releaseShell);
    await waitFor(() => visible(session, 'updateReviewPanel'));

    expect(text(session, 'reviewVerification')).toContain('Verified against the official 4.1.0 release');
    expect(session.document.getElementById('installUpdateBtn').disabled).toBe(false);
    expect(visible(session, 'confirmUnverifiedBtn')).toBe(false);
  });

  test('an unverifiable file needs the separate confirmation action', async () => {
    const session = boot(builtHtml, { fetchImpl: offlineFetch });

    await selectFile(session, releaseShell);
    await waitFor(() => visible(session, 'updateReviewPanel'));

    expect(text(session, 'reviewVerification')).toContain('Unverified update');
    expect(text(session, 'reviewVerification')).toContain('will remain unchanged');
    // The ordinary install path is closed off.
    expect(session.document.getElementById('installUpdateBtn').disabled).toBe(true);
    expect(visible(session, 'confirmUnverifiedBtn')).toBe(true);

    click(session, 'confirmUnverifiedBtn');
    await waitFor(() => visible(session, 'updateResultPanel'));
    expect(text(session, 'resultVerification')).toBe('Unverified, used with explicit confirmation');
  });

  test('a modified file is refused outright, with no confirmation offered', async () => {
    const github = await createFakeGitHub({ shellHtml: releaseShell });
    const session = boot(builtHtml, { fetchImpl: github.fetchImpl });

    await selectFile(session, `${releaseShell}<!-- edited -->`);
    await waitFor(() => text(session, 'reviewVerification').includes('does not match'));

    expect(session.document.getElementById('installUpdateBtn').disabled).toBe(true);
    expect(visible(session, 'confirmUnverifiedBtn')).toBe(false);
    expect(visible(session, 'updateResultPanel')).toBe(false);
  });

  test('selecting an older file says so plainly', async () => {
    const older = reversionShell(builtHtml, { appVersion: '3.9.0', repository: REPOSITORY });
    const session = boot(builtHtml, { fetchImpl: offlineFetch });

    await selectFile(session, older, 'old.html');
    await waitFor(() => visible(session, 'updateReviewPanel'));
    expect(text(session, 'reviewVerification')).toContain('OLDER than the version you are using');
  });

  test('a file that is not a release at all is rejected with an explanation', async () => {
    const session = boot(builtHtml, { fetchImpl: offlineFetch });

    await selectFile(session, '<html><body>Just a page</body></html>', 'random.html');
    await waitFor(() => text(session, 'updateStatusText').includes('does not look like'));
    expect(visible(session, 'updateReviewPanel')).toBe(false);
  });
});

describe('update settings', () => {
  test('shows versions and channel from the file itself', async () => {
    const session = boot(builtHtml, { fetchImpl: offlineFetch });
    click(session, 'updatesBtn');

    expect(text(session, 'updateAppVersion')).toBe(installedVersion);
    expect(text(session, 'updateSchemaVersion')).toBe('4');
    expect(text(session, 'updateChannelValue')).toBe('stable');
  });

  test('changing a preference marks the document dirty, since it lives in the capsule', async () => {
    const session = boot(builtHtml, { fetchImpl: offlineFetch });
    click(session, 'updatesBtn');

    expect(session.document.querySelector('#unsavedDot').classList.contains('show')).toBe(false);

    const toggle = session.document.getElementById('prefAutoCheck');
    toggle.checked = false;
    toggle.dispatchEvent(new session.window.Event('change', { bubbles: true }));

    expect(session.document.querySelector('#unsavedDot').classList.contains('show')).toBe(true);
    expect(text(session, 'saveStateText')).toBe('You have unsaved changes.');
  });

  test('a saved file carries the changed preference forward', async () => {
    const session = boot(builtHtml, { fetchImpl: offlineFetch });
    click(session, 'updatesBtn');

    const channel = session.document.getElementById('prefChannel');
    channel.value = 'beta';
    channel.dispatchEvent(new session.window.Event('change', { bubbles: true }));

    click(session, 'saveHtmlBtn');
    const saved = await readBlob(session.window, session.captured[0]);
    expect(JSON.parse(saved.match(dataRegionRegex())[1]).preferences.updateChannel).toBe('beta');
  });

  test('the last-checked time is shown but never written into the capsule', async () => {
    const github = await createFakeGitHub({ shellHtml: releaseShell });
    const session = boot(builtHtml, { fetchImpl: github.fetchImpl });

    await waitFor(() => visible(session, 'updateBanner'));
    click(session, 'updatesBtn');
    expect(text(session, 'updateLastChecked')).not.toBe('Never');

    // A check alone must not dirty the document.
    expect(session.document.querySelector('#unsavedDot').classList.contains('show')).toBe(false);

    click(session, 'saveHtmlBtn');
    const saved = await readBlob(session.window, session.captured[0]);
    const capsule = JSON.parse(saved.match(dataRegionRegex())[1]);
    expect(Object.keys(capsule.preferences).sort()).toEqual([
      'automaticBackupBeforeUpdate', 'checkForUpdatesAutomatically', 'updateChannel'
    ]);
  });

  test('Export Data Backup produces the versioned backup shape', async () => {
    const session = boot(builtHtml, { fetchImpl: offlineFetch });
    click(session, 'updatesBtn');
    click(session, 'exportBackupBtn');

    const backup = JSON.parse(await readBlob(session.window, session.captured[0]));
    expect(backup).toMatchObject({ backupFormatVersion: 1, sourceAppVersion: installedVersion });
    expect(backup.data.projects[0].name).toBe('Existing Project');
  });
});
