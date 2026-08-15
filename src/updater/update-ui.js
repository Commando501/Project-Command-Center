import { formatBytes, formatUpdated } from '../app/format.js';
import { buildUpdateBackup, checkForOnlineUpdate, inspectManualUpdate, prepareManualUpdate, prepareOfficialUpdate } from './update-engine.js';
import { hasReleaseRepository } from './app-metadata.js';
import { isSha256Available } from './sha256.js';
import { setPreference, toDataCapsule } from '../app/state.js';

/**
 * Update settings, availability banner, review, and result flow.
 *
 * Two rules shape all of it:
 *
 *   Nothing installs on its own. The startup check only ever reveals a banner;
 *   downloading requires the review panel, and producing an upgraded file
 *   requires a further explicit click.
 *
 *   The check never blocks the tracker. It is started after the first render
 *   and every failure path resolves to a quiet status line inside this dialog.
 */

const PANELS = ['updateSettingsPanel', 'updateReviewPanel', 'updateResultPanel'];

export function initUpdateUi({
  state,
  appMetadata,
  document: doc,
  showToast,
  downloadBlob,
  refreshSaveState,
  fetchImpl = globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined
}) {
  const $ = (id) => doc.getElementById(id);

  const els = Object.fromEntries([
    'updatesBtn', 'updatesDialog', 'closeUpdatesBtn', 'updateBanner', 'updateBannerText',
    'viewUpdateBtn', 'dismissUpdateBtn', 'updateFileInput',
    'updateSettingsPanel', 'updateReviewPanel', 'updateResultPanel',
    'updateAppVersion', 'updateSchemaVersion', 'updateChannelValue', 'updateLastChecked',
    'prefAutoCheck', 'prefAutoBackup', 'prefChannel', 'updateStatusText',
    'reviewInstalledVersion', 'reviewCandidateVersion', 'reviewSchema', 'reviewCompatibility',
    'reviewSize', 'reviewPublished', 'reviewVerification', 'reviewNotes',
    'resultSummary', 'resultOldVersion', 'resultNewVersion', 'resultSchema',
    'resultProjects', 'resultImages', 'resultVerification', 'resultWarnings',
    'updateBackBtn', 'exportBackupBtn', 'installFromFileBtn', 'checkUpdatesBtn',
    'confirmUnverifiedBtn', 'installUpdateBtn', 'downloadBackupBtn', 'downloadUpdatedBtn'
  ].map(id => [id, $(id)]));

  let availability = null;
  let inspection = null;
  let prepared = null;
  let busy = false;

  const show = (element, visible) => element.classList.toggle('hidden', !visible);

  function showPanel(name) {
    for (const panel of PANELS) show(els[panel], panel === name);

    const settings = name === 'updateSettingsPanel';
    show(els.updateBackBtn, !settings);
    show(els.exportBackupBtn, settings);
    show(els.installFromFileBtn, settings);
    show(els.checkUpdatesBtn, settings);

    const review = name === 'updateReviewPanel';
    show(els.installUpdateBtn, review);
    show(els.confirmUnverifiedBtn, review && inspection?.trust === 'unverified-offline');

    const result = name === 'updateResultPanel';
    show(els.downloadBackupBtn, result && Boolean(prepared?.backup));
    show(els.downloadUpdatedBtn, result);
  }

  let statusSet = false;
  function setStatus(message) {
    els.updateStatusText.textContent = message;
    statusSet = true;
  }

  function refreshSettings() {
    els.updateAppVersion.textContent = appMetadata.appVersion;
    els.updateSchemaVersion.textContent = String(state.schemaVersion);
    els.updateChannelValue.textContent = state.preferences.updateChannel;
    els.updateLastChecked.textContent = state.lastUpdateCheckAt
      ? formatUpdated(state.lastUpdateCheckAt)
      : 'Never';
    els.prefAutoCheck.checked = state.preferences.checkForUpdatesAutomatically !== false;
    els.prefAutoBackup.checked = state.preferences.automaticBackupBeforeUpdate !== false;
    els.prefChannel.value = state.preferences.updateChannel;
  }

  function describeAvailability(result) {
    switch (result.status) {
      case 'available':
        return `Version ${result.manifest.appVersion} is available.`;
      case 'current':
        return result.reason || `Version ${appMetadata.appVersion} is the latest release.`;
      case 'incompatible':
        return result.reason;
      case 'unconfigured':
        return 'This build is not configured for a public release channel, so update checking is off.';
      case 'disabled':
        return 'Automatic update checks are switched off.';
      default:
        return `Update check failed: ${result.error}`;
    }
  }

  function showBanner(result) {
    els.updateBannerText.textContent = `Project Command Center ${result.manifest.appVersion} is available`;
    show(els.updateBanner, true);
  }

  /** Runs a check. Every failure lands in the status line, never in the way. */
  async function runCheck({ force = false, announce = false } = {}) {
    if (busy) return null;
    busy = true;
    if (announce) setStatus('Checking for updates…');

    try {
      const result = await checkForOnlineUpdate({
        appMetadata,
        preferences: state.preferences,
        installedSchemaVersion: state.schemaVersion,
        fetchImpl,
        force
      });

      // Session-only: writing this into preferences would dirty the document
      // on every open and prompt an unsaved-changes warning nobody caused.
      if (result.status !== 'disabled' && result.status !== 'unconfigured') {
        state.lastUpdateCheckAt = new Date().toISOString();
      }
      state.lastUpdateCheckStatus = result.status;

      availability = result.status === 'available' ? result : null;
      if (availability) showBanner(result);

      setStatus(describeAvailability(result));
      refreshSettings();
      return result;
    } finally {
      busy = false;
    }
  }

  function openReview() {
    const manifest = availability.manifest;
    els.reviewInstalledVersion.textContent = appMetadata.appVersion;
    els.reviewCandidateVersion.textContent = manifest.appVersion;
    els.reviewSchema.textContent = `${state.schemaVersion} → ${manifest.schemaVersion}`;
    els.reviewCompatibility.textContent = state.schemaVersion >= manifest.minSchemaVersion
      ? 'Supported'
      : 'Not supported';
    els.reviewSize.textContent = availability.htmlAsset.size
      ? formatBytes(availability.htmlAsset.size)
      : 'Unknown';
    els.reviewPublished.textContent = formatUpdated(manifest.publishedAt);

    const notes = Array.isArray(manifest.releaseNotes) ? manifest.releaseNotes : [];
    els.reviewNotes.innerHTML = '';
    for (const note of notes.length ? notes : ['No release notes were provided.']) {
      const item = doc.createElement('li');
      item.textContent = note;
      els.reviewNotes.appendChild(item);
    }

    inspection = null;
    setVerification(
      'The release will be downloaded and its SHA-256 checked before anything is migrated.',
      ''
    );
    els.installUpdateBtn.textContent = 'Install Update';
    els.installUpdateBtn.disabled = !isSha256Available();
    if (!isSha256Available()) {
      setVerification(
        'This browser cannot verify updates because Web Crypto is unavailable. '
        + 'Download the release from GitHub and verify it yourself.',
        'failed'
      );
    }

    showPanel('updateReviewPanel');
    els.updatesDialog.showModal();
  }

  function setVerification(message, className) {
    els.reviewVerification.textContent = message;
    els.reviewVerification.className = `update-verification ${className}`.trim();
  }

  function showResult(result) {
    prepared = result;
    els.resultOldVersion.textContent = result.report.oldAppVersion;
    els.resultNewVersion.textContent = result.report.newAppVersion;
    els.resultSchema.textContent = result.report.fromSchema === result.report.toSchema
      ? String(result.report.toSchema)
      : `${result.report.fromSchema} → ${result.report.toSchema}`;
    els.resultProjects.textContent = String(result.report.projectsMigrated);
    els.resultImages.textContent = String(result.report.imagesPreserved);
    els.resultVerification.textContent = result.verification.trust === 'verified-official'
      ? 'Verified official release'
      : 'Unverified, used with explicit confirmation';
    els.resultSummary.textContent =
      `${result.report.newAppVersion} was created successfully. Your previous file was not modified.`;

    const warnings = result.report.warnings || [];
    els.resultWarnings.innerHTML = '';
    show(els.resultWarnings, warnings.length > 0);
    for (const warning of warnings) {
      const item = doc.createElement('li');
      item.textContent = warning;
      els.resultWarnings.appendChild(item);
    }

    showPanel('updateResultPanel');
  }

  async function installOfficial() {
    if (busy || !availability) return;
    busy = true;
    els.installUpdateBtn.disabled = true;
    setVerification('Downloading and verifying the release…', '');

    try {
      const result = await prepareOfficialUpdate({
        currentCapsule: toDataCapsule(state),
        manifest: availability.manifest,
        htmlAsset: availability.htmlAsset,
        appMetadata,
        fetchImpl
      });
      showResult(result);
      showToast('Update prepared. Your current file was not modified.');
    } catch (error) {
      // Nothing was produced and nothing was changed.
      setVerification(error?.message || 'The update could not be completed.', 'failed');
      els.installUpdateBtn.disabled = false;
    } finally {
      busy = false;
    }
  }

  async function inspectSelectedFile(file) {
    if (!file) return;
    setStatus(`Inspecting ${file.name}…`);

    let bytes;
    try {
      // Bytes, not text: the digest must be taken over exactly what is on disk.
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      setStatus(`Could not read that file: ${error.message}`);
      return;
    }

    try {
      inspection = await inspectManualUpdate(bytes, {
        repository: appMetadata.repository,
        installedAppVersion: appMetadata.appVersion,
        online: hasReleaseRepository(appMetadata) && Boolean(fetchImpl),
        fetchImpl
      });
    } catch (error) {
      inspection = null;
      setStatus(error?.message || 'That file is not a Project Command Center release.');
      showPanel('updateSettingsPanel');
      return;
    }

    availability = null;
    const meta = inspection.shellMetadata;
    els.reviewInstalledVersion.textContent = appMetadata.appVersion;
    els.reviewCandidateVersion.textContent = meta.appVersion;
    els.reviewSchema.textContent = `${state.schemaVersion} → ${meta.schemaVersion}`;
    els.reviewCompatibility.textContent =
      state.schemaVersion >= meta.minSchemaVersion && state.schemaVersion <= meta.schemaVersion
        ? 'Supported'
        : 'Not supported';
    els.reviewSize.textContent = formatBytes(bytes.byteLength);
    els.reviewPublished.textContent = file.name;
    els.reviewNotes.innerHTML = '<li>Release notes are only available for online updates.</li>';

    const relation = inspection.versionRelation;
    const relationNote = relation === 'older'
      ? ' This file is OLDER than the version you are using.'
      : relation === 'same'
        ? ' This file is the same version you are already using.'
        : '';

    if (inspection.trust === 'verified-official') {
      setVerification(`Verified against the official ${meta.appVersion} release.${relationNote}`, 'verified');
      els.installUpdateBtn.disabled = false;
    } else if (inspection.trust === 'verification-failed') {
      setVerification(`${inspection.reason}${relationNote}`, 'failed');
      els.installUpdateBtn.disabled = true;
    } else {
      setVerification(
        'Unverified update. This file cannot be confirmed as an official Project Command Center '
        + `release. Your current HTML file will remain unchanged.${relationNote}`,
        'unverified'
      );
      // The ordinary Install button stays disabled; taking an unverified file
      // requires the separate, explicitly labelled action.
      els.installUpdateBtn.disabled = true;
    }

    els.installUpdateBtn.textContent = 'Install Update';
    showPanel('updateReviewPanel');
  }

  function installManual({ confirmedUnverified = false } = {}) {
    if (!inspection) return;
    try {
      const result = prepareManualUpdate({
        currentCapsule: toDataCapsule(state),
        inspection,
        appMetadata,
        confirmedUnverified
      });
      showResult(result);
      showToast('Update prepared. Your current file was not modified.');
    } catch (error) {
      setVerification(error?.message || 'The update could not be completed.', 'failed');
    }
  }

  function exportDataBackup() {
    const backup = buildUpdateBackup(
      toDataCapsule(state), appMetadata.appVersion, new Date().toISOString()
    );
    downloadBlob(
      `Project-Command-Center-backup-${backup.backedUpAt.slice(0, 10)}.json`,
      JSON.stringify(backup, null, 2),
      'application/json;charset=utf-8'
    );
    showToast('Data backup downloaded.');
  }

  /* ------------------------------------------------------------- wiring */

  els.updatesBtn.addEventListener('click', () => {
    refreshSettings();
    // Never overwrite a real result (a failed check, a disabled preference)
    // with the generic opening line.
    if (!statusSet) {
      setStatus(hasReleaseRepository(appMetadata)
        ? 'Updates are never installed automatically.'
        : 'This build is not configured for a public release channel, so update checking is off.');
    }
    showPanel('updateSettingsPanel');
    els.updatesDialog.showModal();
  });

  els.closeUpdatesBtn.addEventListener('click', () => els.updatesDialog.close());
  els.updateBackBtn.addEventListener('click', () => {
    refreshSettings();
    showPanel('updateSettingsPanel');
  });

  els.viewUpdateBtn.addEventListener('click', () => {
    if (availability) openReview();
  });
  // Dismissal is session-only; it is not written into the capsule.
  els.dismissUpdateBtn.addEventListener('click', () => show(els.updateBanner, false));

  els.checkUpdatesBtn.addEventListener('click', async () => {
    const result = await runCheck({ force: true, announce: true });
    if (result?.status === 'available') openReview();
  });

  els.installFromFileBtn.addEventListener('click', () => {
    els.updateFileInput.value = '';
    els.updateFileInput.click();
  });
  els.updateFileInput.addEventListener('change', event => {
    inspectSelectedFile(event.target.files && event.target.files[0]);
  });

  els.installUpdateBtn.addEventListener('click', () => {
    if (availability) installOfficial();
    else installManual({ confirmedUnverified: false });
  });
  els.confirmUnverifiedBtn.addEventListener('click', () => {
    installManual({ confirmedUnverified: true });
  });

  els.exportBackupBtn.addEventListener('click', exportDataBackup);
  els.downloadBackupBtn.addEventListener('click', () => {
    if (!prepared?.backup) return;
    downloadBlob(
      `Project-Command-Center-backup-${prepared.backup.backedUpAt.slice(0, 10)}.json`,
      JSON.stringify(prepared.backup, null, 2),
      'application/json;charset=utf-8'
    );
  });
  els.downloadUpdatedBtn.addEventListener('click', () => {
    if (!prepared) return;
    downloadBlob(prepared.outputFilename, prepared.outputHtml, 'text/html;charset=utf-8');
    showToast('Upgraded file downloaded. Your previous file is unchanged.');
  });

  const bindPreference = (element, key, read) => {
    element.addEventListener('change', () => {
      if (setPreference(state, key, read(element))) refreshSaveState();
      refreshSettings();
    });
  };
  bindPreference(els.prefAutoCheck, 'checkForUpdatesAutomatically', el => el.checked);
  bindPreference(els.prefAutoBackup, 'automaticBackupBeforeUpdate', el => el.checked);
  bindPreference(els.prefChannel, 'updateChannel', el => el.value);

  refreshSettings();
  showPanel('updateSettingsPanel');

  return {
    runCheck,
    /**
     * Started after the first render, never awaited by boot. The tracker is
     * fully usable while this is in flight, and stays usable if it fails.
     */
    startAutomaticCheck() {
      if (state.preferences.checkForUpdatesAutomatically === false) {
        setStatus('Automatic update checks are switched off.');
        return Promise.resolve({ status: 'disabled' });
      }
      return runCheck({ force: false }).catch(() => null);
    }
  };
}
