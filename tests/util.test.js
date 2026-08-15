import { describe, expect, test } from 'vitest';

import { clamp, cloneJson, makeId } from '../src/app/util.js';

describe('clamp (v3 parity)', () => {
  test('clamps into range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('makeId', () => {
  test('returns distinct non-empty strings', () => {
    const a = makeId();
    const b = makeId();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe('cloneJson', () => {
  test('produces a deep, independent copy', () => {
    const source = { a: [{ b: 1 }], c: 'x' };
    const copy = cloneJson(source);
    expect(copy).toEqual(source);
    copy.a[0].b = 2;
    expect(source.a[0].b).toBe(1);
  });

  test('guarantees the result is JSON representable', () => {
    // The capsule is embedded as JSON, so anything that cannot survive a JSON
    // round trip must fail loudly here rather than silently at injection time.
    expect(() => cloneJson({ fn() {} })).toThrow(/not JSON representable/i);
    expect(() => cloneJson({ u: undefined })).toThrow(/not JSON representable/i);
    expect(() => cloneJson({ big: 1n })).toThrow();
    const cyclic = {};
    cyclic.self = cyclic;
    expect(() => cloneJson(cyclic)).toThrow();
  });

  test('accepts ordinary capsule shapes', () => {
    expect(cloneJson({ schemaVersion: 4, projects: [], preferences: {} }))
      .toEqual({ schemaVersion: 4, projects: [], preferences: {} });
    expect(cloneJson(null)).toBeNull();
  });
});
