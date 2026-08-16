import { readFile } from 'node:fs/promises';

import { extractDataFromHtml } from '../src/persistence/extract.js';

/**
 * Refuses to let a build destroy a tracker that holds user data.
 *
 * The build writes one fixed filename into `dist/`, and `dist/` is gitignored.
 * If someone keeps their working tracker at that path — which is an easy habit
 * to fall into, since it is where the build puts the file they then start
 * using — the next build silently replaces their projects with an empty
 * capsule and there is no version history to recover from. That happened on
 * 2026-08-15 and cost six projects, recovered only because a JSON backup
 * happened to exist.
 *
 * The guard is deliberately narrow: it blocks only when the file it is about
 * to replace demonstrably contains projects. A fresh checkout, a CI run, and
 * the ordinary rebuild-after-edit loop all see zero projects and proceed.
 */

/** How many projects the file at this path would lose. Zero if it is not a readable tracker. */
export function countEmbeddedProjects(html) {
  try {
    const { capsule } = extractDataFromHtml(String(html || ''));
    return Array.isArray(capsule?.projects) ? capsule.projects.length : 0;
  } catch {
    // Not a tracker we can read: a partial build, a stray file, or garbage.
    // There is no identifiable user data to protect, so do not block.
    return 0;
  }
}

export async function assertSafeToOverwrite(targetPath, {
  allowOverwrite = process.env.PCC_ALLOW_OVERWRITE === '1'
} = {}) {
  let existing;
  try {
    existing = await readFile(targetPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { overwriting: false, projectCount: 0 };
    throw error;
  }

  const projectCount = countEmbeddedProjects(existing);
  if (projectCount > 0 && !allowOverwrite) {
    const plural = projectCount === 1 ? 'project' : 'projects';
    throw new Error(
      `Refusing to overwrite ${targetPath}\n`
      + `\n`
      + `  That file contains ${projectCount} ${plural}. It is someone's tracker, not a\n`
      + `  build artifact, and dist/ is gitignored — overwriting it destroys the data\n`
      + `  with nothing to restore from.\n`
      + `\n`
      + `  Do one of these first:\n`
      + `    - move the file somewhere outside dist/, which is where a working\n`
      + `      tracker should live anyway, since every build reuses this filename\n`
      + `    - open it and use Export JSON Backup, then move it\n`
      + `    - set PCC_ALLOW_OVERWRITE=1 if the data really is expendable\n`
    );
  }

  return { overwriting: true, projectCount };
}
