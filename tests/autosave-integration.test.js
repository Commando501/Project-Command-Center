import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { beforeAll, describe, expect, test } from 'vitest';

import { getBuiltArtifact } from './helpers/built-artifact.js';
import { injectDataCapsuleIntoShell } from '../src/persistence/standalone-export.js';

/**
 * Autosave driven through the real artifact.
 *
 * tests/autosave.test.js covers the pieces in isolation — permission, the
 * write, the scheduler. Nothing covered the wiring: whether a given user
 * action actually reaches the scheduler once autosave is armed. A mutation
 * that skips `markDirty` is invisible to every unit test and silently drops
 * the user's work.
 */

let builtHtml;

const CAPSULE = {
  schemaVersion: 4,
  projects: [{ id: 'p1', name: 'Original Project', contentItems: [] }],
  preferences: {
    checkForUpdatesAutomatically: false,
    updateChannel: 'stable',
    automaticBackupBeforeUpdate: true
  }
};

const IMPORTED_NAME = 'Imported From Backup';

/** A real 1x1 PNG, so the image survives normalization rather than being dropped. */
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const BACKUP_WITH_IMAGE = JSON.stringify({
  exportedAt: '2026-08-01T00:00:00.000Z',
  projectCount: 1,
  projects: [{
    id: 'restored-img',
    name: IMPORTED_NAME,
    status: 'Active',
    priority: 'High',
    notes: 'imported note',
    contentItems: [{
      id: 'img1',
      type: 'image',
      src: PNG_DATA_URL,
      caption: 'imported image',
      filename: 'dot.png',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      sizeBytes: 70
    }]
  }]
});

const BACKUP_JSON = JSON.stringify({
  exportedAt: '2026-08-01T00:00:00.000Z',
  projectCount: 1,
  projects: [{
    id: 'restored-1',
    name: IMPORTED_NAME,
    status: 'Active',
    priority: 'High',
    progress: 40,
    contentItems: [{ id: 'r1', type: 'task', text: 'restored task', completed: false }]
  }]
});

/**
 * Enough of IndexedDB for the handle store, so a test can start with a handle
 * already remembered from a previous session.
 */
function createFakeIndexedDb(seed = new Map()) {
  return {
    open() {
      const request = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      request.result = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => {},
        transaction() {
          const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
          const done = () => queueMicrotask(() => tx.oncomplete?.());
          tx.objectStore = () => ({
            get(key) { const result = { result: seed.get(key) }; done(); return result; },
            put(value, key) { seed.set(key, value); done(); return { result: undefined }; },
            delete(key) { seed.delete(key); done(); return { result: undefined }; }
          });
          return tx;
        },
        close() {}
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
  };
}

function boot({
  capsule = CAPSULE,
  rememberedPermission = null,
  html = null,
  pickedName = 'Project-Command-Center.html',
  url = 'file:///Project-Command-Center.html'
} = {}) {
  // `html` reopens bytes autosave produced, rather than building a fresh shell.
  const configured = html || injectDataCapsuleIntoShell(builtHtml, capsule);
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});

  /** Every byte autosave has committed, in order. */
  const writes = [];
  /** Whatever was handed to showSaveFilePicker. */
  const pickerOptions = [];

  const dom = new JSDOM(configured, {
    runScripts: 'dangerously',
    url,
    virtualConsole,
    beforeParse(window) {
      window.TextDecoder = TextDecoder;
      window.TextEncoder = TextEncoder;
      window.fetch = () => Promise.reject(new Error('offline'));
      window.confirm = () => true;
      window.URL.createObjectURL = () => 'blob:stub';
      window.URL.revokeObjectURL = () => {};
      window.HTMLDialogElement.prototype.showModal = function showModal() {
        this.setAttribute('open', '');
      };
      window.HTMLDialogElement.prototype.close = function close() {
        this.removeAttribute('open');
      };
      if (!window.Blob.prototype.text) {
        window.Blob.prototype.text = function text() {
          return new Promise((resolve, reject) => {
            const reader = new window.FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsText(this);
          });
        };
      }

      const makeHandle = (permission = 'granted', name = 'Tracker.html') => ({
        name,
        queryPermission: async () => permission,
        requestPermission: async () => 'granted',
        createWritable: async () => ({
          write: async (contents) => { writes.push(String(contents)); },
          close: async () => {},
          abort: async () => {}
        })
      });

      // Truthy so `isAutosaveSupported` passes. Without `rememberedPermission`
      // there is no `open`, so the handle store fails fast rather than waiting
      // out its timeout; remembering a handle is opt-in per test.
      window.indexedDB = rememberedPermission
        ? createFakeIndexedDb(new Map([
          ['file:///Project-Command-Center.html', makeHandle(rememberedPermission)]
        ]))
        : {};

      window.showSaveFilePicker = async (options) => {
        pickerOptions.push(options);
        return makeHandle('granted', pickedName);
      };
    }
  });

  return { dom, window: dom.window, document: dom.window.document, writes, pickerOptions };
}

const click = (session, id) => session.document.getElementById(id)
  .dispatchEvent(new session.window.Event('click', { bubbles: true }));

async function waitFor(check, { timeout = 6000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting for a condition.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** Turns autosave on and waits for the first committed write. */
async function armAutosave(session) {
  await waitFor(() => !session.document.getElementById('autosaveBtn').classList.contains('hidden'));
  click(session, 'autosaveBtn');
  await waitFor(() => session.writes.length > 0);
}

const selectBackup = (session, json) => {
  const input = session.document.getElementById('backupFileInput');
  const file = new session.window.File([json], 'backup.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new session.window.Event('change', { bubbles: true }));
};

beforeAll(async () => {
  const build = await getBuiltArtifact();
  builtHtml = await readFile(build.path, 'utf8');
}, 120000);

describe('autosave reaches every mutation', () => {
  test('an ordinary edit is written', async () => {
    const session = boot();
    await armAutosave(session);
    const before = session.writes.length;

    const field = session.document.querySelector('[data-inline-field="name"]');
    field.value = 'Renamed By Typing';
    field.dispatchEvent(new session.window.Event('input', { bubbles: true }));

    await waitFor(() => session.writes.length > before);
    expect(session.writes.at(-1)).toContain('Renamed By Typing');
  });

  test('projects restored from a JSON backup are written', async () => {
    const session = boot();
    await armAutosave(session);
    const before = session.writes.length;

    selectBackup(session, BACKUP_JSON);

    // The restore has to land on screen before autosave could carry it.
    await waitFor(() => session.document.body.textContent.includes(IMPORTED_NAME));

    await waitFor(() => session.writes.length > before);
    expect(session.writes.at(-1)).toContain(IMPORTED_NAME);
    expect(session.writes.at(-1)).not.toContain('Original Project');
  });

  test('reopening the autosaved file still shows the imported projects', async () => {
    // The bytes containing the right text is only half of it. What the user
    // actually checks is whether the data is there when the file is opened
    // again, which nothing asserted.
    const session = boot();
    await armAutosave(session);
    const before = session.writes.length;

    selectBackup(session, BACKUP_WITH_IMAGE);
    await waitFor(() => session.writes.length > before);
    const saved = session.writes.at(-1);

    const reopened = boot({ html: saved });
    await waitFor(() => reopened.document.body.textContent.includes(IMPORTED_NAME));

    const img = reopened.document.querySelector('.embedded-image');
    expect(img?.getAttribute('src')).toBe(PNG_DATA_URL);
  });

  test('a restore is written immediately, not after the keystroke debounce', async () => {
    // Coalescing exists for typing. A restore is one deliberate bulk action,
    // and the 1200 ms wait only creates a window in which reloading or closing
    // the page loses every imported project.
    const session = boot();
    await armAutosave(session);
    const before = session.writes.length;

    const started = Date.now();
    selectBackup(session, BACKUP_JSON);
    await waitFor(() => session.writes.length > before);

    expect(Date.now() - started).toBeLessThan(600);
  });

  test('the restore toast does not send the user to a save it does not need', async () => {
    const session = boot();
    await armAutosave(session);

    selectBackup(session, BACKUP_JSON);
    await waitFor(() => session.document.getElementById('toast').textContent.includes('Restored'));

    // Telling someone to press Save Updated HTML while autosave is running
    // teaches them the import was not persisted, which is the opposite of true.
    expect(session.document.getElementById('toast').textContent)
      .not.toContain('Save Updated HTML');
  });
});

describe('choosing which file autosave writes to', () => {
  // The picker used to suggest the release filename. Anyone whose tracker is
  // named anything else got a Save dialog pre-filled with a name they did not
  // have, and clicking Save created a second file. Autosave then wrote to that
  // one forever while the original never changed — and reported success, which
  // was true and useless.

  test('the picker is offered the name of the file already open', async () => {
    const session = boot({ url: 'file:///C:/trackers/My%20Projects.html' });

    await waitFor(() => !session.document.getElementById('autosaveBtn').classList.contains('hidden'));
    click(session, 'autosaveBtn');
    await waitFor(() => session.pickerOptions.length > 0);

    expect(session.pickerOptions[0].suggestedName).toBe('My Projects.html');
  });

  test('autosaving to a file other than the one open says so', async () => {
    const session = boot({
      url: 'file:///C:/trackers/My%20Projects.html',
      pickedName: 'Somewhere-Else.html'
    });
    await armAutosave(session);

    const note = session.document.querySelector('.save-note').textContent;
    expect(note).toContain('Somewhere-Else.html');
    expect(note).toContain('My Projects.html');
    expect(note).toMatch(/not the file you have open/i);
  });

  test('no warning when it is the same file', async () => {
    const session = boot({
      url: 'file:///C:/trackers/My%20Projects.html',
      pickedName: 'My Projects.html'
    });
    await armAutosave(session);

    const note = session.document.querySelector('.save-note').textContent;
    expect(note).not.toMatch(/not the file you have open/i);
  });
});

describe('reopening a tracker whose autosave permission has lapsed', () => {
  // Chrome does not guarantee a stored handle keeps write permission across a
  // browser restart. `queryPermission` then answers 'prompt', and re-granting
  // needs a real click. The file is still remembered, so the tracker looks
  // like the one the user switched autosave on for.

  test('the import is silently not written', async () => {
    const session = boot({ rememberedPermission: 'prompt' });

    await waitFor(() => session.document.getElementById('autosaveBtn').textContent
      .includes('Resume autosave'));

    selectBackup(session, BACKUP_JSON);
    await waitFor(() => session.document.body.textContent.includes(IMPORTED_NAME));

    // Well past the 1200 ms debounce.
    await new Promise(resolve => setTimeout(resolve, 2000));
    expect(session.writes).toHaveLength(0);
  });

  test('the save strip says autosave is paused, not that all data is current', async () => {
    const session = boot({ rememberedPermission: 'prompt' });

    await waitFor(() => session.document.getElementById('autosaveBtn').textContent
      .includes('Resume autosave'));

    const note = session.document.querySelector('.save-note').textContent;
    // It must not read like a tracker that never had autosave, which is what
    // lets an import be typed straight into a file nothing is writing.
    expect(note).toMatch(/paused/i);
    expect(note).toContain('Tracker.html');
    expect(note).not.toMatch(/Autosaving to/i);
  });
});
