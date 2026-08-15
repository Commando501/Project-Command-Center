import { makeId } from '../app/util.js';

/**
 * The mixed content stream: task, bullet, link, and image items.
 *
 * Normalization is deliberately forgiving. Malformed content must never break
 * project loading (v3 design section 14), so unknown types collapse to `task`
 * and unusable values fall back rather than throwing.
 */

export const CONTENT_ITEM_TYPES = Object.freeze(['task', 'bullet', 'link', 'image']);

/**
 * The only image sources allowed inside the artifact. Anything else — a remote
 * URL, an SVG, a bare `data:` with no subtype — is blanked, which keeps the
 * released file genuinely self-contained.
 */
export const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp|avif|gif);/i;

export function isEmbeddedImageSrc(src) {
  return IMAGE_DATA_URL_PATTERN.test(String(src || ''));
}

export function normalizeContentItem(item) {
  const source = item || {};
  const rawType = String(source.type || 'task');
  const type = CONTENT_ITEM_TYPES.includes(rawType) ? rawType : 'task';
  const id = String(source.id || makeId());

  if (type === 'link') {
    // Stored verbatim, including unsafe schemes. `safeUrl` at render time is
    // the security boundary; refusing to store would silently destroy input
    // the user is still typing.
    return { id, type, label: String(source.label || ''), url: String(source.url || '') };
  }

  if (type === 'image') {
    const width = Math.max(0, Math.trunc(Number(source.width) || 0));
    const height = Math.max(0, Math.trunc(Number(source.height) || 0));
    const rawDisplayWidth = source.displayWidth;
    const src = String(source.src || '');

    return {
      id,
      type,
      src: isEmbeddedImageSrc(src) ? src : '',
      caption: String(source.caption || ''),
      filename: String(source.filename || 'image'),
      mimeType: String(source.mimeType || ''),
      width,
      height,
      // null means fit-width. The 80px floor here differs from the 120px floor
      // in setImageDisplayWidth; both are v3 behavior and are preserved.
      displayWidth:
        rawDisplayWidth === null || rawDisplayWidth === '' || rawDisplayWidth === undefined
          ? null
          : Math.max(80, Math.trunc(Number(rawDisplayWidth) || width || 80)),
      originalWidth: Math.max(0, Math.trunc(Number(source.originalWidth) || width)),
      originalHeight: Math.max(0, Math.trunc(Number(source.originalHeight) || height)),
      sizeBytes: Math.max(0, Math.trunc(Number(source.sizeBytes) || 0)),
      optimizedAt: String(source.optimizedAt || ''),
      optimizationCap:
        source.optimizationCap === 'source'
          ? 'source'
          : Math.max(0, Math.trunc(Number(source.optimizationCap) || 1600))
    };
  }

  return {
    id,
    type,
    text: String(source.text || ''),
    completed: type === 'task' ? Boolean(source.completed) : false
  };
}

/** Items with nothing in them are dropped at load and at export, as in v3. */
export function contentItemHasMeaningfulData(item) {
  if (!item) return false;
  if (item.type === 'image') return isEmbeddedImageSrc(item.src);
  if (item.type === 'link') {
    return Boolean(String(item.label || '').trim() || String(item.url || '').trim());
  }
  return Boolean(String(item.text || '').trim());
}

export function normalizeContentItems(items) {
  return Array.isArray(items)
    ? items.map(normalizeContentItem).filter(contentItemHasMeaningfulData)
    : [];
}

export function createTextItem(type, text) {
  return { id: makeId(), type, text: String(text || '').trim(), completed: false };
}

export function createLinkItem() {
  return { id: makeId(), type: 'link', label: '', url: '' };
}

/** Field-by-field update rules and length caps, matching v3 exactly. */
export function applyContentItemUpdate(item, changes) {
  if (!item || !changes) return false;
  let applied = false;

  if ((item.type === 'task' || item.type === 'bullet') && Object.hasOwn(changes, 'text')) {
    item.text = String(changes.text).slice(0, 240);
    applied = true;
  }
  if (item.type === 'task' && Object.hasOwn(changes, 'completed')) {
    item.completed = Boolean(changes.completed);
    applied = true;
  }
  if (item.type === 'link' && Object.hasOwn(changes, 'label')) {
    item.label = String(changes.label).slice(0, 240);
    applied = true;
  }
  if (item.type === 'link' && Object.hasOwn(changes, 'url')) {
    item.url = String(changes.url).slice(0, 2000);
    applied = true;
  }
  if (item.type === 'image' && Object.hasOwn(changes, 'caption')) {
    item.caption = String(changes.caption).slice(0, 300);
    applied = true;
  }
  return applied;
}

/**
 * Display resizing must never touch the encoded source. Only `displayWidth`
 * changes here; `src`, `sizeBytes`, `mimeType`, intrinsic dimensions, and the
 * filename are all left alone. The 120px floor is v3 behavior.
 */
export function setImageDisplayWidth(item, width) {
  if (!item || item.type !== 'image') return false;
  item.displayWidth =
    width === null ? null : Math.max(120, Math.round(Number(width) || item.width || 120));
  return true;
}
