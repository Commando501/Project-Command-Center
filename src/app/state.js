import { createDefaultPreferences, normalizeDataCapsule } from '../persistence/data-capsule.js';
import {
  applyContentItemUpdate,
  createLinkItem,
  createTextItem,
  normalizeContentItem,
  setImageDisplayWidth
} from '../content/content-items.js';
import {
  applyProjectFieldUpdate,
  duplicateProject,
  nextCompletionStatus,
  normalizeProject
} from './project-model.js';
import { selectProjects } from './filters.js';
import { cloneJson, clamp, makeId } from './util.js';

/**
 * In-memory application state.
 *
 * There is no browser storage of any kind: everything lives here until the
 * user generates a new HTML file. That is the persistence architecture, and it
 * is why preference changes mark the document dirty exactly like project edits.
 */
export function createAppState(capsule, nowIso = () => new Date().toISOString()) {
  const normalized = normalizeDataCapsule(capsule);
  return {
    now: nowIso,
    projects: normalized.projects.map(project => normalizeProject(project, nowIso())),
    preferences: { ...createDefaultPreferences(), ...normalized.preferences },
    schemaVersion: normalized.schemaVersion,
    editingId: null,
    currentView: 'cards',
    dirty: false,
    search: '',
    statusFilter: '',
    priorityFilter: '',
    sort: 'updated-desc',
    activeTagFilters: new Set(),
    openDetailIds: new Set(),
    // Session-only. Deliberately NOT stored in preferences: writing a check
    // timestamp into the capsule would mark the document dirty on every open
    // and prompt an unsaved-changes warning the user never caused.
    lastUpdateCheckAt: null,
    lastUpdateCheckStatus: null
  };
}

export function markDirty(state) {
  state.dirty = true;
}

export function markSaved(state) {
  state.dirty = false;
}

export function getProject(state, id) {
  return state.projects.find(project => project.id === id);
}

export function touchProject(state, project) {
  project.updatedAt = state.now();
  markDirty(state);
}

export function visibleProjects(state) {
  return selectProjects(state.projects, {
    query: state.search,
    status: state.statusFilter,
    priority: state.priorityFilter,
    activeTags: state.activeTagFilters,
    sort: state.sort
  });
}

export function statusCounts(state) {
  const count = status => state.projects.filter(project => project.status === status).length;
  return {
    total: state.projects.length,
    active: count('Active'),
    planning: count('Planning'),
    blocked: count('Blocked'),
    complete: count('Complete')
  };
}

export function updateProjectField(state, id, field, rawValue) {
  const project = getProject(state, id);
  if (!project) return false;
  if (!applyProjectFieldUpdate(project, field, rawValue)) return false;
  touchProject(state, project);
  return true;
}

export function toggleTagFilter(state, tag) {
  const key = String(tag || '').trim().toLowerCase();
  if (!key) return false;
  if (state.activeTagFilters.has(key)) state.activeTagFilters.delete(key);
  else state.activeTagFilters.add(key);
  return true;
}

export function clearTagFilters(state) {
  state.activeTagFilters.clear();
}

/** Finds the display casing of a tag from the projects that carry it. */
export function displayTagForKey(state, key) {
  for (const project of state.projects) {
    const match = (project.tags || []).find(tag => tag.toLowerCase() === key);
    if (match) return match;
  }
  return key;
}

export function addContentItem(state, projectId, type, text) {
  const project = getProject(state, projectId);
  const clean = String(text || '').trim();
  if (!project || !clean || !['task', 'bullet'].includes(type)) return false;
  project.contentItems.push(createTextItem(type, clean));
  touchProject(state, project);
  return true;
}

export function addLinkItem(state, projectId) {
  const project = getProject(state, projectId);
  if (!project) return false;
  state.openDetailIds.add(projectId);
  project.contentItems.push(createLinkItem());
  touchProject(state, project);
  return true;
}

export function findContentItem(state, projectId, itemId) {
  const project = getProject(state, projectId);
  if (!project) return { project: null, item: null };
  return {
    project,
    item: (project.contentItems || []).find(entry => entry.id === itemId) || null
  };
}

export function updateContentItem(state, projectId, itemId, changes) {
  const { project, item } = findContentItem(state, projectId, itemId);
  if (!project || !item) return false;
  if (!applyContentItemUpdate(item, changes)) return false;
  touchProject(state, project);
  return true;
}

export function deleteContentItem(state, projectId, itemId) {
  const project = getProject(state, projectId);
  if (!project) return false;
  const before = project.contentItems.length;
  project.contentItems = project.contentItems.filter(item => item.id !== itemId);
  if (project.contentItems.length === before) return false;
  touchProject(state, project);
  return true;
}

/** Display resizing only. Never touches the encoded image source. */
export function updateImageDisplayWidth(state, projectId, itemId, width) {
  const { project, item } = findContentItem(state, projectId, itemId);
  if (!project || !item || !setImageDisplayWidth(item, width)) return false;
  touchProject(state, project);
  return true;
}

export function replaceImageItem(state, projectId, itemId, fields) {
  const { project, item } = findContentItem(state, projectId, itemId);
  if (!project || !item || item.type !== 'image') return false;
  // Caption and display size belong to the user, not to the encode result.
  const { caption, displayWidth } = item;
  Object.assign(item, normalizeContentItem({
    id: item.id, ...fields, caption, displayWidth
  }));
  touchProject(state, project);
  return true;
}

export function addImageItem(state, projectId, fields) {
  const project = getProject(state, projectId);
  if (!project) return false;
  state.openDetailIds.add(projectId);
  project.contentItems.push(normalizeContentItem({
    id: makeId(), ...fields, caption: '', displayWidth: null
  }));
  touchProject(state, project);
  return true;
}

export function saveProjectFromForm(state, data) {
  const now = state.now();
  const payload = {
    ...data,
    progress: clamp(Math.trunc(Number(data.progress) || 0), 0, 99),
    updatedAt: now
  };

  if (state.editingId) {
    const index = state.projects.findIndex(project => project.id === state.editingId);
    if (index !== -1) {
      state.projects[index] = normalizeProject({
        ...state.projects[index],
        ...payload,
        contentItems: state.projects[index].contentItems
      }, now);
    }
  } else {
    state.projects.push(normalizeProject({
      id: makeId(), createdAt: now, contentItems: [], ...payload
    }, now));
  }
  markDirty(state);
  return true;
}

export function deleteProject(state, id) {
  const before = state.projects.length;
  state.projects = state.projects.filter(project => project.id !== id);
  if (state.projects.length === before) return false;
  markDirty(state);
  return true;
}

export function duplicateProjectById(state, id) {
  const project = getProject(state, id);
  if (!project) return false;
  state.projects.push(duplicateProject(project, state.now()));
  markDirty(state);
  return true;
}

export function toggleComplete(state, id) {
  const project = getProject(state, id);
  if (!project) return null;
  const reopening = project.status === 'Complete';
  project.status = nextCompletionStatus(project.status);
  project.progress = clamp(Math.trunc(Number(project.progress) || 0), 0, 99);
  touchProject(state, project);
  return { reopening };
}

export function setPreference(state, key, value) {
  if (!Object.hasOwn(state.preferences, key)) return false;
  if (state.preferences[key] === value) return false;
  state.preferences[key] = value;
  // A preference lives in the capsule, so changing one is an unsaved change.
  markDirty(state);
  return true;
}

/** The capsule as it would be written into a new HTML file. */
export function toDataCapsule(state) {
  return cloneJson({
    schemaVersion: state.schemaVersion,
    projects: state.projects,
    preferences: state.preferences
  });
}
