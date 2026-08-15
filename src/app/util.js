/** Small shared primitives. Ported verbatim from legacy v3 semantics. */

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

/**
 * Deep clone via a JSON round trip.
 *
 * `structuredClone` would also work, but the Data Capsule is embedded in the
 * artifact as JSON, so anything that cannot survive a JSON round trip is
 * already invalid. Failing loudly here is better than discovering it at
 * injection time, when a silently dropped field would look like data loss.
 */
export function cloneJson(value) {
  const json = JSON.stringify(value, (key, entry) => {
    const type = typeof entry;
    if (type === 'function' || type === 'symbol' || type === 'undefined') {
      throw new TypeError(
        `Value at "${key || '<root>'}" is not JSON representable (${type}).`
      );
    }
    if (type === 'number' && !Number.isFinite(entry)) {
      throw new TypeError(
        `Value at "${key || '<root>'}" is not JSON representable (${entry}).`
      );
    }
    return entry;
  });

  if (json === undefined) {
    throw new TypeError('Value is not JSON representable.');
  }
  return JSON.parse(json);
}
