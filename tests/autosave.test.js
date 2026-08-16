import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  autosaveTargetKey,
  createAutosaveScheduler,
  ensureWritePermission,
  isAutosaveSupported,
  writeHtmlToHandle
} from '../src/persistence/autosave.js';

/**
 * jsdom implements neither the File System Access API nor IndexedDB, so every
 * browser object here is a fake. The real APIs were verified end to end in
 * Chrome 151 from a file:// page; what these tests protect is the logic layered
 * on top of them — debouncing, write coalescing, permission gating, and the
 * refusal to write anything that failed marker validation.
 */

const fakeWritable = () => {
  const calls = { write: [], closed: 0, aborted: 0 };
  return {
    calls,
    write: vi.fn(async (data) => { calls.write.push(data); }),
    close: vi.fn(async () => { calls.closed += 1; }),
    abort: vi.fn(async () => { calls.aborted += 1; })
  };
};

const fakeHandle = (overrides = {}) => {
  const writable = overrides.writable || fakeWritable();
  return {
    name: 'Project-Command-Center-v4.0.7.html',
    writable,
    createWritable: vi.fn(async () => writable),
    queryPermission: vi.fn(async () => 'granted'),
    requestPermission: vi.fn(async () => 'granted'),
    ...overrides
  };
};

describe('isAutosaveSupported', () => {
  test('requires both the picker and a handle store', () => {
    expect(isAutosaveSupported({ showSaveFilePicker: () => {}, indexedDB: {} })).toBe(true);
    expect(isAutosaveSupported({ indexedDB: {} })).toBe(false);
    expect(isAutosaveSupported({ showSaveFilePicker: () => {} })).toBe(false);
    expect(isAutosaveSupported({})).toBe(false);
  });
});

describe('autosaveTargetKey', () => {
  test('isolates trackers, because every file:// page shares one storage bucket', () => {
    const a = autosaveTargetKey({ location: { href: 'file:///C:/work/tracker-a.html' } });
    const b = autosaveTargetKey({ location: { href: 'file:///D:/other/tracker-b.html' } });
    expect(a).not.toBe(b);
    expect(a).toContain('tracker-a.html');
  });

  test('ignores the fragment, so a deep link is still the same file', () => {
    const plain = autosaveTargetKey({ location: { href: 'file:///C:/t.html' } });
    const hashed = autosaveTargetKey({ location: { href: 'file:///C:/t.html#project-3' } });
    expect(hashed).toBe(plain);
  });
});

describe('ensureWritePermission', () => {
  test('granted needs no prompt', async () => {
    const handle = fakeHandle();
    await expect(ensureWritePermission(handle)).resolves.toBe('granted');
    expect(handle.requestPermission).not.toHaveBeenCalled();
  });

  test('does not prompt unless the caller is handling a user gesture', async () => {
    const handle = fakeHandle({ queryPermission: vi.fn(async () => 'prompt') });
    await expect(ensureWritePermission(handle)).resolves.toBe('prompt');
    expect(handle.requestPermission).not.toHaveBeenCalled();
  });

  test('prompts when interactive', async () => {
    const handle = fakeHandle({ queryPermission: vi.fn(async () => 'prompt') });
    await expect(ensureWritePermission(handle, { interactive: true })).resolves.toBe('granted');
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  test('a denied handle stays denied', async () => {
    const handle = fakeHandle({
      queryPermission: vi.fn(async () => 'denied'),
      requestPermission: vi.fn(async () => 'denied')
    });
    await expect(ensureWritePermission(handle, { interactive: true })).resolves.toBe('denied');
  });

  test('a revoked handle reports denied instead of throwing', async () => {
    const handle = fakeHandle({
      queryPermission: vi.fn(async () => { throw new Error('handle is stale'); })
    });
    await expect(ensureWritePermission(handle)).resolves.toBe('denied');
  });
});

describe('writeHtmlToHandle', () => {
  test('writes then closes, which is what commits atomically', async () => {
    const handle = fakeHandle();
    await writeHtmlToHandle(handle, '<html>ok</html>');
    expect(handle.writable.calls.write).toEqual(['<html>ok</html>']);
    expect(handle.writable.calls.closed).toBe(1);
    expect(handle.writable.calls.aborted).toBe(0);
  });

  test('aborts the swap file rather than leaving it committed on failure', async () => {
    const writable = fakeWritable();
    writable.write = vi.fn(async () => { throw new Error('disk full'); });
    const handle = fakeHandle({ writable });

    await expect(writeHtmlToHandle(handle, '<html>x</html>')).rejects.toThrow('disk full');
    expect(writable.abort).toHaveBeenCalled();
    expect(writable.close).not.toHaveBeenCalled();
  });

  test('refuses empty output rather than truncating the user\'s file', async () => {
    const handle = fakeHandle();
    await expect(writeHtmlToHandle(handle, '')).rejects.toThrow(/refus/i);
    expect(handle.createWritable).not.toHaveBeenCalled();
  });
});

describe('createAutosaveScheduler', () => {
  let write;
  let statuses;

  const build = (overrides = {}) => createAutosaveScheduler({
    write,
    delayMs: 1000,
    onStatus: (status) => statuses.push(status),
    ...overrides
  });

  beforeEach(() => {
    vi.useFakeTimers();
    statuses = [];
    write = vi.fn(async () => {});
  });

  test('coalesces a burst of edits into a single write', async () => {
    const scheduler = build();
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    expect(write).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  test('an edit during a write produces exactly one follow-up write', async () => {
    let release;
    write = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const scheduler = build();

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);

    // Three more edits land while the first write is still in flight.
    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    expect(write).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
  });

  test('flush writes immediately and cancels the pending debounce', async () => {
    const scheduler = build();
    scheduler.schedule();
    await scheduler.flush();
    expect(write).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  test('flush with nothing pending does not write', async () => {
    const scheduler = build();
    await scheduler.flush();
    expect(write).not.toHaveBeenCalled();
  });

  test('cancel drops the pending write', async () => {
    const scheduler = build();
    scheduler.schedule();
    scheduler.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(write).not.toHaveBeenCalled();
  });

  test('a failed write is reported and does not wedge the scheduler', async () => {
    write = vi.fn()
      .mockRejectedValueOnce(new Error('permission revoked'))
      .mockResolvedValueOnce(undefined);
    const scheduler = build();

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(statuses.some(s => s.state === 'error')).toBe(true);
    expect(statuses.find(s => s.state === 'error').message).toMatch(/permission revoked/);

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1).state).toBe('saved');
  });

  test('reports the states the UI renders, in order', async () => {
    const scheduler = build();
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(1000);
    expect(statuses.map(s => s.state)).toEqual(['pending', 'writing', 'saved']);
  });
});
