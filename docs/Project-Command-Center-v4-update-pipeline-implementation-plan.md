# Project Command Center v4 Update Pipeline Implementation Plan

> **Executed and complete.** All 25 tasks are done and releases 4.0.0 through
> 4.0.6 are published. This is kept as the historical record of how the work
> was sequenced; it is no longer a to-do list, and its unchecked boxes should
> not be read as outstanding work.
>
> Where the plan was wrong at the line-by-line level, the code diverged and the
> reasons are recorded in `Project-Command-Center-v4-as-built.md`. The four
> substantive ones:
>
> 1. **Task 5** says to reject HTML containing multiple copies of a marker.
>    Every genuine v3 file contains two legacy marker regions, so that rule
>    would reject every v3 file in existence. It holds for the v4 markers only.
> 2. **Task 13** pins `X-GitHub-Api-Version: 2026-03-10`. GitHub answers 400
>    for an unrecognised value, so no version header is sent.
> 3. **Task 7's** validation list would abort an update for data v3 itself
>    tolerates, such as a half-typed link URL. Validation splits errors from
>    warnings instead.
> 4. **Tasks 21 and 22** pin `actions/checkout@v6` and `actions/setup-node@v4`.
>    Both were behind; the workflows use v7 and Node 22.
>
> The phase ordering was also changed: the v3 UI port (Task 19) was moved to
> the front, so parity existed before any updater work and every later task ran
> against the real application.

**Goal:** Convert Project Command Center from a hand-maintained standalone HTML into a modular public GitHub project that still ships as one self-contained HTML file and can safely upgrade existing user data through verified GitHub Releases or manual update files.

**Architecture:** Keep user-facing distribution as one standalone HTML, but move development into modular ES modules bundled by a deterministic build script. Treat the current v3 project array as legacy schema 3, introduce a schema-4 Data Capsule with stable injection markers, and route online and manual upgrades through one transactional updater that verifies the candidate shell, clones/migrates/validates user data, then generates a new HTML file without mutating the current one.

**Tech Stack:** HTML5, CSS3, vanilla JavaScript ES modules, Node.js 20+, npm, esbuild, Vitest, jsdom, GitHub Actions, GitHub Releases, Web Crypto SHA-256.

## Global Constraints

- The user-facing artifact remains one self-contained HTML file.
- Runtime operation must not require a database, backend, npm install, browser extension, or external media files.
- Existing v3 files using `/*__PROJECT_DATA_START__*/ ... /*__PROJECT_DATA_END__*/` must remain upgradeable.
- v3 legacy data is treated as **schema 3** for migration purposes.
- v4 introduces a top-level Data Capsule with **schema 4**.
- The permanent v4+ data markers are `/*__PCC_DATA_START__*/` and `/*__PCC_DATA_END__*/`.
- The permanent release metadata markers are `/*__PCC_RELEASE_METADATA_START__*/` and `/*__PCC_RELEASE_METADATA_END__*/`.
- Online update checks are non-blocking and never auto-install.
- Official online updates require SHA-256 verification before migration.
- The GitHub release asset `digest` is used as an independent SHA-256 comparison when present.
- Manual update files are verified against the official GitHub release by tag when network access is available; otherwise they are treated as unverified until future signature support exists.
- Migrations are sequential, one schema version at a time.
- Migration and validation run on a cloned Data Capsule.
- The currently opened HTML file is never overwritten.
- User project data, notes, images, links, tags, tasks, and preferences are never transmitted during update checks.
- Automatic pre-migration backup generation defaults to enabled.
- The stable update channel is the initial default.
- Source development is modular; release output is bundled.
- Release builds fail if repository metadata is unavailable.
- Release publication fails if tests, migrations, build validation, manifest generation, or digest generation fail.

---

## File Structure to Create

```text
project-command-center/
├─ src/
│  ├─ index.html
│  ├─ main.js
│  ├─ styles/
│  │  └─ app.css
│  ├─ app/
│  │  ├─ project-model.js
│  │  ├─ progress.js
│  │  ├─ filters.js
│  │  ├─ render.js
│  │  └─ state.js
│  ├─ content/
│  │  ├─ content-items.js
│  │  ├─ links.js
│  │  └─ images.js
│  ├─ persistence/
│  │  ├─ data-capsule.js
│  │  ├─ extract.js
│  │  └─ standalone-export.js
│  └─ updater/
│     ├─ app-metadata.js
│     ├─ version.js
│     ├─ manifest.js
│     ├─ github-release-client.js
│     ├─ sha256.js
│     ├─ shell-inspector.js
│     ├─ migrations.js
│     ├─ validator.js
│     ├─ update-engine.js
│     └─ update-ui.js
├─ tests/
│  ├─ fixtures/
│  │  ├─ legacy-v3-projects.json
│  │  ├─ schema3-capsule.json
│  │  ├─ schema4-capsule.json
│  │  ├─ release-manifest-valid.json
│  │  └─ release-manifest-invalid.json
│  ├─ project-model.test.js
│  ├─ progress.test.js
│  ├─ data-capsule.test.js
│  ├─ extract.test.js
│  ├─ version.test.js
│  ├─ manifest.test.js
│  ├─ sha256.test.js
│  ├─ shell-inspector.test.js
│  ├─ migrations.test.js
│  ├─ validator.test.js
│  ├─ update-engine.test.js
│  ├─ standalone-export.test.js
│  └─ v3-parity.test.js
├─ scripts/
│  ├─ import-v3-source.mjs
│  ├─ build-standalone.mjs
│  ├─ validate-build.mjs
│  └─ generate-manifest.mjs
├─ dist/
│  └─ .gitkeep
├─ .github/
│  └─ workflows/
│     ├─ ci.yml
│     └─ release.yml
├─ update-manifest.schema.json
├─ package.json
├─ package-lock.json
├─ vitest.config.js
├─ LICENSE
└─ README.md
```

The existing `/mnt/data/Project-Command-Center-v3.html` is the migration/parity reference and must not be edited during repository extraction.

---

# Phase 1 — Establish the Modular Source and Preserve v3 Behavior

### Task 1: Initialize the repository toolchain

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `.gitignore`
- Create: `dist/.gitkeep`

**Interfaces:**
- Produces npm commands used by every later task.
- Produces a jsdom test environment for browser-facing modules.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "project-command-center",
  "version": "4.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "node scripts/build-standalone.mjs",
    "validate:build": "node scripts/validate-build.mjs",
    "manifest": "node scripts/generate-manifest.mjs",
    "release:check": "npm test && npm run build && npm run validate:build"
  },
  "engines": {
    "node": ">=20"
  },
  "devDependencies": {
    "esbuild": "^0.25.0",
    "jsdom": "^26.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    restoreMocks: true
  }
});
```

- [ ] **Step 3: Create `.gitignore`**

```text
node_modules/
dist/*
!dist/.gitkeep
coverage/
.DS_Store
```

- [ ] **Step 4: Install dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and installation exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.js .gitignore dist/.gitkeep
git commit -m "chore: initialize project command center toolchain"
```

---

### Task 2: Define the v4 Data Capsule and legacy v3 adapter

**Files:**
- Create: `src/persistence/data-capsule.js`
- Create: `tests/data-capsule.test.js`
- Create: `tests/fixtures/legacy-v3-projects.json`
- Create: `tests/fixtures/schema4-capsule.json`

**Interfaces:**
- Produces `CURRENT_SCHEMA_VERSION = 4`
- Produces `createDefaultPreferences()`
- Produces `createDataCapsule(projects, preferences?)`
- Produces `normalizeDataCapsule(capsule)`
- Produces `legacyV3ProjectsToSchema3(projects)`

- [ ] **Step 1: Add failing tests for capsule defaults**

```js
import { describe, expect, test } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  createDataCapsule,
  createDefaultPreferences,
  legacyV3ProjectsToSchema3
} from '../src/persistence/data-capsule.js';

describe('data capsule', () => {
  test('v4 capsule carries schema 4 and update defaults', () => {
    const capsule = createDataCapsule([]);
    expect(CURRENT_SCHEMA_VERSION).toBe(4);
    expect(capsule.schemaVersion).toBe(4);
    expect(capsule.preferences).toEqual({
      checkForUpdatesAutomatically: true,
      updateChannel: 'stable',
      automaticBackupBeforeUpdate: true
    });
  });

  test('legacy v3 array is wrapped as inferred schema 3', () => {
    const capsule = legacyV3ProjectsToSchema3([{ id: 'p1', name: 'A' }]);
    expect(capsule.schemaVersion).toBe(3);
    expect(capsule.projects).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/data-capsule.test.js
```

Expected: FAIL because `src/persistence/data-capsule.js` does not exist.

- [ ] **Step 3: Implement the minimal capsule module**

```js
export const CURRENT_SCHEMA_VERSION = 4;

export function createDefaultPreferences() {
  return {
    checkForUpdatesAutomatically: true,
    updateChannel: 'stable',
    automaticBackupBeforeUpdate: true
  };
}

export function createDataCapsule(projects = [], preferences = {}) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    projects: Array.isArray(projects) ? structuredClone(projects) : [],
    preferences: {
      ...createDefaultPreferences(),
      ...structuredClone(preferences || {})
    }
  };
}

export function legacyV3ProjectsToSchema3(projects = []) {
  return {
    schemaVersion: 3,
    projects: Array.isArray(projects) ? structuredClone(projects) : [],
    preferences: {}
  };
}

export function normalizeDataCapsule(capsule) {
  const source = capsule && typeof capsule === 'object' ? capsule : {};
  return {
    schemaVersion: Number.isInteger(source.schemaVersion)
      ? source.schemaVersion
      : CURRENT_SCHEMA_VERSION,
    projects: Array.isArray(source.projects) ? structuredClone(source.projects) : [],
    preferences: {
      ...createDefaultPreferences(),
      ...(source.preferences && typeof source.preferences === 'object'
        ? structuredClone(source.preferences)
        : {})
    }
  };
}
```

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/data-capsule.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/data-capsule.js tests/data-capsule.test.js tests/fixtures
git commit -m "feat: define schema 4 data capsule"
```

---

### Task 3: Extract current v3 project logic into modular source without behavior changes

**Files:**
- Create: `src/app/project-model.js`
- Create: `src/app/progress.js`
- Create: `src/app/filters.js`
- Create: `src/content/content-items.js`
- Create: `src/content/links.js`
- Create: `src/content/images.js`
- Create: `tests/project-model.test.js`
- Create: `tests/progress.test.js`
- Create: `tests/v3-parity.test.js`

**Interfaces:**
- Preserve v3 behavior for `normalizeProject()`, `normalizeContentItem()`, `computeProgress()`, `projectMatchesActiveTags()`, safe HTTP(S) URLs, and image data-URL acceptance.
- Later UI code imports these functions instead of defining them inline.

- [ ] **Step 1: Write parity tests from known v3 behavior**

```js
import { expect, test } from 'vitest';
import { normalizeProject } from '../src/app/project-model.js';
import { computeProgress } from '../src/app/progress.js';

test('three of four tasks produces decimal .75', () => {
  const project = normalizeProject({
    name: 'Test',
    progress: 42,
    status: 'Active',
    contentItems: [
      { type: 'task', text: 'a', completed: true },
      { type: 'task', text: 'b', completed: true },
      { type: 'task', text: 'c', completed: true },
      { type: 'task', text: 'd', completed: false }
    ]
  });

  expect(computeProgress(project)).toBe(42.75);
});

test('complete status is exactly 100', () => {
  const project = normalizeProject({
    name: 'Test',
    progress: 99,
    status: 'Complete',
    contentItems: [{ type: 'task', text: 'a', completed: true }]
  });

  expect(computeProgress(project)).toBe(100);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/project-model.test.js tests/progress.test.js tests/v3-parity.test.js
```

Expected: FAIL because modular source files do not exist.

- [ ] **Step 3: Move pure v3 logic into modules without changing semantics**

Move the existing v3 implementations into focused modules. Keep the v3 regular expression for embedded images restricted to:

```js
/^data:image\/(?:png|jpeg|webp|avif|gif);/i
```

Keep computed progress logic:

```js
export function computeProgress(project) {
  if (project.status === 'Complete') return 100;
  const base = Math.min(99, Math.max(0, Math.trunc(Number(project.progress) || 0)));
  const tasks = (project.contentItems || []).filter(item => item.type === 'task');
  if (!tasks.length) return base;
  const completed = tasks.filter(item => item.completed).length;
  const decimalHundredths = Math.min(
    99,
    Math.max(0, Math.round((completed / tasks.length) * 100))
  );
  return Number((base + decimalHundredths / 100).toFixed(2));
}
```

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/project-model.test.js tests/progress.test.js tests/v3-parity.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app src/content tests/project-model.test.js tests/progress.test.js tests/v3-parity.test.js
git commit -m "refactor: extract v3 project logic into modules"
```

---

### Task 4: Create a deterministic standalone build that reproduces the application shell

**Files:**
- Create: `src/index.html`
- Create: `src/styles/app.css`
- Create: `src/main.js`
- Create: `scripts/build-standalone.mjs`
- Create: `scripts/validate-build.mjs`
- Create: `tests/standalone-export.test.js`

**Interfaces:**
- Produces `dist/Project-Command-Center-v4.0.0.html`
- Produces stable release metadata and Data Capsule markers.
- Consumes `PCC_REPO_SLUG` for release builds; GitHub Actions supplies `${{ github.repository }}`.

- [ ] **Step 1: Write a failing standalone build test**

```js
import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('release HTML contains one data marker pair and one metadata marker pair', async () => {
  const html = await readFile('dist/Project-Command-Center-v4.0.0.html', 'utf8');
  expect((html.match(/__PCC_DATA_START__/g) || [])).toHaveLength(1);
  expect((html.match(/__PCC_DATA_END__/g) || [])).toHaveLength(1);
  expect((html.match(/__PCC_RELEASE_METADATA_START__/g) || [])).toHaveLength(1);
  expect((html.match(/__PCC_RELEASE_METADATA_END__/g) || [])).toHaveLength(1);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npm run build
npx vitest run tests/standalone-export.test.js
```

Expected: build fails or test fails because the build script does not exist.

- [ ] **Step 3: Create the permanent release metadata block**

The build emits:

```js
const APP_METADATA =
/*__PCC_RELEASE_METADATA_START__*/
{
  "appVersion": "4.0.0",
  "schemaVersion": 4,
  "minSchemaVersion": 3,
  "updateChannel": "stable",
  "repository": "owner/repository"
}
/*__PCC_RELEASE_METADATA_END__*/;
```

`repository` is derived from `PCC_REPO_SLUG`. For ordinary local development, use `local/project-command-center`. For `RELEASE_BUILD=1`, fail if `PCC_REPO_SLUG` does not match:

```js
/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
```

- [ ] **Step 4: Create the permanent Data Capsule block**

```js
const EMBEDDED_DATA =
/*__PCC_DATA_START__*/
{
  "schemaVersion": 4,
  "projects": [],
  "preferences": {
    "checkForUpdatesAutomatically": true,
    "updateChannel": "stable",
    "automaticBackupBeforeUpdate": true
  }
}
/*__PCC_DATA_END__*/;
```

- [ ] **Step 5: Bundle JS with esbuild and inline CSS/JS into `src/index.html`**

The build script must:

1. Read version from `package.json`.
2. Bundle `src/main.js` as an IIFE.
3. Read `src/styles/app.css`.
4. Replace explicit template tokens in `src/index.html`.
5. Write `dist/Project-Command-Center-v${version}.html`.
6. Never minify marker comments away.
7. Never fetch runtime dependencies.

- [ ] **Step 6: Add `scripts/validate-build.mjs`**

Validation exits non-zero unless all are true:

```text
Exactly one PCC data marker pair
Exactly one PCC release metadata marker pair
No <script src=...>
No <link rel="stylesheet" href=...>
No unresolved build template tokens
HTML contains current app version
HTML contains schemaVersion 4
```

- [ ] **Step 7: Run and verify GREEN**

```bash
npm run build
npm run validate:build
npx vitest run tests/standalone-export.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/index.html src/styles src/main.js scripts tests/standalone-export.test.js
git commit -m "build: produce standalone versioned html"
```

---

# Phase 2 — Introduce Extraction, Migration, and Shell Injection

### Task 5: Extract Data Capsules from v4+ HTML and legacy v3 HTML

**Files:**
- Create: `src/persistence/extract.js`
- Create: `tests/extract.test.js`
- Create: `tests/fixtures/schema3-capsule.json`

**Interfaces:**
- Produces `extractDataFromHtml(html)`
- Produces return shape `{ sourceFormat, capsule }`
- Supports `sourceFormat: 'pcc-data' | 'legacy-v3'`

- [ ] **Step 1: Write failing tests**

```js
import { expect, test } from 'vitest';
import { extractDataFromHtml } from '../src/persistence/extract.js';

test('extracts v4 PCC data marker', () => {
  const html = `
    <script>
    const EMBEDDED_DATA =
    /*__PCC_DATA_START__*/{"schemaVersion":4,"projects":[],"preferences":{}}/*__PCC_DATA_END__*/;
    </script>`;
  const result = extractDataFromHtml(html);
  expect(result.sourceFormat).toBe('pcc-data');
  expect(result.capsule.schemaVersion).toBe(4);
});

test('extracts legacy v3 project array as schema 3', () => {
  const html = `
    <script>
    const EMBEDDED_PROJECTS =
    /*__PROJECT_DATA_START__*/[{"id":"p1","name":"Legacy"}]/*__PROJECT_DATA_END__*/;
    </script>`;
  const result = extractDataFromHtml(html);
  expect(result.sourceFormat).toBe('legacy-v3');
  expect(result.capsule.schemaVersion).toBe(3);
  expect(result.capsule.projects[0].name).toBe('Legacy');
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/extract.test.js
```

Expected: FAIL because extractor does not exist.

- [ ] **Step 3: Implement marker extraction with strict JSON parsing**

Do not execute JavaScript from candidate HTML. Extract only the JSON text between known marker comments and pass it to `JSON.parse`.

Reject:

- Missing closing marker.
- Multiple copies of the same marker.
- Non-JSON marker content.
- HTML with neither supported marker format.

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/extract.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/extract.js tests/extract.test.js tests/fixtures/schema3-capsule.json
git commit -m "feat: extract current and legacy data capsules"
```

---

### Task 6: Implement schema 3 → 4 migration and migration chain

**Files:**
- Create: `src/updater/migrations.js`
- Create: `tests/migrations.test.js`

**Interfaces:**
- Produces `MIGRATIONS`
- Produces `migrateSchema3To4(data)`
- Produces `migrateToSchema(capsule, targetSchema)`

- [ ] **Step 1: Write failing migration tests**

```js
import { expect, test } from 'vitest';
import {
  migrateSchema3To4,
  migrateToSchema
} from '../src/updater/migrations.js';

test('schema 3 becomes schema 4 without losing projects or image data', () => {
  const input = {
    schemaVersion: 3,
    projects: [{
      id: 'p1',
      name: 'Image Project',
      contentItems: [{
        id: 'i1',
        type: 'image',
        src: 'data:image/webp;base64,AAAA',
        caption: 'Prototype',
        displayWidth: 640
      }]
    }],
    preferences: {}
  };

  const output = migrateSchema3To4(input);

  expect(output.schemaVersion).toBe(4);
  expect(output.projects[0].contentItems[0].src).toBe('data:image/webp;base64,AAAA');
  expect(output.projects[0].contentItems[0].displayWidth).toBe(640);
  expect(output.preferences.updateChannel).toBe('stable');
});

test('migration does not mutate input', () => {
  const input = { schemaVersion: 3, projects: [], preferences: {} };
  const snapshot = structuredClone(input);
  migrateToSchema(input, 4);
  expect(input).toEqual(snapshot);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/migrations.test.js
```

Expected: FAIL because migration module does not exist.

- [ ] **Step 3: Implement migration registry**

```js
import { createDefaultPreferences } from '../persistence/data-capsule.js';

export function migrateSchema3To4(input) {
  const source = structuredClone(input);
  return {
    schemaVersion: 4,
    projects: Array.isArray(source.projects) ? source.projects : [],
    preferences: {
      ...createDefaultPreferences(),
      ...(source.preferences || {})
    }
  };
}

export const MIGRATIONS = new Map([
  [3, migrateSchema3To4]
]);

export function migrateToSchema(capsule, targetSchema) {
  let working = structuredClone(capsule);

  while (working.schemaVersion < targetSchema) {
    const migrate = MIGRATIONS.get(working.schemaVersion);
    if (!migrate) {
      throw new Error(`No migration registered for schema ${working.schemaVersion}`);
    }
    working = migrate(working);
  }

  if (working.schemaVersion !== targetSchema) {
    throw new Error(`Cannot migrate schema ${capsule.schemaVersion} to ${targetSchema}`);
  }

  return working;
}
```

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/migrations.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updater/migrations.js tests/migrations.test.js
git commit -m "feat: add sequential schema migration engine"
```

---

### Task 7: Validate migrated Data Capsules before export

**Files:**
- Create: `src/updater/validator.js`
- Create: `tests/validator.test.js`

**Interfaces:**
- Produces `validateDataCapsule(capsule)`
- Returns `{ valid: true, errors: [] }` or `{ valid: false, errors: string[] }`

- [ ] **Step 1: Write failing validation tests**

Cover:

```text
schemaVersion must equal target
projects must be an array
project IDs must be non-empty
contentItems must be an array when present
image src must use allowed embedded image MIME pattern
link URL must be blank or HTTP(S)
preferences.updateChannel must be stable, beta, or development
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/validator.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement pure validation**

Validation must collect all errors rather than throw on the first malformed field.

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/validator.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updater/validator.js tests/validator.test.js
git commit -m "feat: validate migrated project data"
```

---

### Task 8: Inject migrated data into a verified new shell

**Files:**
- Create: `src/persistence/standalone-export.js`
- Extend: `tests/standalone-export.test.js`

**Interfaces:**
- Produces `injectDataCapsuleIntoShell(shellHtml, capsule)`
- Produces `serializeForEmbeddedJson(value)`

- [ ] **Step 1: Add failing injection tests**

```js
import { expect, test } from 'vitest';
import { injectDataCapsuleIntoShell } from '../src/persistence/standalone-export.js';

test('injection replaces only PCC data region', () => {
  const shell = `
  <script>
  const APP_METADATA =
  /*__PCC_RELEASE_METADATA_START__*/{"appVersion":"4.1.0","schemaVersion":4,"minSchemaVersion":3}/*__PCC_RELEASE_METADATA_END__*/;
  const EMBEDDED_DATA =
  /*__PCC_DATA_START__*/{"schemaVersion":4,"projects":[]}/*__PCC_DATA_END__*/;
  </script>`;

  const result = injectDataCapsuleIntoShell(shell, {
    schemaVersion: 4,
    projects: [{ id: 'p1', name: 'Preserved' }],
    preferences: {}
  });

  expect(result).toContain('"name": "Preserved"');
  expect(result).toContain('"appVersion":"4.1.0"');
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/standalone-export.test.js
```

Expected: FAIL because injection helper is missing.

- [ ] **Step 3: Implement strict single-region replacement**

Reject shells with zero or multiple PCC data marker pairs.

Escape `<`, U+2028, and U+2029 in serialized JSON before injection.

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/standalone-export.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/persistence/standalone-export.js tests/standalone-export.test.js
git commit -m "feat: inject migrated data into release shell"
```

---

# Phase 3 — Versioning, Manifest, and Integrity

### Task 9: Implement semantic version comparison

**Files:**
- Create: `src/updater/version.js`
- Create: `tests/version.test.js`

**Interfaces:**
- Produces `parseSemver(version)`
- Produces `compareSemver(a, b)`
- Produces `isNewerVersion(candidate, installed)`

- [ ] **Step 1: Write failing tests**

Test:

```text
4.1.0 > 4.0.9
4.0.0 == 4.0.0
4.0.0 < 5.0.0
v4.1.0 is accepted after stripping leading v
malformed versions are rejected
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/version.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement strict three-component semantic versions**

Do not add prerelease precedence until beta channel implementation needs it. Stable releases use numeric `MAJOR.MINOR.PATCH`.

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/version.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updater/version.js tests/version.test.js
git commit -m "feat: compare application versions"
```

---

### Task 10: Validate update manifests

**Files:**
- Create: `src/updater/manifest.js`
- Create: `tests/manifest.test.js`
- Create: `tests/fixtures/release-manifest-valid.json`
- Create: `tests/fixtures/release-manifest-invalid.json`
- Create: `update-manifest.schema.json`

**Interfaces:**
- Produces `validateUpdateManifest(manifest)`
- Produces `normalizeSha256(value)`

- [ ] **Step 1: Write failing tests**

Required manifest:

```json
{
  "formatVersion": 1,
  "appVersion": "4.1.0",
  "schemaVersion": 4,
  "minSchemaVersion": 3,
  "channel": "stable",
  "assetName": "Project-Command-Center-v4.1.0.html",
  "sha256": "64-lowercase-hex-characters",
  "publishedAt": "2026-08-14T22:00:00Z",
  "releaseNotes": []
}
```

Tests reject:

```text
missing appVersion
unsupported formatVersion
invalid channel
schemaVersion below minSchemaVersion
invalid hash length
assetName not ending in .html
invalid publishedAt
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/manifest.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement validation**

`normalizeSha256()` accepts either:

```text
abcdef...
sha256:abcdef...
```

and returns the 64-character lowercase hex digest.

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/manifest.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updater/manifest.js tests/manifest.test.js tests/fixtures update-manifest.schema.json
git commit -m "feat: validate release update manifests"
```

---

### Task 11: Implement SHA-256 verification

**Files:**
- Create: `src/updater/sha256.js`
- Create: `tests/sha256.test.js`

**Interfaces:**
- Produces `sha256Hex(input)`
- Produces `verifySha256(input, expectedDigest)`

- [ ] **Step 1: Write failing tests using known bytes**

```js
import { expect, test } from 'vitest';
import { sha256Hex, verifySha256 } from '../src/updater/sha256.js';

test('computes known SHA-256', async () => {
  const digest = await sha256Hex(new TextEncoder().encode('abc'));
  expect(digest).toBe(
    'ba7816bf8f01cfea414140de5dae2223' +
    'b00361a396177a9cb410ff61f20015ad'
  );
});

test('detects mismatch', async () => {
  await expect(
    verifySha256(new TextEncoder().encode('abc'), '0'.repeat(64))
  ).resolves.toBe(false);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/sha256.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement with Web Crypto**

Use:

```js
const digest = await crypto.subtle.digest('SHA-256', bytes);
```

Do not implement a custom cryptographic hash.

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/sha256.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updater/sha256.js tests/sha256.test.js
git commit -m "feat: verify release sha256 digests"
```

---

### Task 12: Inspect candidate release shells without executing them

**Files:**
- Create: `src/updater/shell-inspector.js`
- Create: `tests/shell-inspector.test.js`

**Interfaces:**
- Produces `inspectReleaseShell(html)`
- Returns parsed metadata plus marker-count validation.

- [ ] **Step 1: Write failing tests**

Inspect metadata only from the release metadata marker. Do not evaluate candidate `<script>` code.

Reject:

```text
missing metadata marker
multiple metadata marker pairs
missing PCC data marker
candidate schema lower than min schema
non-JSON metadata
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/shell-inspector.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement marker-based metadata parsing**

Return:

```js
{
  appVersion,
  schemaVersion,
  minSchemaVersion,
  updateChannel,
  repository
}
```

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/shell-inspector.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updater/shell-inspector.js tests/shell-inspector.test.js
git commit -m "feat: inspect update shells safely"
```

---

# Phase 4 — GitHub Release Update Channel

### Task 13: Implement the public GitHub release client

**Files:**
- Create: `src/updater/github-release-client.js`
- Create: `tests/github-release-client.test.js`

**Interfaces:**
- Produces `getLatestStableRelease(repository, fetchImpl = fetch)`
- Produces `getReleaseByTag(repository, tag, fetchImpl = fetch)`
- Produces `findReleaseAsset(release, name)`

- [ ] **Step 1: Write failing tests using injected fetch**

Test that the client requests:

```text
https://api.github.com/repos/{owner}/{repo}/releases/latest
```

and sends:

```text
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2026-03-10
```

Test that no Data Capsule or project content is included in headers, URL parameters, or request body.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/github-release-client.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement release fetching**

For public repositories, make unauthenticated GET requests.

`findReleaseAsset()` returns:

```js
{
  name,
  browser_download_url,
  size,
  digest
}
```

for the named release asset.

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/github-release-client.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updater/github-release-client.js tests/github-release-client.test.js
git commit -m "feat: check public github releases"
```

---

### Task 14: Implement online update discovery

**Files:**
- Create: `src/updater/app-metadata.js`
- Extend: `src/updater/github-release-client.js`
- Extend: `tests/github-release-client.test.js`
- Create: `tests/update-engine.test.js`

**Interfaces:**
- Produces `checkForOnlineUpdate({ appMetadata, preferences, fetchImpl })`
- Returns one of:
  - `{ status: 'current' }`
  - `{ status: 'available', release, manifest, htmlAsset }`
  - `{ status: 'incompatible', reason }`
  - `{ status: 'error', error }`

- [ ] **Step 1: Write failing discovery tests**

Required behavior:

1. Fetch latest stable GitHub Release.
2. Find `update-manifest.json`.
3. Fetch and validate the manifest.
4. Compare `manifest.appVersion` with installed app version.
5. Require installed schema `>= manifest.minSchemaVersion`.
6. Find the HTML asset named by `manifest.assetName`.
7. Return `available` only when all checks pass.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/update-engine.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement discovery without downloading the HTML asset yet**

Update checking remains lightweight. The HTML asset is downloaded only after explicit user installation approval.

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/update-engine.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updater/app-metadata.js src/updater/github-release-client.js tests
git commit -m "feat: discover compatible github updates"
```

---

# Phase 5 — Transactional Update Engine

### Task 15: Build official online update verification and migration

**Files:**
- Create: `src/updater/update-engine.js`
- Extend: `tests/update-engine.test.js`

**Interfaces:**
- Produces `prepareOfficialUpdate({ currentCapsule, manifest, htmlAsset, fetchImpl })`
- Returns:
```js
{
  shellHtml,
  migratedCapsule,
  backup,
  outputHtml,
  report
}
```

- [ ] **Step 1: Add failing success-path test**

Test pipeline:

```text
download release HTML bytes
compute SHA-256
compare manifest sha256
compare GitHub asset digest when present
inspect shell
verify shell version matches manifest
verify shell schema matches manifest
clone current capsule
migrate to target schema
validate migrated capsule
inject into shell
produce backup JSON
produce output HTML
```

- [ ] **Step 2: Add failing abort tests**

Reject and produce no `outputHtml` for:

```text
manifest hash mismatch
GitHub asset digest mismatch
shell appVersion mismatch
shell schema mismatch
installed schema below minSchemaVersion
missing migration
migration exception
validation failure
```

- [ ] **Step 3: Run and verify RED**

```bash
npx vitest run tests/update-engine.test.js
```

Expected: FAIL.

- [ ] **Step 4: Implement the transaction pipeline**

The function must never mutate `currentCapsule`.

`backup` shape:

```js
{
  backupFormatVersion: 1,
  backedUpAt: "ISO_TIMESTAMP",
  sourceAppVersion: "4.0.0",
  data: { ...cloned capsule... }
}
```

- [ ] **Step 5: Run and verify GREEN**

```bash
npx vitest run tests/update-engine.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/updater/update-engine.js tests/update-engine.test.js
git commit -m "feat: add transactional official updater"
```

---

### Task 16: Implement manual/offline update inspection and trust states

**Files:**
- Extend: `src/updater/update-engine.js`
- Extend: `src/updater/shell-inspector.js`
- Extend: `tests/update-engine.test.js`

**Interfaces:**
- Produces `inspectManualUpdate(fileBytes, { repository, fetchImpl, online })`
- Trust states:
  - `verified-official`
  - `unverified-offline`
  - `verification-failed`

- [ ] **Step 1: Add failing tests**

Behavior:

### Online manual file
1. Inspect candidate shell metadata.
2. Fetch GitHub release by exact tag `v${appVersion}`.
3. Find matching HTML asset.
4. Compute local selected-file SHA-256.
5. Compare against GitHub asset `digest`.
6. Return `verified-official` only on match.

### Offline manual file
1. Inspect candidate shell metadata.
2. Do not claim official verification.
3. Return `unverified-offline`.
4. Allow migration only after caller provides explicit confirmation.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/update-engine.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement trust-state logic**

Never downgrade `verification-failed` into the generic unverified state. A known mismatch is a hard failure.

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/update-engine.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updater tests/update-engine.test.js
git commit -m "feat: support verified and offline manual updates"
```

---

# Phase 6 — Update UI and Persistent Preferences

### Task 17: Add update settings and non-blocking startup check

**Files:**
- Create: `src/updater/update-ui.js`
- Modify: `src/main.js`
- Modify: `src/styles/app.css`
- Create: `tests/update-ui.test.js`

**Interfaces:**
- Consumes `checkForOnlineUpdate()`
- Produces startup banner and update settings panel.
- Persists settings in `EMBEDDED_DATA.preferences`.

- [ ] **Step 1: Write failing UI tests**

Verify:

```text
automatic checks run only when preference is true
normal app render occurs before update network completion
available update shows banner
network failure does not block project rendering
banner does not start installation
manual update input accepts .html files
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/update-ui.test.js
```

Expected: FAIL.

- [ ] **Step 3: Add Updates settings UI**

Include:

```text
Current app version
Current schema version
Automatic update checks toggle
Update channel selector
Automatic backup toggle
Last check timestamp
Check for Updates button
Install Update From File button
Export Data Backup button
```

- [ ] **Step 4: Add non-intrusive update banner**

Banner:

```text
Project Command Center 4.1.0 is available
[View Update] [Dismiss]
```

Dismissal is session-only unless later requirements specify persistent dismissal.

- [ ] **Step 5: Run and verify GREEN**

```bash
npx vitest run tests/update-ui.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main.js src/updater/update-ui.js src/styles/app.css tests/update-ui.test.js
git commit -m "feat: add update settings and availability banner"
```

---

### Task 18: Add update review, backup, and result workflow

**Files:**
- Extend: `src/updater/update-ui.js`
- Extend: `src/styles/app.css`
- Extend: `tests/update-ui.test.js`

**Interfaces:**
- Consumes official/manual update preparation results.
- Produces downloadable backup and upgraded HTML blobs.

- [ ] **Step 1: Add failing interaction tests**

Review panel must show:

```text
installed app version
candidate app version
current schema
target schema
compatibility status
release notes
asset size
verification status
```

Official installation button remains disabled until verification succeeds.

Offline unverified manual update requires a distinct confirmation action.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/update-ui.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement result generation**

After successful preparation, show:

```text
Update ready
Old version
New version
Schema migration
Projects migrated
Embedded images preserved
```

Provide:

```text
[Download Data Backup]
[Download Updated HTML]
```

The backup Blob is generated before migration begins and retained in memory for download.

The upgraded file name is:

```text
Project-Command-Center-v{appVersion}.html
```

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/update-ui.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/updater/update-ui.js src/styles/app.css tests/update-ui.test.js
git commit -m "feat: add update review backup and download flow"
```

---

# Phase 7 — Integrate v3 Projects into the New Modular App

### Task 19: Port the complete v3 UI and media behavior to modular source

**Files:**
- Create/modify: `src/app/render.js`
- Create/modify: `src/app/state.js`
- Modify: `src/main.js`
- Modify: `src/styles/app.css`
- Extend: `tests/v3-parity.test.js`

**Interfaces:**
- Must preserve all v3 user-facing capabilities:
  - inline project editing
  - tag AND filtering
  - task/bullet/link/image blocks
  - image optimization
  - image resize display state
  - Save Updated HTML
  - JSON backup
  - lightbox
  - progress decimals
  - mobile layout behavior

- [ ] **Step 1: Add parity tests for existing features**

At minimum test data behavior for:

```text
inline field update persists
tag AND filter
task decimal progress
bullet excluded from progress
link sanitization
image displayWidth persistence
image source survives export
v3 cleanProjectsForExport semantics
```

- [ ] **Step 2: Run against incomplete modular app and verify RED**

```bash
npx vitest run tests/v3-parity.test.js
```

Expected: FAIL until the full v3 behavior is ported.

- [ ] **Step 3: Move v3 UI code into modules**

Do not change user-visible behavior while moving it.

Change v4 Save Updated HTML so it serializes the whole `EMBEDDED_DATA` capsule rather than only the projects array.

- [ ] **Step 4: Run parity and full unit suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Build and validate standalone artifact**

```bash
npm run build
npm run validate:build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "refactor: port v3 application into modular v4 shell"
```

---

# Phase 8 — Release Build and GitHub Automation

### Task 20: Generate release manifest from the exact built HTML

**Files:**
- Create: `scripts/generate-manifest.mjs`
- Extend: `update-manifest.schema.json`
- Create: `tests/manifest-generation.test.js`

**Interfaces:**
- Input: exact built standalone HTML.
- Output: `dist/update-manifest.json`.

- [ ] **Step 1: Write failing generation test**

Run generator against a known HTML fixture and verify:

```text
appVersion equals embedded release metadata
schemaVersion equals embedded release metadata
minSchemaVersion equals embedded release metadata
assetName equals actual filename
sha256 equals hash of exact HTML bytes
publishedAt is valid ISO timestamp
channel equals stable
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run tests/manifest-generation.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement generator**

Use Node's built-in `crypto.createHash('sha256')` for build-time digest generation.

Do not modify the HTML after calculating the digest.

- [ ] **Step 4: Run and verify GREEN**

```bash
npx vitest run tests/manifest-generation.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-manifest.mjs update-manifest.schema.json tests/manifest-generation.test.js
git commit -m "build: generate signed-ready release manifest"
```

---

### Task 21: Add continuous integration

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Runs on pushes and pull requests.
- Uses the same commands required locally.

- [ ] **Step 1: Create workflow**

```yaml
name: CI

on:
  push:
    branches: ["main"]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm test
      - run: npm run build
        env:
          PCC_REPO_SLUG: ${{ github.repository }}
      - run: npm run validate:build
```

- [ ] **Step 2: Validate workflow syntax locally with a YAML parser or GitHub after first push**

Expected: workflow loads and all commands use scripts that already pass locally.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: test and validate standalone build"
```

---

### Task 22: Add tagged GitHub Release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Trigger: pushed tags matching `v*.*.*`
- Produces a GitHub Release with:
  - versioned HTML
  - `update-manifest.json`

- [ ] **Step 1: Create release workflow**

```yaml
name: Release

on:
  push:
    tags:
      - "v*.*.*"

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - run: npm ci

      - run: npm test

      - run: npm run build
        env:
          RELEASE_BUILD: "1"
          PCC_REPO_SLUG: ${{ github.repository }}

      - run: npm run validate:build

      - run: npm run manifest
        env:
          PCC_REPO_SLUG: ${{ github.repository }}

      - name: Verify tag matches package version
        run: |
          VERSION=$(node -p "require('./package.json').version")
          test "${GITHUB_REF_NAME}" = "v${VERSION}"

      - name: Create release and upload artifacts
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          VERSION=$(node -p "require('./package.json').version")
          gh release create "v${VERSION}" \
            "dist/Project-Command-Center-v${VERSION}.html" \
            "dist/update-manifest.json" \
            --title "Project Command Center v${VERSION}" \
            --generate-notes
```

- [ ] **Step 2: Ensure release build is immutable after manifest generation**

The workflow must not run a formatter, banner injection, or post-processing step after `npm run manifest`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: publish verified standalone releases"
```

---

# Phase 9 — End-to-End Migration and Release Quality Gates

### Task 23: Add archived historical fixture upgrade tests

**Files:**
- Add: `tests/fixtures/legacy-v3-projects.json`
- Add: `tests/fixtures/schema3-capsule.json`
- Add: future historical fixtures as schemas are introduced
- Extend: `tests/update-engine.test.js`

**Interfaces:**
- Every supported historical schema gets a fixture that upgrades to latest.

- [ ] **Step 1: Add v3 fixture with representative data**

Fixture must include:

```text
plain project
tags
completed and incomplete tasks
bullet
link
embedded WebP image data URL
image caption
image displayWidth
deadline
notes
status
priority
```

- [ ] **Step 2: Add end-to-end v3 → v4 test**

Start from HTML text containing the legacy v3 marker, then:

```text
extract
infer schema 3
migrate to schema 4
validate
inject into v4 shell
extract again
compare important data fields
```

- [ ] **Step 3: Run full suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests
git commit -m "test: verify legacy v3 upgrade path"
```

---

### Task 24: Add explicit privacy regression tests

**Files:**
- Create: `tests/privacy.test.js`

**Interfaces:**
- Proves update checks do not serialize user Data Capsule content.

- [ ] **Step 1: Write test with sentinel private values**

Use sentinel strings:

```text
PRIVATE_PROJECT_NAME_DO_NOT_SEND
PRIVATE_IMAGE_DATA_DO_NOT_SEND
PRIVATE_NOTE_DO_NOT_SEND
```

Intercept every request produced by update discovery.

- [ ] **Step 2: Assert sentinel strings appear in no URL, headers, or request body**

- [ ] **Step 3: Run test**

```bash
npx vitest run tests/privacy.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/privacy.test.js
git commit -m "test: prevent project data from entering update requests"
```

---

### Task 25: Final release-candidate verification

**Files:**
- Modify only if verification exposes defects.

**Interfaces:**
- Produces the first releasable v4 standalone artifact.

- [ ] **Step 1: Run complete automated suite**

```bash
npm test
```

Expected: all tests pass, zero failures.

- [ ] **Step 2: Run release build with repository metadata**

```bash
RELEASE_BUILD=1 PCC_REPO_SLUG="local/project-command-center" npm run build
```

Expected: build exits 0 and emits `dist/Project-Command-Center-v4.0.0.html`.

- [ ] **Step 3: Validate exact build**

```bash
npm run validate:build
```

Expected: all standalone invariants pass.

- [ ] **Step 4: Generate manifest**

```bash
npm run manifest
```

Expected: `dist/update-manifest.json` is produced and its SHA-256 matches the exact HTML bytes.

- [ ] **Step 5: Recompute hash independently**

```bash
node -e "
const fs=require('fs');
const c=require('crypto');
const p='dist/Project-Command-Center-v4.0.0.html';
console.log(c.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
"
```

Expected: digest exactly equals `sha256` in `dist/update-manifest.json`.

- [ ] **Step 6: Run legacy v3 round-trip migration test against the exact build**

Expected:

```text
v3 extraction PASS
schema 3 -> 4 migration PASS
validation PASS
image preservation PASS
link preservation PASS
task state preservation PASS
displayWidth preservation PASS
v4 re-extraction PASS
```

- [ ] **Step 7: Manual browser smoke test**

Open the exact `dist/Project-Command-Center-v4.0.0.html` and verify:

```text
Projects render
Inline edits work
Images render and resize
Save Updated HTML works
Updates settings opens
Offline update-check failure is non-blocking
Manual update file picker opens
```

- [ ] **Step 8: Only after all gates pass, tag the release**

```bash
git tag v4.0.0
git push origin main
git push origin v4.0.0
```

The GitHub Release workflow then builds from the tagged source, reruns the quality gates, and publishes the release artifacts.

---

# Migration Contract Established by v4

The initial migration history becomes:

```text
Legacy v3 HTML
  │
  ├─ extract old __PROJECT_DATA markers
  │
  ▼
Inferred Schema 3 Capsule
  │
  ├─ migrateSchema3To4()
  │
  ▼
Schema 4 Data Capsule
  │
  ├─ validateDataCapsule()
  │
  ▼
Inject into verified v4 App Shell
  │
  ▼
New self-contained v4 HTML
```

Future schema changes add exactly one migration per version:

```text
4 → 5
5 → 6
6 → 7
```

No future migration should rewrite or remove earlier migration functions while those source schemas remain within the advertised supported compatibility range.

---

# Online Update Contract Established by v4

```text
Open local tracker
  │
  ├─ render immediately
  │
  └─ GET latest public GitHub Release
       │
       ├─ fetch update-manifest.json
       ├─ validate manifest
       ├─ compare app versions
       └─ check schema compatibility
            │
            ▼
       Show Update Available banner
            │
            ▼
       User chooses Install
            │
            ├─ download HTML release asset
            ├─ SHA-256 locally
            ├─ compare manifest digest
            ├─ compare GitHub asset digest
            ├─ inspect shell markers
            ├─ clone current Data Capsule
            ├─ generate backup
            ├─ migrate clone
            ├─ validate clone
            ├─ inject clone into new shell
            └─ offer updated HTML download
```

At no point does the request path contain project data.

---

# Manual Update Contract Established by v4

```text
User selects update HTML
  │
  ├─ inspect release metadata
  ├─ compute selected-file SHA-256
  │
  ├─ if online:
  │     fetch exact GitHub release tag
  │     compare official asset digest
  │       ├─ match → verified-official
  │       └─ mismatch → hard failure
  │
  └─ if offline:
        unverified-offline
        explicit user confirmation required
```

The migration/export pipeline after trust determination is the same pipeline used by official online updates.

---

# Self-Review Results

- **Spec coverage:** All locked v4 design areas are assigned to tasks: modular source, data capsule, legacy v3 extraction, schema migration, validation, shell injection, manifest, SHA-256, GitHub Releases, automatic checks, manual updates, trust states, settings UI, backup generation, privacy, CI, release publishing, and recovery behavior.
- **Legacy compatibility:** Explicit v3 marker extraction and schema-3 inference are included before v4 marker adoption.
- **Integrity:** Official online update verification requires both manifest SHA-256 and GitHub release asset digest comparison when the provider returns a digest.
- **Manual offline limitation:** The plan does not falsely claim cryptographic authenticity when offline; offline manual files are explicitly unverified until future digital signatures are introduced.
- **Type consistency:** `schemaVersion`, `minSchemaVersion`, `appVersion`, `preferences`, and updater result shapes are used consistently throughout.
- **Placeholder scan:** No implementation placeholders are intentionally left in this plan. GitHub repository identity is supplied dynamically from `${{ github.repository }}` during real release builds rather than hard-coded.
