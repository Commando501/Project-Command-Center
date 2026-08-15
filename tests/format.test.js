import { describe, expect, test } from 'vitest';

import {
  escapeHtml,
  formatBytes,
  formatDate,
  formatUpdated,
  linkifyText,
  safeUrl
} from '../src/app/format.js';

describe('escapeHtml (v3 parity)', () => {
  test('escapes the five v3 entities', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#039;');
  });

  test('escapes ampersands before the other entities', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  test('null and undefined become empty strings', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(0)).toBe('0');
  });

  test('neutralises a script tag', () => {
    expect(escapeHtml('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('safeUrl (v3 parity)', () => {
  test('accepts http and https and returns the parsed href', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com/');
    expect(safeUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
  });

  test('trims surrounding whitespace', () => {
    expect(safeUrl('  https://example.com/x  ')).toBe('https://example.com/x');
  });

  test('rejects every non-http(s) scheme', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://example.com',
      'mailto:a@b.c',
      'vbscript:msgbox(1)'
    ]) {
      expect(safeUrl(url)).toBe('');
    }
  });

  test('rejects malformed and empty input', () => {
    expect(safeUrl('not a url')).toBe('');
    expect(safeUrl('')).toBe('');
    expect(safeUrl(null)).toBe('');
    expect(safeUrl('htp://example.com')).toBe('');
  });
});

describe('linkifyText (v3 parity)', () => {
  test('escapes ordinary text and converts newlines to <br>', () => {
    expect(linkifyText('a < b\nc & d')).toBe('a &lt; b<br>c &amp; d');
  });

  test('links an http(s) url and keeps the display text unnormalised', () => {
    expect(linkifyText('see https://example.com now')).toBe(
      'see <a href="https://example.com/" target="_blank" rel="noopener noreferrer">https://example.com</a> now'
    );
  });

  test('strips trailing sentence punctuation out of the link', () => {
    expect(linkifyText('go to https://example.com/a.')).toBe(
      'go to <a href="https://example.com/a" target="_blank" rel="noopener noreferrer">https://example.com/a</a>.'
    );
    expect(linkifyText('(https://example.com/a)')).toBe(
      '(<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">https://example.com/a</a>)'
    );
  });

  test('never activates a javascript: url written in prose', () => {
    const out = linkifyText('try javascript:alert(1) please');
    expect(out).not.toContain('<a ');
    expect(out).toContain('javascript:alert(1)');
  });

  test('escapes html inside the url text', () => {
    const out = linkifyText('https://example.com/a?x=<b>');
    expect(out).not.toContain('<b>');
    expect(out).toContain('&lt;b&gt;');
  });

  test('handles several urls in one string', () => {
    const out = linkifyText('https://a.example https://b.example');
    expect(out.match(/<a /g)).toHaveLength(2);
  });

  test('empty input is an empty string', () => {
    expect(linkifyText('')).toBe('');
    expect(linkifyText(null)).toBe('');
  });
});

describe('formatBytes (v3 parity)', () => {
  test('matches v3 thresholds and rounding exactly', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10240)).toBe('10 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(1572864)).toBe('1.5 MB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });

  test('negative and non-numeric input clamp to zero', () => {
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes('nope')).toBe('0 B');
    expect(formatBytes(null)).toBe('0 B');
  });
});

describe('date formatting (v3 parity)', () => {
  test('blank and invalid dates render as an em dash', () => {
    expect(formatDate('')).toBe('—');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
    expect(formatUpdated('')).toBe('—');
    expect(formatUpdated('nonsense')).toBe('—');
  });

  test('a bare yyyy-mm-dd is read at local noon so it never shifts a day', () => {
    const out = formatDate('2026-08-14');
    expect(out).toContain('2026');
    expect(out).toContain('14');
  });

  test('an ISO timestamp keeps its own instant', () => {
    const out = formatUpdated('2026-08-14T15:30:00.000Z');
    expect(out).toContain('2026');
  });
});
