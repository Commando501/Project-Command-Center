import {
  escapeHtml,
  formatBytes,
  formatDate,
  formatUpdated,
  linkifyText,
  safeUrl
} from './format.js';
import { computeProgress, formatProgress, taskStats } from './progress.js';
import { PROJECT_PRIORITIES, PROJECT_STATUSES } from './project-model.js';
import { projectEmbeddedImageBytes, projectImageBytes } from '../content/content-items.js';
import { displayTagForKey, statusCounts, visibleProjects } from './state.js';
import { clamp } from './util.js';

/**
 * All markup is built as escaped strings, exactly as in v3. Every user-supplied
 * value passes through escapeHtml, and every href through safeUrl, so nothing
 * a user types can become active markup.
 */

const statusClass = (status) => 'status-' + String(status).toLowerCase().replaceAll(' ', '-');
const priorityClass = (priority) => 'priority-' + String(priority).toLowerCase();

function renderTextLinkPreview(text) {
  return /https?:\/\//i.test(String(text || ''))
    ? `<div class="linked-preview">${linkifyText(text)}</div>`
    : '';
}

export function renderContentItem(project, item) {
  const projectId = escapeHtml(project.id);
  const itemId = escapeHtml(item.id);

  if (item.type === 'link') {
    const href = safeUrl(item.url);
    return `<div class="content-link" data-item-id="${itemId}">
      <input class="inline-control link-label" type="text" value="${escapeHtml(item.label)}" data-inline-item="label" data-project-id="${projectId}" data-item-id="${itemId}" placeholder="Link label" aria-label="Link label">
      <input class="inline-control link-url" type="url" value="${escapeHtml(item.url)}" data-inline-item="url" data-project-id="${projectId}" data-item-id="${itemId}" placeholder="https://..." aria-label="Link URL">
      ${href ? `<a class="btn small" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Open</a>` : '<span class="task-summary">Invalid/empty URL</span>'}
      <button class="btn icon danger" type="button" data-action="delete-item" data-project-id="${projectId}" data-item-id="${itemId}" aria-label="Delete link">×</button>
    </div>`;
  }

  if (item.type === 'image') {
    const widthStyle = item.displayWidth
      ? `width:${Math.max(120, item.displayWidth)}px;`
      : 'width:100%;';
    const metaDimensions = item.width && item.height
      ? `${item.width} × ${item.height}`
      : 'Unknown dimensions';

    return `<div class="content-image-block" data-item-id="${itemId}">
      <div class="image-frame" style="${widthStyle}">
        <img class="embedded-image" src="${escapeHtml(item.src)}" alt="${escapeHtml(item.caption || item.filename || 'Project image')}" data-action="open-image" data-project-id="${projectId}" data-item-id="${itemId}" draggable="false">
        <button class="resize-handle" type="button" data-resize-handle data-project-id="${projectId}" data-item-id="${itemId}" aria-label="Drag to resize image" title="Drag to resize">↘</button>
      </div>
      <input class="inline-control image-caption" type="text" value="${escapeHtml(item.caption)}" data-inline-item="caption" data-project-id="${projectId}" data-item-id="${itemId}" maxlength="300" placeholder="Optional image caption" aria-label="Image caption">
      ${renderTextLinkPreview(item.caption)}
      <div class="image-meta"><span>${escapeHtml((item.mimeType || 'image').replace('image/', '').toUpperCase())}</span><span>${escapeHtml(metaDimensions)}</span><span>${formatBytes(item.sizeBytes)}</span><span>${escapeHtml(item.filename || 'image')}</span></div>
      <div class="image-controls">
        <button class="btn small" type="button" data-action="fit-image" data-project-id="${projectId}" data-item-id="${itemId}">Fit width</button>
        <button class="btn small" type="button" data-action="original-image" data-project-id="${projectId}" data-item-id="${itemId}">Original size</button>
        <button class="btn small" type="button" data-action="reopt-image" data-project-id="${projectId}" data-item-id="${itemId}">Re-optimize larger</button>
        <button class="btn small" type="button" data-action="replace-image" data-project-id="${projectId}" data-item-id="${itemId}">Replace</button>
        <button class="btn small danger" type="button" data-action="delete-item" data-project-id="${projectId}" data-item-id="${itemId}">Remove</button>
      </div>
    </div>`;
  }

  const isTask = item.type === 'task';
  return `<div class="nested-item ${isTask && item.completed ? 'completed' : ''}" data-item-id="${itemId}">
    ${isTask
      ? `<input class="nested-check" type="checkbox" ${item.completed ? 'checked' : ''} data-action="toggle-task" data-project-id="${projectId}" data-item-id="${itemId}" aria-label="Toggle task">`
      : '<span class="nested-marker">•</span>'}
    <div>
      <input class="inline-control nested-text" type="text" value="${escapeHtml(item.text)}" data-inline-item="text" data-project-id="${projectId}" data-item-id="${itemId}" aria-label="${isTask ? 'Task' : 'Bullet'} text">
      ${renderTextLinkPreview(item.text)}
    </div>
    <button class="btn icon danger" type="button" data-action="delete-item" data-project-id="${projectId}" data-item-id="${itemId}" aria-label="Delete item">×</button>
  </div>`;
}

export function renderProjectCard(state, project) {
  const id = escapeHtml(project.id);
  const url = safeUrl(project.link);
  const progress = computeProgress(project);
  const stats = taskStats(project);
  const taskSummary = stats.total ? `${stats.completed} / ${stats.total} tasks` : 'No tracked tasks';
  const items = project.contentItems || [];
  const nestedHtml = items.length
    ? items.map(item => renderContentItem(project, item)).join('')
    : '<div class="nested-empty">No nested content yet. Add a task, bullet, link, or image below.</div>';

  return `
    <article class="project-card" data-project-id="${id}">
      <div class="card-head">
        <div>
          <input class="inline-control inline-name" data-inline-field="name" data-project-id="${id}" value="${escapeHtml(project.name)}" maxlength="140" aria-label="Project name">
          <input class="inline-control inline-category" data-inline-field="category" data-project-id="${id}" value="${escapeHtml(project.category)}" maxlength="80" placeholder="Uncategorized" aria-label="Category">
        </div>
        <button class="btn small" data-action="edit-modal" data-project-id="${id}" type="button">Full Edit</button>
      </div>

      <div class="quick-controls">
        <div class="compact-field"><label>Status</label><select class="compact-select" data-inline-field="status" data-project-id="${id}">${PROJECT_STATUSES.map(value => `<option ${project.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
        <div class="compact-field"><label>Priority</label><select class="compact-select" data-inline-field="priority" data-project-id="${id}">${PROJECT_PRIORITIES.map(value => `<option ${project.priority === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
      </div>

      <div class="badges">
        <span class="badge ${statusClass(project.status)}">${escapeHtml(project.status)}</span>
        <span class="badge ${priorityClass(project.priority)}">${escapeHtml(project.priority)} priority</span>
        <span class="badge">${escapeHtml(taskSummary)}</span>
      </div>

      <div class="progress-row">
        <div class="progress-label">
          <div class="base-progress-edit"><span>Base</span><input class="inline-control inline-number" data-inline-field="progress" data-project-id="${id}" type="number" min="0" max="99" step="1" value="${project.progress}" ${project.status === 'Complete' ? 'disabled' : ''}><span>%</span></div>
          <strong class="progress-value">${formatProgress(project)}</strong>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${clamp(progress, 0, 100)}%"></div></div>
      </div>

      <div class="next-action">
        <strong>NEXT ACTION</strong>
        <input class="inline-control inline-next" data-inline-field="nextAction" data-project-id="${id}" value="${escapeHtml(project.nextAction)}" maxlength="240" placeholder="Add the next action..." aria-label="Next action">
      </div>

      <div class="meta">
        <div class="meta-row"><span>Deadline</span><input class="inline-control inline-date" data-inline-field="deadline" data-project-id="${id}" type="date" value="${escapeHtml(project.deadline)}"></div>
        <div class="meta-row"><span>Updated</span><span>${formatUpdated(project.updatedAt)}</span></div>
      </div>

      <div class="tags">${project.tags.length ? project.tags.map(tag => `<button class="tag ${state.activeTagFilters.has(tag.toLowerCase()) ? 'active' : ''}" type="button" data-action="tag-filter" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('') : '<span class="task-summary">No tags</span>'}</div>
      <input class="inline-control inline-tags-input" data-inline-field="tags" data-project-id="${id}" value="${escapeHtml(project.tags.join(', '))}" placeholder="Edit tags: hardware, research, urgent" aria-label="Edit tags">

      <details class="project-details" data-project-details="${id}" ${state.openDetailIds.has(project.id) ? 'open' : ''}>
        <summary><span>Notes &amp; nested content</span><span class="task-summary">${escapeHtml(taskSummary)}</span></summary>
        <div class="details-body">
          <div>
            <div class="section-label">Notes</div>
            <textarea class="control inline-notes" data-inline-field="notes" data-project-id="${id}" placeholder="Key details, blockers, decisions, links, ideas...">${escapeHtml(project.notes)}</textarea>
            ${renderTextLinkPreview(project.notes)}
          </div>
          <div>
            <div class="section-label">Primary link</div>
            <input class="control" data-inline-field="link" data-project-id="${id}" type="url" value="${escapeHtml(project.link)}" placeholder="https://...">
          </div>
          <div>
            <div class="section-label">Mixed project content</div>
            <div class="storage-summary"><span>Image storage</span><strong>${formatBytes(projectImageBytes(project))} compressed · ~${formatBytes(projectEmbeddedImageBytes(project))} in HTML</strong></div>
            <div class="nested-list">${nestedHtml}</div>
          </div>
          <div class="add-nested">
            <input class="control" data-new-item-input data-project-id="${id}" type="text" maxlength="240" placeholder="Add a task or bullet...">
            <button class="btn small" type="button" data-action="add-item" data-type="task" data-project-id="${id}">+ Task</button>
            <button class="btn small" type="button" data-action="add-item" data-type="bullet" data-project-id="${id}">+ Bullet</button>
            <button class="btn small" type="button" data-action="add-link" data-project-id="${id}">+ Link</button>
            <button class="btn small" type="button" data-action="add-image" data-project-id="${id}">+ Image</button>
          </div>
        </div>
      </details>

      <div class="card-actions">
        ${url ? `<a class="btn small" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open Link</a>` : ''}
        <button class="btn small" data-action="duplicate" data-project-id="${id}" type="button">Duplicate</button>
        <button class="btn small" data-action="toggle-complete" data-project-id="${id}" type="button">${project.status === 'Complete' ? 'Reopen' : 'Complete'}</button>
      </div>
    </article>`;
}

export function renderCardsHtml(state, list) {
  if (!list.length) {
    const hasProjects = state.projects.length > 0;
    return `<div class="empty"><h2>${hasProjects ? 'No projects match these filters.' : 'No projects yet.'}</h2><div>${hasProjects ? 'Try changing your search or filters.' : 'Click “Add Project” to create your first project.'}</div></div>`;
  }
  return list.map(project => renderProjectCard(state, project)).join('');
}

export function renderTableHtml(state, list) {
  if (!list.length) {
    return `<tr><td colspan="9">${state.projects.length ? 'No projects match these filters.' : 'No projects yet.'}</td></tr>`;
  }
  return list.map(project => `
    <tr>
      <td><strong>${escapeHtml(project.name)}</strong><br><span style="color:var(--muted)">${escapeHtml(project.category || 'Uncategorized')}</span></td>
      <td>${escapeHtml(project.status)}</td><td>${escapeHtml(project.priority)}</td><td>${formatProgress(project)}</td>
      <td>${escapeHtml(project.nextAction || '—')}</td>
      <td><div class="table-tags">${project.tags.map(tag => `<button class="tag ${state.activeTagFilters.has(tag.toLowerCase()) ? 'active' : ''}" type="button" data-action="tag-filter" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('') || '—'}</div></td>
      <td>${formatDate(project.deadline)}</td><td>${formatUpdated(project.updatedAt)}</td>
      <td><button class="btn small" data-action="edit-modal" data-project-id="${escapeHtml(project.id)}" type="button">Edit</button></td>
    </tr>`).join('');
}

export function renderActiveTagFiltersHtml(state) {
  if (!state.activeTagFilters.size) return '';
  return '<span class="active-tag-label">Filtering tags (all required):</span>'
    + Array.from(state.activeTagFilters).map(key => {
      const label = escapeHtml(displayTagForKey(state, key));
      return `<button class="tag tag-filter-chip active" type="button" data-action="tag-filter" data-tag="${label}">${label} ×</button>`;
    }).join('')
    + '<button class="btn small ghost" type="button" data-action="clear-tags">Clear tags</button>';
}

/** Writes the whole view. Called after every state mutation, as in v3. */
export function render(state, els) {
  const counts = statusCounts(state);
  els.metricTotal.textContent = counts.total;
  els.metricActive.textContent = counts.active;
  els.metricPlanning.textContent = counts.planning;
  els.metricBlocked.textContent = counts.blocked;
  els.metricComplete.textContent = counts.complete;

  const tagBarHtml = renderActiveTagFiltersHtml(state);
  els.activeTagBar.classList.toggle('hidden', !tagBarHtml);
  els.activeTagBar.innerHTML = tagBarHtml;

  const visible = visibleProjects(state);
  els.cardView.innerHTML = renderCardsHtml(state, visible);
  els.projectTableBody.innerHTML = renderTableHtml(state, visible);
}
