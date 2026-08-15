import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Reads the artifact built once by tests/global-setup.js.
 *
 * Tests must never build it themselves: parallel workers writing the same
 * output path race with each other.
 */
let cached = null;

export async function getBuiltArtifact() {
  if (cached) return cached;

  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const appVersion = packageJson.version;
  const path = join('dist', `Project-Command-Center-v${appVersion}.html`);
  const html = await readFile(path, 'utf8');

  if (!html.includes('__PCC_DATA_START__')) {
    throw new Error(`${path} has no Data Capsule region; the global build did not run.`);
  }

  cached = { path, appVersion, html };
  return cached;
}
