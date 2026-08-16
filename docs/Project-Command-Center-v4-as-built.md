# Project Command Center v4 — As Built

**Status:** shipped. Releases 4.0.0 through 4.1.1 are published. 4.1.0 added
in-place autosave and 4.1.1 corrected which file it writes to; the schema is
unchanged at 4.

This describes what exists, which is not identical to what was designed. The
design specification remains the statement of intent; where the two disagree,
this document says what the code does and why. Divergences are recorded in the
design document's own amendments section.

---

## 1. Shape of the thing

Development is modular ES modules under `src/`. The release artifact is a
single HTML file with no external script, stylesheet, image, font, or runtime
dependency of any kind, verified by `scripts/validate-build.mjs` on every
build and in CI.

```
src/
  index.html          markup with four build tokens
  main.js             boot: capture shell, build state, wire events, render
  styles/app.css      the whole stylesheet, inlined at build time
  app/
    util.js           clamp, makeId, cloneJson
    format.js         escapeHtml, safeUrl, linkifyText, byte and date formatting
    progress.js       taskStats, computeProgress, formatProgress
    project-model.js  normalizeProject, field updates, duplicate, completion
    filters.js        search, tag AND-filtering, the five sorts
    render.js         all markup generation
    state.js          in-memory application state and every mutation
  content/
    content-items.js  task, bullet, link, image normalization and updates
    image-optimizer.js  pure encode policy: limits, target dimensions, ranking
    image-pipeline.js   browser I/O: decode, canvas, encode, embed
  persistence/
    autosave.js       in-place writing: handle store, permissions, scheduler
    markers.js        the four permanent markers, assembled from fragments
    data-capsule.js   schema 4 capsule, preferences, legacy v3 adapter
    extract.js        reads a capsule out of v4 or legacy v3 HTML
    standalone-export.js  serialization and single-region injection
    html-shell.js     capture of the application's own source
    backup.js         reads both backup file shapes
  updater/
    app-metadata.js   release identity, local-build detection
    version.js        strict three-part semantic versions
    manifest.js       update manifest validation
    sha256.js         Web Crypto digests
    shell-inspector.js  reads a candidate release without executing it
    github-release-client.js  read-only public release API client
    migrations.js     sequential one-step schema migrations
    validator.js      capsule validation, errors versus warnings
    update-engine.js  discovery, verification, the shared update pipeline
    restore.js        backup restore through the same engine
    update-ui.js      settings, banner, review, result, import
```

`scripts/` holds the build, the build validator, and the manifest generator.
`tests/` holds 522 tests across 28 files.

---

## 2. The two versions

`appVersion` describes the application. `schemaVersion` describes the shape of
user data. They move independently. v4 ships schema 4 and accepts schema 3, so
`minSchemaVersion` is 3.

Legacy v3 data is schema 3. The only registered migration is `3 -> 4`, which
adds the capsule envelope and the update preferences and passes projects
through untouched.

---

## 3. Markers

Four permanent markers form the update contract:

```
/*__PCC_DATA_START__*/            /*__PCC_DATA_END__*/
/*__PCC_RELEASE_METADATA_START__*/  /*__PCC_RELEASE_METADATA_END__*/
```

`src/persistence/markers.js` owns all of them and assembles each from
fragments at runtime. This is load-bearing rather than stylistic: if bundled
source contained a marker contiguously, the released HTML would hold a second
copy of its own injection region, and the validator, extractor, and injector
would all be operating on ambiguous input. `tests/markers.test.js` fails the
build if any source file ever contains one.

Legacy v3 markers are read but never written. `validate-build.mjs` fails if a
v4 artifact contains one.

**Every genuine v3 file contains two legacy marker regions** — the data near
the top of the script, and a second copy inside `buildUpdatedHtml` where the
markers appear in a template literal. The extractor therefore takes the first
region, which is the one v3 itself treats as authoritative because
`String.replace` takes the first match. A strict single-region rule would
reject every v3 file in existence.

---

## 4. Saving

The running page is the only copy of its own App Shell. `html-shell.js`
captures `document.documentElement.outerHTML` at boot, before anything mutates
the DOM, and refuses to run twice. Capturing after render would bake rendered
project cards into every saved file.

Saving injects the current capsule into that captured shell. `Save Updated
HTML` downloads the result and never modifies the file on disk.

**Autosave writes that same output in place**, to a file the user explicitly
granted through the File System Access API. It is off until switched on, and
`persistence/autosave.js` owns it. Three things make it safe:

- `createWritable()` writes to a swap file and commits on `close()`, so a
  crash or a full disk leaves the original intact rather than half-rewritten.
  A failed write aborts the swap file instead of committing it.
- Both routes build their bytes through one function, `buildCurrentHtml()`, so
  autosave and manual save cannot drift apart. It throws on a shell whose
  markers are missing or duplicated, so nothing that fails marker validation
  can reach a file.
- The scheduler coalesces a burst of edits into one write and never runs two
  concurrently — the tracker embeds its images, so a save can be tens of
  megabytes. An edit arriving mid-write produces exactly one follow-up. A
  failed write stops autosave rather than retrying, because a revoked
  permission would otherwise fail on every keystroke.

The handle is persisted in IndexedDB, keyed by the page's own URL. That key
matters: every `file://` page shares one storage origin, so a bare key would
let two trackers adopt each other's save target. Permission is not guaranteed
to survive a browser restart, so a stored handle whose permission has lapsed
offers a button rather than resuming silently — prompting requires a real
click.

**That paused state says so.** It used to be visible only as a relabelled
button, while the save strip read "All embedded data is current" — the same
thing a tracker that never had autosave shows, and untrue, since nothing was
being written. The strip now names the state, the file, and the way out. This
mattered more than it looks: a backup import is what people do right after
opening a file, which is exactly when a lapsed permission leaves autosave
dormant, so the operation most likely to be silently discarded was the one
that replaces every project.

The wiring between a user action and a committed write is covered by
`tests/autosave-integration.test.js`, which drives the built artifact. The
autosave unit tests cover permission, the write, and the scheduler in
isolation, and a mutation that never reached the scheduler would satisfy all
of them.

The update pipeline is deliberately not routed through this. An update still
produces a new versioned file and never touches the running one, which is what
keeps the previous file usable as a rollback.

Two escaping rules matter in `serializeForEmbeddedJson`:

- `<`, U+2028, and U+2029 are escaped so no note can break out of the script.
- `*/` is escaped so no note can terminate the injection region. Legacy v3 does
  not do this, which matters more in v4 because v4 extracts by marker rather
  than by evaluating script.

Injection passes the payload to `String.replace` as a **function**. As a string
it would interpret `$&`, `` $` ``, `$'`, and `$1`, so a note containing `$'`
would splice document text into the user's own data. Legacy v3 has this bug at
line 1417.

---

## 5. Updating

Discovery reads the GitHub API. It never downloads the release to check.

**The manifest is optional.** A page opened from disk cannot read release
assets: `api.github.com` sends `Access-Control-Allow-Origin`, but assets
redirect to `objects.githubusercontent.com`, which does not, and a `file://`
page has the opaque origin `null`. Since opening from disk is the normal way
this application is used, everything discovery needs comes from the API
response — `tag_name`, `published_at`, `body`, and per-asset `size` and
`digest`. The manifest is preferred when reachable, which it is over http(s).

Verification is unchanged in strength. The expected SHA-256 comes from GitHub
over TLS either way, and the asset digest is computed by GitHub over the stored
bytes. A release publishing no digest is refused rather than offered
unverified. A mismatch is a hard stop with no override.

Two flows, one engine:

| | opened from disk | served over http(s) |
|---|---|---|
| Discovery | API only | API, manifest when readable |
| Install | Download Release, then Install Update From File | one click |
| Verification | local hash against the API digest | same |

From disk the Install Update button is not shown at all, because a direct
fetch could only fail. The three steps are listed before the first click.

`applyUpdatePipeline` is the single migration and export path. A test asserts
the online and manual paths produce byte-identical output for the same inputs,
so they cannot drift apart.

The schema a release writes is declared only by the manifest, so an API-only
check reports it as unknown and says compatibility is confirmed at install.
That is safe: the pipeline gates on the candidate shell's own metadata, which
is authoritative, before anything is migrated.

---

## 6. Validation: errors versus warnings

Errors abort an update. Warnings do not. The split is deliberate.

**Errors** — the capsule cannot be read, the schema is wrong, a project has no
id, a content item is not an object, or an image `src` points at a remote URL,
which would break self-containment.

**Warnings** — anything the application already normalizes on load: a
half-typed link URL, an unrecognised status, out-of-range progress, a missing
item id, a duplicate project id, an unknown update channel.

v3 stores all of the warning cases happily and neutralises them at render time,
so treating them as fatal would refuse to upgrade perfectly ordinary files
under a security-flavoured error. The render-time check in `safeUrl` is the
actual security boundary and is unaffected by anything stored.

---

## 7. Backups

Two shapes exist, both readable by `Import Data Backup`:

```
update backup   { backupFormatVersion, backedUpAt, sourceAppVersion, data }
JSON export     { exportedAt, projectCount, projects }
```

The update backup is taken from the live capsule before any migration begins.
The JSON export is the v3 shape, unchanged.

Restoring runs through the same migration and validation engine an update
uses, so an old backup upgrades exactly as an old file does and one that fails
validation is refused rather than half-restored. It replaces projects in
memory, and what happens to the file then depends on autosave.

With autosave off, the file on disk is untouched until the user saves, so an
unwanted restore is undone by closing the page. **With autosave on, the
replacement is committed to the file seconds later**, and closing the page
undoes nothing. The confirmation prompt is a consent step, so it states which
of the two is about to happen rather than always promising the first; the
success message likewise stops directing the user to a save that already
happened. Recovering from a restore made under autosave means reopening the
previous file or a backup, which is what the recovery layers in section 23 of
the design are for.

---

## 8. Privacy

Update requests are unauthenticated GETs built from the repository slug and a
release tag. No body, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`.
`tests/privacy.test.js` places ten sentinels across the capsule and asserts
none reaches any URL, header, or body, that no request carries a body, and that
the artifact contains no origin outside the allowlist and no beacon, WebSocket,
or XHR call.

The `X-GitHub-Api-Version` header is deliberately not sent: GitHub answers 400
for an unrecognised value, so pinning a version this code cannot verify would
be a guaranteed future outage.

---

## 9. Environment facts, established by testing

- `file://` **is** a secure context; `crypto.subtle` is available, so update
  verification works from disk.
- The File System Access API **is** available from `file://` and fully
  working. Retested 2026-08-15 in Chrome 151: picker opens, permission is
  granted on pick, and a second write to the same handle commits with no new
  dialog. An earlier note here claimed `showSaveFilePicker` was undefined;
  that reading was taken on an opaque origin rather than a real `file://`
  page. Verify `location.protocol === 'file:'` before trusting any such
  result. Firefox and Safari still do not implement the API, so the autosave
  control is hidden there and downloads remain the only route.
- localStorage on `file://` holds roughly 5 M characters and **every local
  file shares one origin bucket** — two probe files in different directories
  read each other's keys. Anything stored per-file must carry the file's own
  path in its key.
- Release assets are CORS-blocked from `file://`; the API is not.
- Chrome logs an "Unsafe attempt to load URL ... 'file:' URLs are treated as
  unique security origins" warning for any local page, including legacy v3. It
  is environmental and harmless.

---

## 10. Build and release

The build is deterministic and byte-reproducible: given the same source and
the same `PCC_REPO_SLUG`, Windows and Linux produce identical bytes. This is
verified, not assumed, so a release can be rebuilt from its tag and checked
against the published digest without trusting the pipeline.

Output is unminified on purpose. Users are asked to trust this file with their
data and to verify its hash; keeping it readable makes that meaningful.

The build refuses to overwrite an existing artifact whose capsule contains
projects. `dist/` is gitignored and the build reuses one filename, so a
tracker kept there is destroyed by the next build with nothing to restore
from. `PCC_ALLOW_OVERWRITE=1` overrides. The check runs after bundling and
before writing, so a refusal cannot leave a partial file, and a fresh
checkout, CI, and the ordinary rebuild loop all see zero projects and proceed.

`validate-build.mjs` enforces: exactly one of each marker pair, no legacy
marker, no external script or stylesheet, no remote resource, no unresolved
build token, an embedded icon, release metadata matching the package version,
a parseable embedded capsule, and that every script block compiles.

The release workflow reruns the tests, verifies the tag matches the package
version, builds, validates, generates the manifest, and independently
recomputes the digest. Nothing may modify the HTML after the manifest is
generated.

---

## 11. Known limitations

- Installing from disk takes three steps and leaves one downloaded file
  unused. This is a browser constraint, not a design choice.
- Versions 4.0.0 and 4.0.1 carry the pre-fix update checker and can never
  discover a newer release. Those files need one manual download.
- An improvement to the update UI only appears once the user is running the
  version containing it, since the client does the rendering.
- There is one registered migration. The chain machinery is built and tested,
  but `4 -> 5` does not exist yet.
