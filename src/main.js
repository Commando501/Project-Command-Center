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
  buildProjectsJsonBackup,
  injectDataCapsuleIntoShell
} from './persistence/standalone-export.js';
import { readAppMetadata } from './updater/app-metadata.js';

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
    'closeLightboxBtn', 'closeReoptBtn', 'cancelReoptBtn', 'chooseReoptSourceBtn'
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

  const refreshSaveState = () => {
    els.unsavedDot.classList.toggle('show', state.dirty);
    els.saveStateText.textContent = state.dirty
      ? 'You have unsaved changes.'
      : 'All embedded data is current.';
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
      const html = injectDataCapsuleIntoShell(getCapturedShell(), toDataCapsule(state));
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
    if (!state.dirty) return;
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

  return { state, els, metadata, draw, showToast };
}

if (typeof document !== 'undefined' && !globalThis.__PCC_TEST__) {
  boot();
}
