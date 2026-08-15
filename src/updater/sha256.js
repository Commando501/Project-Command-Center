/**
 * SHA-256 over release bytes, using Web Crypto only.
 *
 * No custom hash implementation: an official online update is refused unless
 * this verification succeeds, so the primitive has to be the platform's.
 */

const HEX_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function resolveCrypto(cryptoRef) {
  const impl = cryptoRef || globalThis.crypto;
  if (!impl?.subtle?.digest) {
    throw new Error(
      'This browser cannot verify updates: Web Crypto is unavailable. '
      + 'Download the release from GitHub and verify it yourself before use.'
    );
  }
  return impl;
}

/**
 * Whether verification is possible at all. `crypto.subtle` requires a secure
 * context; file:// counts as one in current browsers, but this is checked
 * rather than assumed so the UI can degrade honestly instead of throwing.
 */
export function isSha256Available(cryptoRef) {
  return Boolean((cryptoRef || globalThis.crypto)?.subtle?.digest);
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (typeof input === 'string') return new TextEncoder().encode(input);
  throw new TypeError('SHA-256 input must be bytes or a string.');
}

export async function sha256Hex(input, cryptoRef) {
  const impl = resolveCrypto(cryptoRef);
  const bytes = toBytes(input);
  const digest = await impl.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Accepts a bare hex digest or the "sha256:..." form GitHub uses for release
 * asset digests. Returns lowercase hex, or null if it is not a valid digest.
 */
export function normalizeSha256(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  const bare = raw.startsWith('sha256:') ? raw.slice('sha256:'.length) : raw;
  return HEX_DIGEST_PATTERN.test(bare) ? bare : null;
}

export function isValidSha256(value) {
  return normalizeSha256(value) !== null;
}

export async function verifySha256(input, expectedDigest, cryptoRef) {
  const expected = normalizeSha256(expectedDigest);
  if (!expected) return false;
  const actual = await sha256Hex(input, cryptoRef);
  return actual === expected;
}
