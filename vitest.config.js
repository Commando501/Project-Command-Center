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
    include: ['tests/**/*.test.js']
  }
});
