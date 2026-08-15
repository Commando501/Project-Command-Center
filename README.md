# Project Command Center

A project tracker that is one HTML file. Open it in a browser, edit in place,
and save a new copy. No database, no server, no npm at runtime, no extension,
no cloud account, and no network connection required to use it.

Your projects, notes, tasks, links, and images live inside the file itself.

## Using it

1. Download `Project-Command-Center-v4.0.0.html` from the releases page.
2. Open it in any modern browser.
3. Edit. Changes stay in memory while the page is open.
4. Press **Save Updated HTML** to download a new self-contained copy.

The file you opened is never modified. Every save produces a new file, so the
previous one remains as a working backup.

## Updating

Updates never overwrite the file you are using. Installing one produces a new
HTML file containing your migrated data, and leaves the old one alone as a
rollback copy.

- **Online** — the app quietly checks the public GitHub release channel when it
  opens. If a newer version exists, a banner appears. Nothing downloads or
  installs on its own. Official updates require a SHA-256 match against the
  published release digest, and there is no way to skip that check.
- **Offline** — **Updates → Install Update From File** accepts a release HTML
  you downloaded yourself. If the network is reachable, the file is verified
  against the official release of that version. If it cannot be verified, the
  app says so plainly and requires an explicit confirmation rather than
  pretending the file is trusted.

Update checks send nothing about you or your data. They are unauthenticated
GET requests for public release metadata, with no body, no credentials, and no
referrer. Your data is merged with the new application locally, in your
browser.

## Data safety

The update flow is transactional:

```
current data → clone → migrate → validate → inject into new shell → new HTML
```

If migration or validation fails, no upgraded file is produced at all. Schema
migrations are sequential and each one accepts exactly one known input version.

## Development

Development is modular; the release artifact is a single file.

```bash
npm install
npm test              # unit, parity, integration, and privacy suites
npm run build         # dist/Project-Command-Center-v<version>.html
npm run validate:build
npm run manifest
```

`npm run release:check` runs all four in order.

### Layout

```
src/
  app/          project model, progress, filters, formatting, render, state
  content/      content items, image optimization policy and browser pipeline
  persistence/  markers, data capsule, extraction, injection, shell capture
  updater/      versions, manifest, sha256, shell inspection, engine, UI
scripts/        build, validate, manifest generation
tests/          suites and fixtures
legacy/         the immutable v3 reference application
docs/           design and implementation plan
```

### Ground rules

- The released artifact must remain one self-contained HTML file, with no
  external script, stylesheet, image, font, or runtime dependency.
- `legacy/Project-Command-Center-v3.html` is the behavioural reference and is
  never edited. `tests/v3-parity.test.js` executes its real logic and compares
  it with the extracted modules.
- Marker names are a permanent contract. `src/persistence/markers.js` owns them
  and assembles them from fragments so no bundled source file contains one
  contiguously.
- Progress semantics are locked: manual progress is the integer portion, task
  completion the decimal, and an explicitly Complete project is exactly 100%.
- Display resizing an image never re-encodes it.

### Release

Tag a version to publish. The workflow reruns the tests, builds, validates the
artifact, generates the manifest, independently recomputes the digest, and only
then creates the release. Nothing may modify the HTML after the manifest is
generated.

```bash
git tag v4.0.0
git push origin v4.0.0
```
