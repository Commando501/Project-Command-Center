import { normalizeContentItems } from '../content/content-items.js';
import { clamp, cloneJson, makeId } from './util.js';

export const PROJECT_STATUSES = Object.freeze([
  'Planning', 'Active', 'Blocked', 'On Hold', 'Complete'
]);
export const PROJECT_PRIORITIES = Object.freeze(['High', 'Medium', 'Low']);

export const MAX_BASE_PROGRESS = 99;

/**
 * Normalizes a project into the exact v3 field set.
 *
 * NOTE: unknown top-level fields are dropped. That is why `migrateSchema3To4`
 * must not call this function — a migration is required to preserve unrelated
 * fields, and normalization deliberately does not.
 */
export function normalizeProject(project, nowIso = new Date().toISOString()) {
  const source = project || {};
  const status = PROJECT_STATUSES.includes(source.status) ? source.status : 'Planning';

  return {
    id: source.id || makeId(),
    name: String(source.name || 'Untitled Project'),
    category: String(source.category || ''),
    status,
    priority: PROJECT_PRIORITIES.includes(source.priority) ? source.priority : 'Medium',
    progress: clamp(Math.trunc(Number(source.progress) || 0), 0, MAX_BASE_PROGRESS),
    deadline: String(source.deadline || ''),
    link: String(source.link || ''),
    nextAction: String(source.nextAction || ''),
    tags: Array.isArray(source.tags)
      ? source.tags.map(String).map(tag => tag.trim()).filter(Boolean)
      : [],
    notes: String(source.notes || ''),
    contentItems: normalizeContentItems(source.contentItems),
    createdAt: source.createdAt || nowIso,
    updatedAt: source.updatedAt || nowIso
  };
}

/**
 * Applies one inline field edit. Mutates `project` and reports whether the
 * field was recognised, so the caller can decide about dirty state.
 */
export function applyProjectFieldUpdate(project, field, rawValue) {
  if (!project) return false;

  switch (field) {
    case 'name':
      // An empty name reverts to the previous one rather than blanking a card.
      project.name = String(rawValue).trimStart().slice(0, 140) || project.name;
      return true;
    case 'category':
      project.category = String(rawValue).slice(0, 80);
      return true;
    case 'nextAction':
      project.nextAction = String(rawValue).slice(0, 240);
      return true;
    case 'notes':
      project.notes = String(rawValue);
      return true;
    case 'link':
      project.link = String(rawValue).slice(0, 1000);
      return true;
    case 'deadline':
      project.deadline = String(rawValue || '');
      return true;
    case 'status':
      if (!PROJECT_STATUSES.includes(rawValue)) return false;
      project.status = rawValue;
      return true;
    case 'priority':
      if (!PROJECT_PRIORITIES.includes(rawValue)) return false;
      project.priority = rawValue;
      return true;
    case 'progress':
      project.progress = clamp(Math.trunc(Number(rawValue) || 0), 0, MAX_BASE_PROGRESS);
      return true;
    case 'tags':
      project.tags = String(rawValue).split(',').map(tag => tag.trim()).filter(Boolean);
      return true;
    default:
      return false;
  }
}

export function duplicateProject(project, nowIso = new Date().toISOString()) {
  const clone = cloneJson(project);
  clone.id = makeId();
  clone.name = `${project.name} (Copy)`;
  clone.createdAt = nowIso;
  clone.updatedAt = nowIso;
  clone.contentItems = (clone.contentItems || []).map(item => ({ ...item, id: makeId() }));
  return normalizeProject(clone, nowIso);
}

/** Reopening a completed project always lands on Active, as in v3. */
export function nextCompletionStatus(status) {
  return status === 'Complete' ? 'Active' : 'Complete';
}
