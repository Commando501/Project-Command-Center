import { formatBytes } from '../app/format.js';

/**
 * Pure image optimization policy.
 *
 * Everything here is deterministic and browser-free so the policy can be
 * tested without canvas or `createImageBitmap`. The decoding and encoding I/O
 * lives in `image-pipeline.js`, which calls into these functions.
 */

export const SOFT_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_SOURCE_IMAGE_BYTES = 25 * 1024 * 1024;
export const DEFAULT_IMAGE_LONG_EDGE = 1600;

/** Caps offered by the "Re-optimize larger" dialog. */
export const REOPTIMIZE_CAPS = Object.freeze([1600, 2400, 3200, 'source']);
export const DEFAULT_REOPTIMIZE_CAP = 2400;

/**
 * Source types that may be embedded byte-for-byte when no rescale happened.
 * Identical to the embedded data-URL whitelist in content-items.js.
 */
export const SAFE_ORIGINAL_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'
]);

export function assertAcceptableSourceFile(file) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    throw new Error('Choose a supported image file.');
  }
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(
      `Image is ${formatBytes(file.size)}. The per-image source limit is 25 MB.`
    );
  }
}

export function shouldWarnAboutSourceSize(size) {
  return Number(size) > SOFT_SOURCE_IMAGE_BYTES;
}

/**
 * Target dimensions for a long-edge cap. Never upscales, always preserves the
 * aspect ratio, and never rounds an edge below one pixel.
 */
export function computeTargetDimensions(sourceWidth, sourceHeight, maxLongEdge) {
  if (!sourceWidth || !sourceHeight) throw new Error('Image has invalid dimensions.');

  const preserveSource = maxLongEdge === 'source' || !Number.isFinite(Number(maxLongEdge));
  const longEdge = Math.max(sourceWidth, sourceHeight);
  const cap = preserveSource
    ? longEdge
    : Math.max(1, Number(maxLongEdge) || DEFAULT_IMAGE_LONG_EDGE);
  const scale = Math.min(1, cap / longEdge);

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
    cap,
    preserveSource
  };
}

/**
 * Smallest candidate wins. `Array.prototype.sort` is stable, so on a byte tie
 * the earlier candidate is kept — which is how a retained original beats an
 * equally sized re-encode.
 */
export function chooseSmallestCandidate(candidates) {
  if (!candidates || !candidates.length) {
    throw new Error('This browser could not encode the image into a supported embedded format.');
  }
  return [...candidates].sort((a, b) => a.blob.size - b.blob.size)[0];
}

export function canRetainOriginal(fileType, scale) {
  return scale === 1 && SAFE_ORIGINAL_TYPES.has(String(fileType));
}

/** Assembles the locked image field set from an encode result. */
export function buildImageItemFields({ src, mimeType, target, source, sizeBytes, optimizedAt }) {
  return {
    type: 'image',
    src,
    mimeType,
    width: target.width,
    height: target.height,
    originalWidth: source.width,
    originalHeight: source.height,
    sizeBytes,
    filename: String(source.name || 'image'),
    optimizedAt,
    optimizationCap: target.preserveSource ? 'source' : Math.round(target.cap)
  };
}
