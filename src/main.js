import { render } from './app/render.js';
import { PROJECT_PRIORITIES, PROJECT_STATUSES } from './app/project-model.js';
import { clamp } from './app/util.js';
import {
  addContentItem,
  addImageItem,
  addLinkItem,
  clearTagFilters,
  createAppState,
  deleteContentItem,
  deleteProject,
  duplicateProjectById,
  findContentItem,
  getProject,
  markSaved,
  replaceImageItem,
  saveProjectFromForm,
  toDataCapsule,
  toggleComplete,
  toggleTagFilter,
  updateContentItem,
  updateImageDisplayWidth,
  updateProjectField
} from './app/state.js';
import { linkifyText, escapeHtml, formatBytes } from './app/format.js';
import { optimizeImageFile } from './content/image-pipeline.js';
import {
  DEFAULT_IMAGE_LONG_EDGE,
  MAX_SOURCE_IMAGE_BYTES,
  shouldWarnAboutSourceSize
} from './content/image-optimizer.js';
import { captureShell, getCapturedShell } from './persistence/html-shell.js';
import {
  autosaveTargetKey,
  createAutosaveScheduler,
  createHandleStore,
  currentFileName,
  ensureWritePermission,
  isAutosaveSupported,
  isEmptyTarget,
  pickAutosaveTarget,
  writeHtmlToHandle
} from './persistence/autosave.js';
import {
  buildProjectsJsonBackup,
  injectDataCapsuleIntoShell
} from './persistence/standalone-export.js';
import { readAppMetadata } from './updater/app-metadata.js';
import { initUpdateUi } from './updater/update-ui.js';

const $ = (id) => document.getElementById(id);

function collectElements() {
  const ids = [
    'cardView', 'tableView', 'projectTableBody', 'projectDialog', 'dialogTitle',
    'searchInput', 'statusFilter', 'priorityFilter', 'sortSelect', 'activeTagBar',
    'projectName', 'projectCategory', 'projectStatus', 'projectPriority',
    'projectProgress', 'projectDeadline', 'projectLink', 'projectNextAction',
    'projectTags', 'projectNotes', 'progressReadout', 'deleteProjectBtn',
    'saveStateText', 'unsavedDot', 'toast', 'mediaFileInput', 'lightboxDialog',
    'lightboxImage', 'lightboxCaption', 'reoptDialog', 'reoptCap', 'appVersionChip',
    'metricTotal', 'metricActive', 'metricPlanning', 'metricBlocked', 'metricComplete',
    'cardViewBtn', 'tableViewBtn', 'saveHtmlBtn', 'backupBtn', 'addProjectBtn',
    'themeBtn', 'saveProjectBtn', 'cancelProjectBtn', 'closeDialogBtn',
    'closeLightboxBtn', 'closeReoptBtn', 'cancelReoptBtn', 'chooseReoptSourceBtn',
    'autosaveBtn', 'autosaveOffBtn', 'saveNoteDetail'
  ];
  return Object.fromEntries(ids.map(id => [id, $(id)]));
}

export function boot() {
  // Must run before anything mutates the DOM: this is the only copy of the
  // application's own source, and it is what "Save Updated HTML" rebuilds from.
  captureShell();

  const metadata = readAppMetadata();
  const state = createAppState(globalThis.PCC_DATA);
  const els = collectElements();

  let pendingMediaOperation = null;
  let reoptState = null;
  let activeResize = null;
  let toastTimer;

  if (els.appVersionChip) els.appVersionChip.textContent = `v${metadata.appVersion}`;

  const showToast = (message) => {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  };

  // In-place autosave. Session state only; the stored file handle is the
  // persistent part, and its presence is what "autosave is on" means.
  const ownFileName = currentFileName(globalThis);

  const autosave = {
    supported: isAutosaveSupported(globalThis),
    handle: null,
    active: false,
    status: null,
    store: null
  };

  const DEFAULT_SAVE_DETAIL =
    'Inline changes stay in memory while this page is open. '
    + 'Use <strong>Save Updated HTML</strong> to generate a new self-contained copy.';

  const refreshSaveState = () => {
    const note = els.saveStateText.closest('.save-note');
    const failed = autosave.status?.state === 'error';

    if (note) {
      note.classList.toggle('autosaving', autosave.active && !failed);
      note.classList.toggle('autosave-error', failed);
    }

    if (autosave.active) {
      const busy = autosave.status?.state === 'pending' || autosave.status?.state === 'writing';
      els.unsavedDot.classList.toggle('show', busy);
      els.saveStateText.textContent = busy ? 'Saving…' : 'Saved to your file.';
      if (els.saveNoteDetail) {
        // Writing somewhere other than the page you are looking at is a
        // legitimate choice, but it silently looks identical to a working
        // setup: every save succeeds and the file you keep reopening never
        // changes. Say which file is receiving the bytes.
        const elsewhere = Boolean(ownFileName)
          && Boolean(autosave.handle?.name)
          && autosave.handle.name !== ownFileName;
        els.saveNoteDetail.innerHTML =
          `Autosaving to <span class="autosave-target">${escapeHtml(autosave.handle?.name || 'your file')}</span>. `
          + (elsewhere
            ? `That is <strong>not the file you have open</strong> (${escapeHtml(ownFileName)}), `
              + 'so reopening this one will not show these changes.'
            : 'Updates still create a new file and never overwrite this one.');
      }
      return;
    }

    // The file is remembered but nothing is being written to it: permission
    // lapsed across a browser restart and re-granting needs a real click.
    // Without saying so, this state renders identically to a tracker that
    // never had autosave, and the next edit or restore goes nowhere.
    const paused = Boolean(autosave.handle) && !failed;

    els.unsavedDot.classList.toggle('show', state.dirty);
    els.saveStateText.textContent = failed
      ? 'Autosave stopped.'
      : paused
        ? 'Autosave is paused.'
        : (state.dirty ? 'You have unsaved changes.' : 'All embedded data is current.');
    if (els.saveNoteDetail) {
      els.saveNoteDetail.innerHTML = failed
        ? `${escapeHtml(autosave.status.message)} Your work is still here — use <strong>Save Updated HTML</strong>, or switch autosave back on.`
        : paused
          ? `Nothing is being written to <span class="autosave-target">${escapeHtml(autosave.handle.name)}</span> — your browser needs permission again after a restart. `
            + 'Click <strong>Resume autosave</strong>, or use <strong>Save Updated HTML</strong>.'
          : DEFAULT_SAVE_DETAIL;
    }
  };

  const draw = () => {
    render(state, els);
    refreshSaveState();
  };

  const downloadBlob = (filename, contents, type) => {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const saveUpdatedHtml = () => {
    try {
      const html = buildCurrentHtml();
      downloadBlob(
        `Project-Command-Center-v${metadata.appVersion}.html`,
        html,
        'text/html;charset=utf-8'
      );
      markSaved(state);
      els.unsavedDot.classList.remove('show');
      els.saveStateText.textContent = 'A new self-contained HTML copy was generated.';
      showToast('Updated self-contained HTML downloaded.');
    } catch (error) {
      showToast(error?.message || 'Could not generate the updated HTML file.');
    }
  };

  const exportJson = () => {
    downloadBlob(
      'Project-Command-Center-Backup.json',
      JSON.stringify(buildProjectsJsonBackup(state.projects), null, 2),
      'application/json;charset=utf-8'
    );
    showToast('JSON backup downloaded.');
  };

  /**
   * The exact bytes "Save Updated HTML" produces. Autosave and manual save
   * share this single path so they can never drift apart, and because
   * `injectDataCapsuleIntoShell` throws on a shell whose markers are missing
   * or duplicated, nothing that fails marker validation reaches a file.
   */
  const buildCurrentHtml = () =>
    injectDataCapsuleIntoShell(getCapturedShell(), toDataCapsule(state));

  const autosaveScheduler = createAutosaveScheduler({
    write: async () => {
      if (!autosave.handle || !autosave.active) return;
      const html = buildCurrentHtml();
      await writeHtmlToHandle(autosave.handle, html);
      markSaved(state);
    },
    onStatus: (status) => {
      autosave.status = status;
      if (status.state === 'error') {
        // Stop rather than retry: a revoked permission or a deleted file
        // would otherwise fail on every keystroke.
        autosave.active = false;
        showToast(`Autosave stopped: ${status.message}`);
        refreshAutosaveControls();
      }
      refreshSaveState();
    }
  });

  function refreshAutosaveControls() {
    if (!els.autosaveBtn || !els.autosaveOffBtn) return;
    if (!autosave.supported) {
      els.autosaveBtn.classList.add('hidden');
      els.autosaveOffBtn.classList.add('hidden');
      return;
    }
    const needsPermission = Boolean(autosave.handle) && !autosave.active;
    els.autosaveBtn.classList.toggle('hidden', autosave.active);
    els.autosaveBtn.textContent = needsPermission
      ? `Resume autosave to ${autosave.handle.name}`
      : 'Autosave to a file…';
    els.autosaveOffBtn.classList.toggle('hidden', !autosave.handle);
  }

  /** Runs from a click, so it is allowed to show the picker and to prompt. */
  const enableAutosave = async () => {
    try {
      if (!autosave.handle) {
        // The file this page came from, so the dialog opens on it and choosing
        // it is an overwrite rather than a new file sitting beside it.
        const picked = await pickAutosaveTarget(
          globalThis,
          ownFileName || `Project-Command-Center-v${metadata.appVersion}.html`
        );

        // The browser exposes no path, only a name, so a same-named file in
        // another folder is indistinguishable from the tracker being viewed —
        // and the dialog opens wherever it was last used, not where this page
        // lives. A file the picker had to create is empty, which is the one
        // signal that separates "overwrite my tracker" from "start a second
        // copy that silently receives everything from now on".
        if (await isEmptyTarget(picked)) {
          const proceed = globalThis.confirm(
            `"${picked.name}" is a new, empty file.\n\n`
            + 'If you meant to keep saving the tracker you have open, cancel and pick the '
            + 'existing file instead — it lives in the folder this page was opened from, '
            + 'which is not necessarily the folder the dialog started in. A same-named file '
            + 'in another folder looks identical here.\n\n'
            + 'Autosave to the new empty file anyway?'
          );
          if (!proceed) {
            refreshAutosaveControls();
            refreshSaveState();
            return;
          }
        }

        autosave.handle = picked;
        await autosave.store?.save(autosave.handle);
      }
      const permission = await ensureWritePermission(autosave.handle, { interactive: true });
      if (permission !== 'granted') {
        autosave.handle = null;
        await autosave.store?.clear();
        showToast('Autosave needs permission to write that file.');
        refreshAutosaveControls();
        refreshSaveState();
        return;
      }
      autosave.active = true;
      autosave.status = null;
      state.onDirty = () => autosaveScheduler.schedule();
      refreshAutosaveControls();
      // Write once immediately so the file matches what is on screen.
      autosaveScheduler.schedule();
      await autosaveScheduler.flush();
      showToast(`Autosaving to ${autosave.handle.name}.`);
    } catch (error) {
      // AbortError just means the user closed the picker.
      if (error?.name !== 'AbortError') {
        showToast(error?.message || 'Could not turn on autosave.');
      }
      refreshAutosaveControls();
      refreshSaveState();
    }
  };

  const disableAutosave = async () => {
    autosaveScheduler.cancel();
    state.onDirty = null;
    autosave.active = false;
    autosave.handle = null;
    autosave.status = null;
    await autosave.store?.clear();
    refreshAutosaveControls();
    refreshSaveState();
    showToast('Autosave off. Use Save Updated HTML to keep changes.');
  };

  /**
   * Reconnects to the file this tracker was already autosaving to.
   *
   * Permission is not guaranteed to survive a browser restart, so a stored
   * handle whose permission has lapsed does not silently resume — it offers a
   * button, because prompting requires a real click.
   */
  const initAutosave = async () => {
    if (!autosave.supported) {
      refreshAutosaveControls();
      return;
    }
    autosave.store = createHandleStore({ key: autosaveTargetKey(globalThis) });
    refreshAutosaveControls();

    const stored = await autosave.store.load();
    if (!stored) return;

    const permission = await ensureWritePermission(stored, { interactive: false });
    if (permission === 'denied') {
      await autosave.store.clear();
      return;
    }
    autosave.handle = stored;
    if (permission === 'granted') {
      autosave.active = true;
      state.onDirty = () => autosaveScheduler.schedule();
    }
    refreshAutosaveControls();
    refreshSaveState();
  };

  const setView = (view) => {
    state.currentView = view;
    const cards = view === 'cards';
    els.cardView.classList.toggle('hidden', !cards);
    els.tableView.classList.toggle('hidden', cards);
    els.cardViewBtn.classList.toggle('primary', cards);
    els.tableViewBtn.classList.toggle('primary', !cards);
  };

  // ---------------------------------------------------------------- dialogs

  const resetForm = () => {
    state.editingId = null;
    els.dialogTitle.textContent = 'Add Project';
    els.projectName.value = '';
    els.projectCategory.value = '';
    els.projectStatus.value = 'Planning';
    els.projectPriority.value = 'Medium';
    els.projectProgress.value = '0';
    els.progressReadout.textContent = '0%';
    els.projectDeadline.value = '';
    els.projectLink.value = '';
    els.projectNextAction.value = '';
    els.projectTags.value = '';
    els.projectNotes.value = '';
    els.deleteProjectBtn.classList.add('hidden');
  };

  const openAdd = () => {
    resetForm();
    els.projectDialog.showModal();
    setTimeout(() => els.projectName.focus(), 0);
  };

  const openEdit = (id) => {
    const project = getProject(state, id);
    if (!project) return;
    state.editingId = id;
    els.dialogTitle.textContent = 'Edit Project';
    els.projectName.value = project.name;
    els.projectCategory.value = project.category;
    els.projectStatus.value = project.status;
    els.projectPriority.value = project.priority;
    els.projectProgress.value = String(project.progress);
    els.progressReadout.textContent = `${project.progress}%`;
    els.projectDeadline.value = project.deadline;
    els.projectLink.value = project.link;
    els.projectNextAction.value = project.nextAction;
    els.projectTags.value = project.tags.join(', ');
    els.projectNotes.value = project.notes;
    els.deleteProjectBtn.classList.remove('hidden');
    els.projectDialog.showModal();
  };

  const saveProject = () => {
    const name = els.projectName.value.trim();
    if (!name) {
      showToast('Project name is required.');
      els.projectName.focus();
      return;
    }
    const editing = Boolean(state.editingId);
    saveProjectFromForm(state, {
      name,
      category: els.projectCategory.value.trim(),
      status: els.projectStatus.value,
      priority: els.projectPriority.value,
      progress: els.projectProgress.value,
      deadline: els.projectDeadline.value,
      link: els.projectLink.value.trim(),
      nextAction: els.projectNextAction.value.trim(),
      tags: els.projectTags.value.split(',').map(tag => tag.trim()).filter(Boolean),
      notes: els.projectNotes.value.trim()
    });
    els.projectDialog.close();
    draw();
    showToast(editing ? 'Project updated.' : 'Project added.');
  };

  const removeProject = () => {
    if (!state.editingId) return;
    const project = getProject(state, state.editingId);
    if (!project) return;
    const confirmed = confirm(
      `Delete "${project.name}"? This cannot be undone unless you reopen your last saved HTML copy.`
    );
    if (!confirmed) return;
    deleteProject(state, state.editingId);
    els.projectDialog.close();
    draw();
    showToast('Project deleted.');
  };

  const openLightbox = (projectId, itemId) => {
    const { item } = findContentItem(state, projectId, itemId);
    if (!item || item.type !== 'image') return;
    els.lightboxImage.src = item.src;
    els.lightboxImage.alt = item.caption || item.filename || 'Project image';
    els.lightboxCaption.innerHTML = item.caption
      ? linkifyText(item.caption)
      : escapeHtml(item.filename || '');
    els.lightboxDialog.showModal();
  };

  // ------------------------------------------------------------------ media

  const beginImageSelection = (mode, projectId, itemId = null, cap = DEFAULT_IMAGE_LONG_EDGE) => {
    pendingMediaOperation = { mode, projectId, itemId, cap };
    els.mediaFileInput.value = '';
    els.mediaFileInput.click();
  };

  const processSelectedMediaFile = async (file) => {
    const operation = pendingMediaOperation;
    pendingMediaOperation = null;
    if (!operation || !file) return;

    if (file.size > MAX_SOURCE_IMAGE_BYTES) {
      showToast(`Image rejected: ${formatBytes(file.size)} exceeds the 25 MB source limit.`);
      return;
    }
    showToast(shouldWarnAboutSourceSize(file.size)
      ? `Large source (${formatBytes(file.size)}). Optimizing before embedding…`
      : 'Optimizing image…');

    try {
      const optimized = await optimizeImageFile(file, operation.cap);
      const applied = operation.mode === 'add'
        ? addImageItem(state, operation.projectId, optimized)
        : replaceImageItem(state, operation.projectId, operation.itemId, optimized);
      if (!applied) return;
      draw();
      showToast(
        `Image embedded as ${String(optimized.mimeType).replace('image/', '').toUpperCase()} · ${formatBytes(optimized.sizeBytes)}.`
      );
    } catch (error) {
      // A failed encode leaves the project exactly as it was.
      showToast(error?.message || 'Image processing failed.');
    }
  };

  // --------------------------------------------------------------- wiring

  els.addProjectBtn.addEventListener('click', openAdd);
  els.saveProjectBtn.addEventListener('click', saveProject);
  els.deleteProjectBtn.addEventListener('click', removeProject);
  els.cancelProjectBtn.addEventListener('click', () => els.projectDialog.close());
  els.closeDialogBtn.addEventListener('click', () => els.projectDialog.close());
  els.projectProgress.addEventListener('input', () => {
    els.progressReadout.textContent = `${els.projectProgress.value}%`;
  });

  els.searchInput.addEventListener('input', () => {
    state.search = els.searchInput.value;
    draw();
  });
  els.statusFilter.addEventListener('change', () => {
    state.statusFilter = els.statusFilter.value;
    draw();
  });
  els.priorityFilter.addEventListener('change', () => {
    state.priorityFilter = els.priorityFilter.value;
    draw();
  });
  els.sortSelect.addEventListener('change', () => {
    state.sort = els.sortSelect.value;
    draw();
  });

  els.cardViewBtn.addEventListener('click', () => setView('cards'));
  els.tableViewBtn.addEventListener('click', () => setView('table'));
  els.saveHtmlBtn.addEventListener('click', saveUpdatedHtml);
  els.autosaveBtn?.addEventListener('click', enableAutosave);
  els.autosaveOffBtn?.addEventListener('click', disableAutosave);
  els.backupBtn.addEventListener('click', exportJson);
  els.themeBtn.addEventListener('click', () => document.body.classList.toggle('light'));

  document.addEventListener('click', event => {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const { action, projectId, itemId } = actionEl.dataset;

    if (action === 'tag-filter') {
      toggleTagFilter(state, actionEl.dataset.tag);
      draw();
    } else if (action === 'clear-tags') {
      clearTagFilters(state);
      draw();
    } else if (action === 'edit-modal') {
      openEdit(projectId);
    } else if (action === 'duplicate') {
      duplicateProjectById(state, projectId);
      draw();
      showToast('Project duplicated.');
    } else if (action === 'toggle-complete') {
      const result = toggleComplete(state, projectId);
      if (!result) return;
      draw();
      showToast(result.reopening ? 'Project reopened.' : 'Project completed.');
    } else if (action === 'add-link') {
      addLinkItem(state, projectId);
      draw();
    } else if (action === 'add-image') {
      beginImageSelection('add', projectId);
    } else if (action === 'replace-image') {
      beginImageSelection('replace', projectId, itemId);
    } else if (action === 'fit-image') {
      state.openDetailIds.add(projectId);
      updateImageDisplayWidth(state, projectId, itemId, null);
      draw();
    } else if (action === 'original-image') {
      const { item } = findContentItem(state, projectId, itemId);
      if (!item) return;
      state.openDetailIds.add(projectId);
      updateImageDisplayWidth(state, projectId, itemId, item.width);
      draw();
    } else if (action === 'reopt-image') {
      reoptState = { projectId, itemId };
      els.reoptDialog.showModal();
    } else if (action === 'open-image') {
      openLightbox(projectId, itemId);
    } else if (action === 'delete-item') {
      deleteContentItem(state, projectId, itemId);
      draw();
    } else if (action === 'toggle-task') {
      updateContentItem(state, projectId, itemId, { completed: actionEl.checked });
      draw();
    } else if (action === 'add-item') {
      const card = actionEl.closest('.project-card');
      const input = card && card.querySelector('[data-new-item-input]');
      if (input && addContentItem(state, projectId, actionEl.dataset.type, input.value)) {
        input.value = '';
        draw();
      } else if (input) {
        showToast('Type an item first.');
        input.focus();
      }
    }
  });

  // Typing updates the model without re-rendering, so focus and caret survive.
  document.addEventListener('input', event => {
    const { inlineField, inlineItem, projectId, itemId } = event.target.dataset;
    if (inlineField && ['name', 'category', 'nextAction', 'notes', 'link'].includes(inlineField)) {
      updateProjectField(state, projectId, inlineField, event.target.value);
      refreshSaveState();
    }
    if (inlineItem && ['text', 'label', 'url', 'caption'].includes(inlineItem)) {
      updateContentItem(state, projectId, itemId, { [inlineItem]: event.target.value });
      refreshSaveState();
    }
  });

  // Committing a field re-renders, so derived views catch up.
  document.addEventListener('change', event => {
    const { inlineField, inlineItem, projectId, itemId } = event.target.dataset;
    if (inlineField && ['status', 'priority', 'progress', 'deadline', 'tags'].includes(inlineField)) {
      updateProjectField(state, projectId, inlineField, event.target.value);
      draw();
    } else if (inlineField && ['notes', 'link'].includes(inlineField)) {
      draw();
    }
    if (inlineItem && ['text', 'label', 'url', 'caption'].includes(inlineItem)) {
      updateContentItem(state, projectId, itemId, { [inlineItem]: event.target.value });
      draw();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.target.matches('[data-new-item-input]') && event.key === 'Enter') {
      event.preventDefault();
      if (addContentItem(state, event.target.dataset.projectId, 'task', event.target.value)) {
        event.target.value = '';
        draw();
      } else {
        showToast('Type an item first.');
      }
    }
    if (event.target === els.projectName && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      saveProject();
    }
  });

  els.mediaFileInput.addEventListener('change', event => {
    processSelectedMediaFile(event.target.files && event.target.files[0]);
  });

  els.closeLightboxBtn.addEventListener('click', () => els.lightboxDialog.close());
  els.lightboxDialog.addEventListener('click', event => {
    if (event.target === els.lightboxDialog) els.lightboxDialog.close();
  });
  els.closeReoptBtn.addEventListener('click', () => els.reoptDialog.close());
  els.cancelReoptBtn.addEventListener('click', () => els.reoptDialog.close());
  els.chooseReoptSourceBtn.addEventListener('click', () => {
    if (!reoptState) return;
    const cap = els.reoptCap.value === 'source' ? 'source' : Number(els.reoptCap.value);
    const { projectId, itemId } = reoptState;
    reoptState = null;
    els.reoptDialog.close();
    beginImageSelection('reopt', projectId, itemId, cap);
  });

  document.addEventListener('toggle', event => {
    const details = event.target.closest && event.target.closest('[data-project-details]');
    if (!details) return;
    if (details.open) state.openDetailIds.add(details.dataset.projectDetails);
    else state.openDetailIds.delete(details.dataset.projectDetails);
  }, true);

  document.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-resize-handle]');
    if (!handle) return;
    event.preventDefault();
    event.stopPropagation();
    const frame = handle.closest('.image-frame');
    if (!frame) return;
    activeResize = {
      projectId: handle.dataset.projectId,
      itemId: handle.dataset.itemId,
      frame,
      startX: event.clientX,
      startWidth: frame.getBoundingClientRect().width,
      maxWidth: Math.max(120, (frame.parentElement && frame.parentElement.clientWidth)
        || frame.getBoundingClientRect().width)
    };
    if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
  });

  document.addEventListener('pointermove', event => {
    if (!activeResize) return;
    const width = clamp(
      activeResize.startWidth + (event.clientX - activeResize.startX),
      120,
      activeResize.maxWidth
    );
    activeResize.frame.style.width = `${Math.round(width)}px`;
  });

  document.addEventListener('pointerup', () => {
    if (!activeResize) return;
    // Resizing only ever writes displayWidth. The encoded source is untouched.
    updateImageDisplayWidth(
      state,
      activeResize.projectId,
      activeResize.itemId,
      activeResize.frame.getBoundingClientRect().width
    );
    activeResize = null;
    refreshSaveState();
  });

  window.addEventListener('beforeunload', event => {
    // Best effort: start the pending write now rather than after the debounce.
    // beforeunload cannot await it, which is exactly why the warning below
    // still fires while a write is outstanding.
    if (autosave.active && autosaveScheduler.isPending()) autosaveScheduler.flush();
    if (!state.dirty && !autosaveScheduler.isPending()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  // Populate the filter dropdowns from the single source of truth.
  for (const status of PROJECT_STATUSES) {
    if (![...els.statusFilter.options].some(option => option.value === status)) {
      els.statusFilter.add(new Option(status, status));
    }
  }
  for (const priority of PROJECT_PRIORITIES) {
    if (![...els.priorityFilter.options].some(option => option.value === priority)) {
      els.priorityFilter.add(new Option(priority, priority));
    }
  }

  draw();
  setView(state.currentView);

  // Never awaited: reconnecting to a stored handle must not delay the tracker,
  // and a storage backend that never answers is time-boxed inside the store.
  initAutosave();

  // The tracker is fully rendered and interactive before the updater is even
  // constructed, and the check that follows is never awaited. A slow, blocked,
  // or failing network cannot delay access to project data.
  const updates = initUpdateUi({
    state,
    appMetadata: metadata,
    document,
    showToast,
    downloadBlob,
    refreshSaveState,
    isAutosaveActive: () => autosave.active,
    flushAutosave: () => autosaveScheduler.flush(),
    redraw: draw
  });
  updates.startAutomaticCheck();

  return { state, els, metadata, draw, showToast, updates };
}

if (typeof document !== 'undefined' && !globalThis.__PCC_TEST__) {
  boot();
}
