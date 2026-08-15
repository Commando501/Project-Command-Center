import { buildStandalone } from '../scripts/build-standalone.mjs';

/**
 * Builds the standalone artifact exactly once, before any test worker starts.
 *
 * Six suites need the built file. When each built its own copy they all wrote
 * the same path from parallel workers, so one worker could read a file another
 * was midway through writing — an intermittent failure that showed up as
 * "found 0 start and 0 end markers" across an entire suite.
 *
 * Building here also removes five redundant esbuild runs from every test pass.
 */
export async function setup() {
  await buildStandalone();
}
