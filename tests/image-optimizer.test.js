import { describe, expect, test } from 'vitest';

import {
  DEFAULT_IMAGE_LONG_EDGE,
  MAX_SOURCE_IMAGE_BYTES,
  REOPTIMIZE_CAPS,
  SAFE_ORIGINAL_TYPES,
  SOFT_SOURCE_IMAGE_BYTES,
  assertAcceptableSourceFile,
  buildImageItemFields,
  canRetainOriginal,
  chooseSmallestCandidate,
  computeTargetDimensions,
  shouldWarnAboutSourceSize
} from '../src/content/image-optimizer.js';

describe('upload limits (v3 design section 6)', () => {
  test('thresholds are 5 MB soft and 25 MB hard', () => {
    expect(SOFT_SOURCE_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_SOURCE_IMAGE_BYTES).toBe(25 * 1024 * 1024);
    expect(DEFAULT_IMAGE_LONG_EDGE).toBe(1600);
  });

  test('a non-image file is rejected with the v3 message', () => {
    expect(() => assertAcceptableSourceFile({ type: 'application/pdf', size: 10 }))
      .toThrow('Choose a supported image file.');
    expect(() => assertAcceptableSourceFile(null))
      .toThrow('Choose a supported image file.');
  });

  test('a file over 25 MB is rejected before any processing', () => {
    expect(() => assertAcceptableSourceFile({
      type: 'image/png',
      size: MAX_SOURCE_IMAGE_BYTES + 1
    })).toThrow(/per-image source limit is 25 MB/);
  });

  test('a file at exactly 25 MB is accepted', () => {
    expect(() => assertAcceptableSourceFile({
      type: 'image/png',
      size: MAX_SOURCE_IMAGE_BYTES
    })).not.toThrow();
  });

  test('files above 5 MB warn but are accepted', () => {
    expect(shouldWarnAboutSourceSize(SOFT_SOURCE_IMAGE_BYTES + 1)).toBe(true);
    expect(shouldWarnAboutSourceSize(SOFT_SOURCE_IMAGE_BYTES)).toBe(false);
  });
});

describe('computeTargetDimensions (v3 parity)', () => {
  test('never upscales a source smaller than the cap', () => {
    expect(computeTargetDimensions(800, 600, 1600))
      .toMatchObject({ width: 800, height: 600, scale: 1 });
  });

  test('scales the long edge down to the cap and preserves aspect ratio', () => {
    expect(computeTargetDimensions(3200, 1600, 1600))
      .toMatchObject({ width: 1600, height: 800 });
    expect(computeTargetDimensions(1600, 3200, 1600))
      .toMatchObject({ width: 800, height: 1600 });
  });

  test('the source sentinel preserves the original dimensions', () => {
    expect(computeTargetDimensions(4000, 3000, 'source'))
      .toMatchObject({ width: 4000, height: 3000, scale: 1, preserveSource: true });
  });

  test('a non-finite cap is treated as preserve-source, as in v3', () => {
    expect(computeTargetDimensions(4000, 3000, 'nonsense').preserveSource).toBe(true);
  });

  test('dimensions never round below one pixel', () => {
    expect(computeTargetDimensions(10000, 3, 1600).height).toBe(1);
  });

  test('invalid source dimensions throw the v3 message', () => {
    expect(() => computeTargetDimensions(0, 100, 1600)).toThrow('Image has invalid dimensions.');
    expect(() => computeTargetDimensions(100, 0, 1600)).toThrow('Image has invalid dimensions.');
  });

  test('the re-optimize caps match the v3 dialog', () => {
    expect(REOPTIMIZE_CAPS).toEqual([1600, 2400, 3200, 'source']);
  });
});

describe('candidate selection (v3 parity)', () => {
  const candidate = (label, size, type) => ({
    label, type, blob: { size, type }
  });

  test('the smallest candidate wins', () => {
    const chosen = chooseSmallestCandidate([
      candidate('webp', 500, 'image/webp'),
      candidate('avif', 300, 'image/avif'),
      candidate('png', 900, 'image/png')
    ]);
    expect(chosen.label).toBe('avif');
  });

  test('ties keep insertion order, so a retained original beats a re-encode', () => {
    const chosen = chooseSmallestCandidate([
      candidate('original', 400, 'image/png'),
      candidate('webp', 400, 'image/webp')
    ]);
    expect(chosen.label).toBe('original');
  });

  test('an empty candidate list throws the v3 encoder message', () => {
    expect(() => chooseSmallestCandidate([]))
      .toThrow('This browser could not encode the image into a supported embedded format.');
  });

  test('selection does not mutate the caller array', () => {
    const list = [candidate('b', 2), candidate('a', 1)];
    chooseSmallestCandidate(list);
    expect(list.map(item => item.label)).toEqual(['b', 'a']);
  });
});

describe('retaining the original source (v3 parity)', () => {
  test('only unscaled sources of a safe type may be retained', () => {
    expect(canRetainOriginal('image/png', 1)).toBe(true);
    expect(canRetainOriginal('image/jpeg', 1)).toBe(true);
    expect(canRetainOriginal('image/webp', 1)).toBe(true);
    expect(canRetainOriginal('image/avif', 1)).toBe(true);
    expect(canRetainOriginal('image/gif', 1)).toBe(true);
    expect(canRetainOriginal('image/svg+xml', 1)).toBe(false);
    expect(canRetainOriginal('image/bmp', 1)).toBe(false);
    expect(canRetainOriginal('image/png', 0.5)).toBe(false);
  });

  test('the safe original type set matches the embedded data-url whitelist', () => {
    expect([...SAFE_ORIGINAL_TYPES].sort()).toEqual([
      'image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'
    ]);
  });
});

describe('buildImageItemFields', () => {
  test('assembles the locked image field set from an encode result', () => {
    const fields = buildImageItemFields({
      src: 'data:image/webp;base64,AAAA',
      mimeType: 'image/webp',
      target: { width: 1600, height: 900, preserveSource: false, cap: 1600 },
      source: { width: 4000, height: 2250, name: 'shot.png' },
      sizeBytes: 54321,
      optimizedAt: '2026-08-15T00:00:00.000Z'
    });

    expect(fields).toEqual({
      type: 'image',
      src: 'data:image/webp;base64,AAAA',
      mimeType: 'image/webp',
      width: 1600,
      height: 900,
      originalWidth: 4000,
      originalHeight: 2250,
      sizeBytes: 54321,
      filename: 'shot.png',
      optimizedAt: '2026-08-15T00:00:00.000Z',
      optimizationCap: 1600
    });
  });

  test('a preserve-source encode records the source sentinel', () => {
    const fields = buildImageItemFields({
      src: 'data:image/png;base64,AA',
      mimeType: 'image/png',
      target: { width: 100, height: 100, preserveSource: true, cap: 100 },
      source: { width: 100, height: 100, name: '' },
      sizeBytes: 10,
      optimizedAt: '2026-08-15T00:00:00.000Z'
    });
    expect(fields.optimizationCap).toBe('source');
    expect(fields.filename).toBe('image');
  });
});
