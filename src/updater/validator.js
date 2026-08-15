import { CURRENT_SCHEMA_VERSION, UPDATE_CHANNELS } from '../persistence/data-capsule.js';
import { CONTENT_ITEM_TYPES, isEmbeddedImageSrc } from '../content/content-items.js';
import { PROJECT_PRIORITIES, PROJECT_STATUSES } from '../app/project-model.js';
import { safeUrl } from '../app/format.js';

/**
 * Validates a migrated Data Capsule before it is injected into a new shell.
 *
 * ERRORS abort the update. WARNINGS do not.
 *
 * The split matters. v3 stores whatever the user typed into a link URL and
 * refuses to activate it only at render time, so a half-typed "htp://..." is
 * ordinary data that v3 accepted happily. Treating that as fatal would refuse
 * to upgrade a perfectly normal file, and would do it with a security-flavoured
 * error message. The render-time check in safeUrl is the actual security
 * boundary and it is unaffected by anything stored here.
 *
 * An error is therefore reserved for data that would break the artifact or
 * violate a locked invariant:
 *
 *   - the capsule cannot be read or is the wrong schema
 *   - a project has no identity, so edits would go to the wrong record
 *   - an image points at a REMOTE url, which would break self-containment
 *
 * Everything the application already normalizes on load is a warning.
 */

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function validateDataCapsule(capsule, { targetSchema = CURRENT_SCHEMA_VERSION } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (path, message) => errors.push(`${path}: ${message}`);
  const warn = (path, message) => warnings.push(`${path}: ${message}`);

  if (!isPlainObject(capsule)) {
    return { valid: false, errors: ['capsule: expected an object.'], warnings };
  }

  if (capsule.schemaVersion !== targetSchema) {
    fail('capsule.schemaVersion', `expected ${targetSchema}, received ${JSON.stringify(capsule.schemaVersion)}.`);
  }

  if (capsule.preferences !== undefined && !isPlainObject(capsule.preferences)) {
    fail('capsule.preferences', 'expected an object.');
  } else if (isPlainObject(capsule.preferences)) {
    const channel = capsule.preferences.updateChannel;
    if (channel !== undefined && !UPDATE_CHANNELS.includes(channel)) {
      warn('capsule.preferences.updateChannel', `unrecognised channel ${JSON.stringify(channel)}; the stable channel will be used.`);
    }
  }

  if (!Array.isArray(capsule.projects)) {
    fail('capsule.projects', 'expected an array.');
    return { valid: errors.length === 0, errors, warnings };
  }

  const seenIds = new Set();

  capsule.projects.forEach((project, index) => {
    const path = `projects[${index}]`;

    if (!isPlainObject(project)) {
      fail(path, 'expected an object.');
      return;
    }

    const id = project.id;
    if (typeof id !== 'string' || !id.trim()) {
      fail(`${path}.id`, 'a project must have a non-empty id.');
    } else if (seenIds.has(id)) {
      warn(`${path}.id`, `duplicate project id ${JSON.stringify(id)}.`);
    } else {
      seenIds.add(id);
    }

    if (project.status !== undefined && !PROJECT_STATUSES.includes(project.status)) {
      warn(`${path}.status`, `unrecognised status ${JSON.stringify(project.status)}; Planning will be used.`);
    }
    if (project.priority !== undefined && !PROJECT_PRIORITIES.includes(project.priority)) {
      warn(`${path}.priority`, `unrecognised priority ${JSON.stringify(project.priority)}; Medium will be used.`);
    }
    if (project.progress !== undefined) {
      const progress = Number(project.progress);
      if (!Number.isFinite(progress) || progress < 0 || progress > 99) {
        warn(`${path}.progress`, `base progress ${JSON.stringify(project.progress)} is outside 0..99 and will be clamped.`);
      }
    }
    if (project.tags !== undefined && !Array.isArray(project.tags)) {
      warn(`${path}.tags`, 'expected an array; tags will be dropped.');
    }
    if (project.link && !safeUrl(project.link)) {
      warn(`${path}.link`, 'is not an http(s) url and will not be clickable.');
    }

    if (project.contentItems === undefined) return;
    if (!Array.isArray(project.contentItems)) {
      fail(`${path}.contentItems`, 'expected an array.');
      return;
    }

    project.contentItems.forEach((item, itemIndex) => {
      const itemPath = `${path}.contentItems[${itemIndex}]`;

      if (!isPlainObject(item)) {
        fail(itemPath, 'expected an object.');
        return;
      }
      if (typeof item.id !== 'string' || !item.id.trim()) {
        warn(`${itemPath}.id`, 'missing id; one will be generated on load.');
      }
      if (item.type !== undefined && !CONTENT_ITEM_TYPES.includes(item.type)) {
        warn(`${itemPath}.type`, `unrecognised type ${JSON.stringify(item.type)}; it will load as a task.`);
      }

      if (item.type === 'link' && item.url && !safeUrl(item.url)) {
        warn(`${itemPath}.url`, 'is not an http(s) url and will not be clickable.');
      }

      if (item.type === 'image') {
        const src = String(item.src || '');
        if (/^https?:/i.test(src)) {
          // This is the one that must abort: a remote image would make the
          // released file depend on the network.
          fail(`${itemPath}.src`, 'points at a remote url, which would break the self-contained artifact.');
        } else if (!isEmbeddedImageSrc(src)) {
          warn(`${itemPath}.src`, 'is not a supported embedded image data url and will be cleared on load.');
        }
        if (item.displayWidth !== undefined && item.displayWidth !== null) {
          const width = Number(item.displayWidth);
          if (!Number.isFinite(width) || width <= 0) {
            warn(`${itemPath}.displayWidth`, `unusable display width ${JSON.stringify(item.displayWidth)}; it will fall back.`);
          }
        }
      }
    });
  });

  return { valid: errors.length === 0, errors, warnings };
}
