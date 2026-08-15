import { describe, expect, test } from 'vitest';

import {
  IMAGE_DATA_URL_PATTERN,
  contentItemHasMeaningfulData,
  normalizeContentItem
} from '../src/content/content-items.js';

describe('normalizeContentItem type coercion (v3 parity)', () => {
  test('unknown and missing types collapse to task', () => {
    expect(normalizeContentItem({ type: 'sticker', text: 'x' }).type).toBe('task');
    expect(normalizeContentItem({ text: 'x' }).type).toBe('task');
    expect(normalizeContentItem({ type: 'IMAGE', text: 'x' }).type).toBe('task');
    expect(normalizeContentItem(null).type).toBe('task');
  });

  test('an id is generated when absent and preserved when present', () => {
    expect(normalizeContentItem({ type: 'task', id: 'keep-me' }).id).toBe('keep-me');
    const generated = normalizeContentItem({ type: 'task' }).id;
    expect(typeof generated).toBe('string');
    expect(generated.length).toBeGreaterThan(0);
  });
});

describe('task and bullet items (v3 parity)', () => {
  test('a task keeps its completed flag', () => {
    expect(normalizeContentItem({ type: 'task', text: 'a', completed: true }))
      .toMatchObject({ type: 'task', text: 'a', completed: true });
  });

  test('a bullet is never completed, even if the source says otherwise', () => {
    expect(normalizeContentItem({ type: 'bullet', text: 'b', completed: true }).completed)
      .toBe(false);
  });

  test('text items carry no link or image fields', () => {
    expect(Object.keys(normalizeContentItem({ type: 'task', text: 'a' })).sort())
      .toEqual(['completed', 'id', 'text', 'type']);
  });
});

describe('link items (v3 parity)', () => {
  test('a link stores label and url verbatim, including unsafe schemes', () => {
    // v3 stores whatever the user typed and refuses to activate it at render
    // time. The render-time check is the security boundary, not storage.
    const item = normalizeContentItem({
      type: 'link',
      label: 'Bad',
      url: 'javascript:alert(1)'
    });
    expect(item).toMatchObject({
      type: 'link',
      label: 'Bad',
      url: 'javascript:alert(1)'
    });
  });

  test('a link carries exactly the v3 field set', () => {
    expect(Object.keys(normalizeContentItem({ type: 'link' })).sort())
      .toEqual(['id', 'label', 'type', 'url']);
  });
});

describe('image items (v3 parity)', () => {
  const src = 'data:image/webp;base64,AAAA';

  test('accepts only the five v3 embedded image mime types', () => {
    for (const mime of ['png', 'jpeg', 'webp', 'avif', 'gif']) {
      expect(IMAGE_DATA_URL_PATTERN.test(`data:image/${mime};base64,AA`)).toBe(true);
    }
    expect(IMAGE_DATA_URL_PATTERN.test('DATA:IMAGE/PNG;base64,AA')).toBe(true);
    expect(IMAGE_DATA_URL_PATTERN.test('data:image/svg+xml;base64,AA')).toBe(false);
    expect(IMAGE_DATA_URL_PATTERN.test('https://example.com/a.png')).toBe(false);
    expect(IMAGE_DATA_URL_PATTERN.test('data:image/png,AA')).toBe(false);
  });

  test('a disallowed src is blanked rather than rejected', () => {
    expect(normalizeContentItem({ type: 'image', src: 'https://example.com/a.png' }).src)
      .toBe('');
  });

  test('preserves every locked image field', () => {
    const item = normalizeContentItem({
      type: 'image',
      src,
      caption: 'Prototype',
      filename: 'proto.webp',
      mimeType: 'image/webp',
      width: 1600,
      height: 900,
      displayWidth: 640,
      originalWidth: 4000,
      originalHeight: 2250,
      sizeBytes: 123456,
      optimizedAt: '2026-08-14T00:00:00.000Z',
      optimizationCap: 2400
    });

    expect(item).toMatchObject({
      src,
      caption: 'Prototype',
      filename: 'proto.webp',
      mimeType: 'image/webp',
      width: 1600,
      height: 900,
      displayWidth: 640,
      originalWidth: 4000,
      originalHeight: 2250,
      sizeBytes: 123456,
      optimizedAt: '2026-08-14T00:00:00.000Z',
      optimizationCap: 2400
    });
  });

  test('displayWidth: null, empty string, and undefined all mean fit-width', () => {
    for (const raw of [null, '', undefined]) {
      expect(normalizeContentItem({ type: 'image', src, width: 300, displayWidth: raw }).displayWidth)
        .toBeNull();
    }
  });

  test('displayWidth floors at 80 in normalization, not 120', () => {
    // setImageDisplayWidth floors at 120; normalizeContentItem floors at 80.
    // The inconsistency is v3 behavior and is preserved deliberately.
    expect(normalizeContentItem({ type: 'image', src, width: 300, displayWidth: 40 }).displayWidth)
      .toBe(80);
  });

  test('a zero or unparsable displayWidth falls back to intrinsic width, then 80', () => {
    expect(normalizeContentItem({ type: 'image', src, width: 300, displayWidth: 0 }).displayWidth)
      .toBe(300);
    expect(normalizeContentItem({ type: 'image', src, width: 300, displayWidth: 'abc' }).displayWidth)
      .toBe(300);
    expect(normalizeContentItem({ type: 'image', src, width: 0, displayWidth: 0 }).displayWidth)
      .toBe(80);
  });

  test('missing originals fall back to the optimized dimensions', () => {
    const item = normalizeContentItem({ type: 'image', src, width: 800, height: 600 });
    expect(item.originalWidth).toBe(800);
    expect(item.originalHeight).toBe(600);
  });

  test('optimizationCap keeps the source sentinel and defaults to 1600', () => {
    expect(normalizeContentItem({ type: 'image', src, optimizationCap: 'source' }).optimizationCap)
      .toBe('source');
    expect(normalizeContentItem({ type: 'image', src }).optimizationCap).toBe(1600);
    expect(normalizeContentItem({ type: 'image', src, optimizationCap: 0 }).optimizationCap)
      .toBe(1600);
    expect(normalizeContentItem({ type: 'image', src, optimizationCap: '3200' }).optimizationCap)
      .toBe(3200);
  });

  test('negative numeric fields clamp to zero', () => {
    const item = normalizeContentItem({
      type: 'image', src, width: -5, height: -5, sizeBytes: -100
    });
    expect(item.width).toBe(0);
    expect(item.height).toBe(0);
    expect(item.sizeBytes).toBe(0);
  });
});

describe('contentItemHasMeaningfulData (v3 parity)', () => {
  test('an image needs a valid embedded data url', () => {
    expect(contentItemHasMeaningfulData({ type: 'image', src: 'data:image/png;base64,AA' })).toBe(true);
    expect(contentItemHasMeaningfulData({ type: 'image', src: '' })).toBe(false);
    expect(contentItemHasMeaningfulData({ type: 'image', src: 'https://example.com/a.png' })).toBe(false);
  });

  test('a link needs a label or a url', () => {
    expect(contentItemHasMeaningfulData({ type: 'link', label: 'A', url: '' })).toBe(true);
    expect(contentItemHasMeaningfulData({ type: 'link', label: '', url: 'https://a.example' })).toBe(true);
    expect(contentItemHasMeaningfulData({ type: 'link', label: '', url: '' })).toBe(false);
    expect(contentItemHasMeaningfulData({ type: 'link', label: '   ', url: '  ' })).toBe(false);
  });

  test('a task or bullet needs non-blank text', () => {
    expect(contentItemHasMeaningfulData({ type: 'task', text: 'a' })).toBe(true);
    expect(contentItemHasMeaningfulData({ type: 'task', text: '   ' })).toBe(false);
    expect(contentItemHasMeaningfulData({ type: 'bullet', text: '' })).toBe(false);
  });

  test('null is not meaningful', () => {
    expect(contentItemHasMeaningfulData(null)).toBe(false);
    expect(contentItemHasMeaningfulData(undefined)).toBe(false);
  });
});
