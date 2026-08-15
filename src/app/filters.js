import { computeProgress } from './progress.js';

const PRIORITY_WEIGHT = { High: 3, Medium: 2, Low: 1 };

export const SORT_KEYS = Object.freeze([
  'updated-desc', 'name-asc', 'priority-desc', 'progress-desc', 'deadline-asc'
]);

/** Nested content contributes to search, so a buried task is findable. */
export function contentItemSearchText(item) {
  if (!item) return '';
  if (item.type === 'link') return `${item.label || ''} ${item.url || ''}`;
  if (item.type === 'image') {
    return `${item.caption || ''} ${item.filename || ''} ${item.mimeType || ''}`;
  }
  return String(item.text || '');
}

export function projectSearchHaystack(project) {
  const nested = (project.contentItems || []).map(contentItemSearchText).join(' ');
  return [
    project.name,
    project.category,
    project.status,
    project.priority,
    project.nextAction,
    project.notes,
    (project.tags || []).join(' '),
    nested
  ].join(' ').toLowerCase();
}

/** Active tag filters are ANDed: a project must carry every selected tag. */
export function projectMatchesActiveTags(project, activeTags) {
  const required = Array.from(activeTags || []).map(tag => String(tag).toLowerCase());
  if (!required.length) return true;
  const projectTags = new Set((project.tags || []).map(tag => String(tag).toLowerCase()));
  return required.every(tag => projectTags.has(tag));
}

export function filterProjects(projects, { query = '', status = '', priority = '', activeTags = null } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  return projects.filter(project =>
    (!needle || projectSearchHaystack(project).includes(needle))
    && (!status || project.status === status)
    && (!priority || project.priority === priority)
    && projectMatchesActiveTags(project, activeTags));
}

/** Returns a new array; the input order is never disturbed. */
export function sortProjects(projects, sortKey = 'updated-desc') {
  return [...projects].sort((a, b) => {
    switch (sortKey) {
      case 'name-asc':
        return a.name.localeCompare(b.name);
      case 'priority-desc':
        return (PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority])
          || (new Date(b.updatedAt) - new Date(a.updatedAt));
      case 'progress-desc':
        return (computeProgress(b) - computeProgress(a)) || a.name.localeCompare(b.name);
      case 'deadline-asc': {
        const aTime = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      }
      default:
        return new Date(b.updatedAt) - new Date(a.updatedAt);
    }
  });
}

export function selectProjects(projects, criteria = {}) {
  return sortProjects(filterProjects(projects, criteria), criteria.sort);
}
