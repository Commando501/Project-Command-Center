/**
 * Display formatting and URL safety.
 *
 * `safeUrl` is the security boundary for links: user data may contain any
 * string at all, and this module decides what is allowed to become a live
 * anchor. Storage deliberately does not filter, matching v3.
 */

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** Returns the parsed href for http(s) URLs only, otherwise an empty string. */
export function safeUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,!?;:)]$/;

/**
 * Escapes text, then turns bare http(s) URLs into anchors. Trailing sentence
 * punctuation is pushed back out of the link so "see https://x.example." does
 * not produce a link ending in a full stop.
 */
export function linkifyText(value) {
  const raw = String(value || '');
  const pattern = new RegExp(URL_PATTERN.source, URL_PATTERN.flags);
  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(raw))) {
    let candidate = match[0];
    let trailing = '';
    while (TRAILING_PUNCTUATION.test(candidate)) {
      trailing = candidate.slice(-1) + trailing;
      candidate = candidate.slice(0, -1);
    }

    result += escapeHtml(raw.slice(lastIndex, match.index));
    const href = safeUrl(candidate);
    result += href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(candidate)}</a>${escapeHtml(trailing)}`
      : escapeHtml(match[0]);
    lastIndex = match.index + match[0].length;
  }

  result += escapeHtml(raw.slice(lastIndex));
  return result.replace(/\n/g, '<br>');
}

export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) {
    return `${Number((value / 1024).toFixed(value < 10240 ? 1 : 0))} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${Number((value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 2 : 1))} MB`;
  }
  return `${Number((value / (1024 * 1024 * 1024)).toFixed(2))} GB`;
}

/**
 * A bare `yyyy-mm-dd` is read at local noon so that a timezone west of UTC
 * cannot pull the displayed date back to the previous day.
 */
export function formatDate(dateString) {
  if (!dateString) return '—';
  const date = new Date(dateString + (String(dateString).length === 10 ? 'T12:00:00' : ''));
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  }).format(date);
}

export function formatUpdated(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }).format(date);
}
