import { describe, expect, test } from 'vitest';

import {
  isSha256Available,
  isValidSha256,
  normalizeSha256,
  sha256Hex,
  verifySha256
} from '../src/updater/sha256.js';

const ABC_DIGEST = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const EMPTY_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('sha256Hex', () => {
  test('computes the known digest of "abc"', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(ABC_DIGEST);
  });

  test('computes the known digest of the empty input', async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(EMPTY_DIGEST);
  });

  test('accepts strings, ArrayBuffers, and typed arrays alike', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex('abc')).toBe(ABC_DIGEST);
    expect(await sha256Hex(bytes.buffer)).toBe(ABC_DIGEST);
    expect(await sha256Hex(bytes)).toBe(ABC_DIGEST);
  });

  test('is sensitive to a single flipped byte', async () => {
    const a = await sha256Hex('Project Command Center');
    const b = await sha256Hex('Project Command Centes');
    expect(a).not.toBe(b);
  });

  test('rejects input that is not bytes or a string', async () => {
    await expect(sha256Hex(42)).rejects.toThrow(/must be bytes or a string/);
    await expect(sha256Hex(null)).rejects.toThrow(/must be bytes or a string/);
  });

  test('reports a clear failure when Web Crypto is unavailable', async () => {
    expect(isSha256Available({})).toBe(false);
    expect(isSha256Available()).toBe(true);
    await expect(sha256Hex('abc', {})).rejects.toThrow(/cannot verify updates/);
  });
});

describe('normalizeSha256', () => {
  test('accepts a bare digest and the GitHub sha256: form', () => {
    expect(normalizeSha256(ABC_DIGEST)).toBe(ABC_DIGEST);
    expect(normalizeSha256(`sha256:${ABC_DIGEST}`)).toBe(ABC_DIGEST);
    expect(normalizeSha256(`  SHA256:${ABC_DIGEST.toUpperCase()}  `)).toBe(ABC_DIGEST);
  });

  test('rejects anything that is not 64 hex characters', () => {
    for (const value of [
      '', null, undefined, 'not-a-digest', ABC_DIGEST.slice(0, 63),
      `${ABC_DIGEST}0`, `sha1:${ABC_DIGEST}`, ABC_DIGEST.replace('b', 'z')
    ]) {
      expect(normalizeSha256(value)).toBeNull();
      expect(isValidSha256(value)).toBe(false);
    }
  });
});

describe('verifySha256', () => {
  test('accepts a matching digest in either form', async () => {
    await expect(verifySha256('abc', ABC_DIGEST)).resolves.toBe(true);
    await expect(verifySha256('abc', `sha256:${ABC_DIGEST}`)).resolves.toBe(true);
  });

  test('detects a mismatch', async () => {
    await expect(verifySha256('abc', '0'.repeat(64))).resolves.toBe(false);
    await expect(verifySha256('abd', ABC_DIGEST)).resolves.toBe(false);
  });

  test('a malformed expected digest never verifies', async () => {
    await expect(verifySha256('abc', '')).resolves.toBe(false);
    await expect(verifySha256('abc', null)).resolves.toBe(false);
    await expect(verifySha256('abc', 'sha256:')).resolves.toBe(false);
  });
});
