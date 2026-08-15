/**
 * Capture of the application's own HTML source.
 *
 * The running page is the only copy of its own App Shell, so "Save Updated
 * HTML" reconstructs the file by re-serializing the document and swapping the
 * Data Capsule region.
 *
 * TIMING IS LOAD-BEARING: the capture must happen before anything mutates the
 * DOM. Once `render()` has run, the document contains rendered project cards,
 * and once the update banner has been inserted it contains that too. Capturing
 * late would bake all of it into every saved file, growing without bound.
 * `captureShell()` therefore refuses to run twice.
 */

let capturedShell = null;

export function captureShell(documentRef = document) {
  if (capturedShell !== null) {
    throw new Error('The application shell was already captured.');
  }
  capturedShell = '<!DOCTYPE html>\n' + documentRef.documentElement.outerHTML;
  return capturedShell;
}

export function getCapturedShell() {
  if (capturedShell === null) {
    throw new Error('The application shell was never captured.');
  }
  return capturedShell;
}

export function hasCapturedShell() {
  return capturedShell !== null;
}

/** Test-only. The real application captures exactly once, at boot. */
export function resetCapturedShellForTests() {
  capturedShell = null;
}
