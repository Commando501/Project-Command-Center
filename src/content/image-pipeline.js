import {
  DEFAULT_IMAGE_LONG_EDGE,
  assertAcceptableSourceFile,
  buildImageItemFields,
  canRetainOriginal,
  chooseSmallestCandidate,
  computeTargetDimensions,
  shouldWarnAboutSourceSize
} from './image-optimizer.js';

/**
 * Browser image I/O: decode, rescale, encode, embed.
 *
 * All policy decisions live in image-optimizer.js; this module only performs
 * the parts that need a real browser. The full original source is deliberately
 * never retained — keeping it would defeat the whole point of optimizing
 * before embedding.
 */

export function fileToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read image data.'));
    reader.readAsDataURL(blob);
  });
}

export async function decodeImageBlob(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        drawable: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close && bitmap.close()
      };
    } catch {
      // Fall through to the HTMLImageElement path below.
    }
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve({
      drawable: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      cleanup: () => URL.revokeObjectURL(objectUrl)
    });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('This browser could not decode that image.'));
    };
    image.src = objectUrl;
  });
}

/**
 * Returns a blob only when the browser actually honoured the requested type.
 * Canvas silently falls back to PNG for formats it cannot encode, so decode or
 * display support must never be taken as evidence of encode support.
 */
export function canvasToTypedBlob(canvas, type, quality) {
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob && blob.type === type ? blob : null), type, quality);
  });
}

export async function optimizeImageFile(file, maxLongEdge = DEFAULT_IMAGE_LONG_EDGE) {
  assertAcceptableSourceFile(file);

  const decoded = await decodeImageBlob(file);
  try {
    const target = computeTargetDimensions(decoded.width, decoded.height, maxLongEdge);

    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas image processing is unavailable.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(decoded.drawable, 0, 0, target.width, target.height);

    const candidates = [];
    if (canRetainOriginal(file.type, target.scale)) {
      candidates.push({ blob: file, type: file.type, label: 'original' });
    }

    const webp = await canvasToTypedBlob(canvas, 'image/webp', 0.94);
    if (webp) candidates.push({ blob: webp, type: webp.type, label: 'webp' });
    const avif = await canvasToTypedBlob(canvas, 'image/avif', 0.90);
    if (avif) candidates.push({ blob: avif, type: avif.type, label: 'avif' });
    const png = await canvasToTypedBlob(canvas, 'image/png');
    if (png) candidates.push({ blob: png, type: png.type, label: 'png' });
    if (file.type === 'image/jpeg') {
      const jpeg = await canvasToTypedBlob(canvas, 'image/jpeg', 0.94);
      if (jpeg) candidates.push({ blob: jpeg, type: jpeg.type, label: 'jpeg' });
    }

    const selected = chooseSmallestCandidate(candidates);

    return {
      ...buildImageItemFields({
        src: await fileToDataUrl(selected.blob),
        mimeType: selected.type,
        target,
        source: { width: decoded.width, height: decoded.height, name: file.name },
        sizeBytes: selected.blob.size,
        optimizedAt: new Date().toISOString()
      }),
      warning: shouldWarnAboutSourceSize(file.size)
    };
  } finally {
    decoded.cleanup();
  }
}
