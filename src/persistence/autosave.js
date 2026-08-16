/**
 * In-place autosave to a user-granted file handle.
 *
 * The File System Access API is available from `file://` in Chrome and lets a
 * page rewrite one file the user explicitly picked, repeatedly, after a single
 * dialog. Verified end to end in Chrome 151 on 2026-08-15.
 *
 * Two properties make this safe enough to point at the user's live tracker,
 * and both are required by the amended data-safety rule in CLAUDE.md:
 *
 * - `createWritable()` does not stream into the target. It writes to a swap
 *   file and moves it into place on `close()`, so a crash or a full disk
 *   leaves the original file intact rather than half-rewritten.
 * - The caller builds the HTML through `injectDataCapsuleIntoShell`, which
 *   refuses a shell whose markers are missing or duplicated. Nothing that
 *   fails marker validation ever reaches a writable.
 *
 * The update pipeline is deliberately NOT routed through here. An update still
 * produces a new versioned file and never touches the running one.
 */

export const AUTOSAVE_DB_NAME = 'pcc-autosave';
export const AUTOSAVE_STORE_NAME = 'handles';

/** Long enough to coalesce typing, short enough to survive an accidental close. */
export const AUTOSAVE_DELAY_MS = 1200;

/** A hung IndexedDB open must not be able to wedge boot. */
const HANDLE_STORE_TIMEOUT_MS = 3000;

export function isAutosaveSupported(win = globalThis) {
  return typeof win?.showSaveFilePicker === 'function' && Boolean(win?.indexedDB);
}

/**
 * The storage key for this tracker's handle.
 *
 * Every `file://` page shares one storage origin — verified by loading two
 * probe files from different directories and watching the second read the
 * first's keys — so the key must carry the file's own path or two trackers
 * would adopt each other's save target. The fragment is stripped so a deep
 * link resolves to the same file.
 */
export function autosaveTargetKey(win = globalThis) {
  const href = String(win?.location?.href || '');
  const hash = href.indexOf('#');
  return hash === -1 ? href : href.slice(0, hash);
}

/**
 * The name of the file this page was loaded from, if it has one.
 *
 * The picker's suggested name has to be this and not the release filename.
 * Suggesting a name the user does not have turns the Save dialog into a
 * create-a-new-file dialog: they accept the default, autosave writes to that
 * second file forever, and every report of success is true and useless while
 * the file they keep reopening never changes.
 */
export function currentFileName(win = globalThis) {
  try {
    const { pathname } = new URL(String(win?.location?.href || ''));
    const name = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1));
    return /\.html?$/i.test(name) ? name : '';
  } catch {
    return '';
  }
}

export async function ensureWritePermission(handle, { interactive = false } = {}) {
  const descriptor = { mode: 'readwrite' };
  try {
    let state = typeof handle?.queryPermission === 'function'
      ? await handle.queryPermission(descriptor)
      : 'granted';
    if (state === 'granted') return 'granted';
    // Prompting requires transient user activation, so it is only ever
    // attempted from a real click. A background check reports 'prompt' and
    // lets the UI offer a button.
    if (state === 'prompt' && interactive && typeof handle?.requestPermission === 'function') {
      state = await handle.requestPermission(descriptor);
    }
    return state === 'granted' ? 'granted' : state;
  } catch {
    // A handle whose file was moved or deleted throws here.
    return 'denied';
  }
}

export async function writeHtmlToHandle(handle, html) {
  const contents = String(html ?? '');
  if (!contents) {
    throw new Error('Autosave refused: refusing to write an empty file over your tracker.');
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(contents);
  } catch (error) {
    // Abandon the swap file. Without this it could still be committed.
    try { await writable.abort?.(); } catch { /* already gone */ }
    throw error;
  }
  await writable.close();
}

export async function pickAutosaveTarget(win = globalThis, suggestedName = 'Project-Command-Center.html') {
  return win.showSaveFilePicker({
    suggestedName,
    types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }]
  });
}

/**
 * Persists the handle so the tracker remembers its own file across reloads.
 *
 * Handles are not JSON, so IndexedDB is the only place they can go. Every
 * operation is time-boxed: under some headless configurations `open()` never
 * fires any event at all, and a silent hang at boot would be worse than
 * simply not remembering the file.
 */
export function createHandleStore({ indexedDB: idb = globalThis.indexedDB, key } = {}) {
  const withTimeout = (promise) => Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('IndexedDB did not respond.')), HANDLE_STORE_TIMEOUT_MS))
  ]);

  const openDb = () => new Promise((resolve, reject) => {
    if (!idb) {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const request = idb.open(AUTOSAVE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE_NAME)) {
        db.createObjectStore(AUTOSAVE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed.'));
    request.onblocked = () => reject(new Error('IndexedDB is blocked.'));
  });

  const run = async (mode, action) => {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(AUTOSAVE_STORE_NAME, mode);
        const request = action(tx.objectStore(AUTOSAVE_STORE_NAME));
        tx.oncomplete = () => resolve(request ? request.result : undefined);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed.'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted.'));
      });
    } finally {
      db.close?.();
    }
  };

  return {
    async load() {
      try {
        return (await withTimeout(run('readonly', store => store.get(key)))) || null;
      } catch {
        return null;
      }
    },
    async save(handle) {
      try {
        await withTimeout(run('readwrite', store => store.put(handle, key)));
        return true;
      } catch {
        return false;
      }
    },
    async clear() {
      try {
        await withTimeout(run('readwrite', store => store.delete(key)));
        return true;
      } catch {
        return false;
      }
    }
  };
}

/**
 * Debounces edits into writes.
 *
 * The tracker embeds its images, so a saved file can be tens of megabytes.
 * Writing on every keystroke would be unusable; the scheduler coalesces a
 * burst into one write, and never runs two writes concurrently. An edit that
 * arrives mid-write is remembered and produces exactly one follow-up.
 */
export function createAutosaveScheduler({
  write,
  delayMs = AUTOSAVE_DELAY_MS,
  onStatus = () => {},
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  let timer = null;
  let queued = false;
  let inFlight = null;

  const report = (state, extra = {}) => {
    try { onStatus({ state, ...extra }); } catch { /* a broken listener must not stop saving */ }
  };

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeoutImpl(timer);
      timer = null;
    }
  };

  const runWrite = () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        while (queued) {
          queued = false;
          report('writing');
          await write();
          report('saved');
        }
      } catch (error) {
        // Keep `queued` false: a retry loop against a revoked permission or a
        // deleted file would spin forever. The next edit schedules a new try.
        report('error', { message: error?.message || String(error), error });
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  };

  return {
    schedule() {
      queued = true;
      report('pending');
      clearTimer();
      timer = setTimeoutImpl(() => { timer = null; runWrite(); }, delayMs);
    },
    /** Writes now. Used when the page is closing, where a debounce would lose data. */
    async flush() {
      clearTimer();
      if (!queued && !inFlight) return;
      await runWrite();
    },
    cancel() {
      clearTimer();
      queued = false;
    },
    isPending() {
      return queued || inFlight !== null;
    }
  };
}
