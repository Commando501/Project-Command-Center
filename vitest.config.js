import { defineConfig } from 'vitest/config';

// The great majority of this codebase is pure and must behave identically in
// Node and in a browser. Running everything through jsdom buys nothing and
// costs determinism, so `node` is the default and DOM-dependent test files opt
// in individually with a `// @vitest-environment jsdom` docblock.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    restoreMocks: true,
    include: ['tests/**/*.test.js'],
    // Builds the standalone artifact once, before any worker starts. Suites
    // read it through tests/helpers/built-artifact.js and never build their
    // own, because parallel workers writing the same output path race.
    globalSetup: ['tests/global-setup.js']
  }
});
