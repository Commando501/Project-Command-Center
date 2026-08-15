# Project Command Center v4 — Update Pipeline Design Specification

**Date:** 2026-08-14  
**Target:** Project Command Center standalone HTML application  
**Primary distribution:** Public GitHub repository + GitHub Releases  
**Core guarantee:** Application updates must never require uploading user project data and must never overwrite the user's current standalone HTML file.

---

## 1. Goals

Build a durable update system that allows Project Command Center to evolve without losing or corrupting user-created data.

The update pipeline must support:

1. Automatic update checks against a public GitHub release channel.
2. Explicit user approval before installing any update.
3. Manual/offline installation from a downloaded HTML release file.
4. Mandatory SHA-256 verification for official online updates.
5. Sequential schema migrations for old project data.
6. Validation before producing an upgraded file.
7. Automatic recovery options.
8. Continued use as a single self-contained HTML file.
9. No transmission of user projects, notes, tasks, images, links, or preferences to GitHub or any external service.
10. A future-compatible release manifest that can later support digital signatures.

---

## 2. Architectural Principle

Project Command Center is conceptually divided into three layers.

### 2.1 App Shell

Contains:

- HTML
- CSS
- JavaScript
- UI
- Update logic
- Image tooling
- Migration functions
- Validation logic
- Release metadata
- Application features

The App Shell is replaceable.

### 2.2 Data Capsule

Contains all user-owned state, including:

- Projects
- Tasks
- Bullets
- Links
- Embedded images
- Image captions
- Image display sizes
- Tags
- Notes
- Project settings
- Application preferences that should survive updates
- Any future user-created content

The Data Capsule must survive App Shell replacement.

### 2.3 Version Metadata

Each release contains explicit application and data-schema versions.

Example:

```js
const APP_METADATA = {
  appVersion: "4.0.0",
  schemaVersion: 4,
  updateChannel: "stable",
  repoOwner: "OWNER",
  repoName: "project-command-center"
};
```

The application version and schema version are independent.

---

## 3. Core Update Rule

An update does **not** modify the currently opened HTML file.

Instead:

1. Read current Data Capsule.
2. Download or load the new App Shell.
3. Verify the new App Shell.
4. Clone the current data.
5. Migrate the cloned data.
6. Validate the migrated result.
7. Inject the migrated Data Capsule into the new App Shell.
8. Generate a new standalone HTML file.
9. Leave the old HTML file untouched.

Example result:

```text
Project-Command-Center-v4.0.0.html
Project-Command-Center-v4.1.0.html
Project-Command-Center-v4.2.0.html
```

The previous HTML file therefore remains a rollback copy.

---

## 4. Update Delivery Modes

Project Command Center uses a hybrid update model.

### 4.1 Online GitHub Update

When the tracker opens and internet access is available:

1. The application performs a non-blocking update check.
2. It checks the configured public GitHub release channel.
3. If the installed version is current, no UI interruption is shown.
4. If a newer compatible version exists, display a small non-intrusive banner:

```text
Project Command Center 4.2.0 is available
[View Update]
```

Nothing downloads or installs automatically.

The user must explicitly choose to view and install the update.

### 4.2 Manual / Offline Update

Provide:

```text
Settings → Updates → Install Update From File
```

The user may select a newer Project Command Center standalone HTML file.

The same validation, migration, and export engine is used for online and offline updates.

There must not be separate migration implementations for the two update paths.

---

## 5. GitHub Repository Strategy

The public GitHub repository is the canonical application source.

Recommended repository layout:

```text
/src
  app/
    project-model.js
    project-ui.js
    filters.js
    progress.js
  content/
    content-items.js
    links.js
    images.js
  updater/
    updater.js
    release-client.js
    verifier.js
    migrations.js
    validator.js
    data-capsule.js
  styles/
    app.css

/tests
  project-model.test.js
  progress.test.js
  migrations.test.js
  updater.test.js
  verifier.test.js
  export.test.js

/build
  build-standalone.js
  generate-manifest.js

.github/
  workflows/
    test.yml
    release.yml

update-manifest.schema.json
package.json
README.md
```

Development source should be modular even though the user-facing artifact remains one HTML file.

---

## 6. Standalone Build

The development repository may use multiple source files.

The build process bundles them into a single release artifact:

```text
Project-Command-Center-v4.2.0.html
```

The final HTML must remain:

- Self-contained
- Offline-capable
- Free of runtime dependencies on the source repository
- Capable of containing the entire user Data Capsule

---

## 7. GitHub Release Contract

Each stable release publishes at minimum:

```text
Project-Command-Center-v4.2.0.html
update-manifest.json
```

Optional future release artifacts may include:

```text
Project-Command-Center-v4.2.0.html.sig
```

The GitHub release tag should match the application version:

```text
v4.2.0
```

---

## 8. Update Manifest

Recommended manifest structure:

```json
{
  "formatVersion": 1,
  "appVersion": "4.2.0",
  "schemaVersion": 6,
  "minSchemaVersion": 2,
  "channel": "stable",
  "assetName": "Project-Command-Center-v4.2.0.html",
  "sha256": "HEX_SHA256",
  "releaseNotes": [
    "Added project timelines",
    "Improved image management"
  ],
  "publishedAt": "2026-08-14T00:00:00Z",
  "signature": null
}
```

### Required fields

- `formatVersion`
- `appVersion`
- `schemaVersion`
- `minSchemaVersion`
- `channel`
- `assetName`
- `sha256`
- `publishedAt`

### Optional fields

- `releaseNotes`
- `signature`
- future compatibility metadata

---

## 9. Update Channels

The update system is designed for multiple channels.

Initial channel:

```text
stable
```

Future supported channels may include:

```text
beta
development
```

Normal user copies default to:

```js
updateChannel: "stable"
```

Development and testing copies may opt into another channel.

Update-channel selection is persistent user preference data.

---

## 10. Automatic Update Check

On application startup:

1. Load the local tracker immediately.
2. Do not delay access to project data while checking for updates.
3. If online updates are enabled, query the configured public release source.
4. Read the latest release metadata.
5. Compare semantic application versions.
6. Check schema compatibility.
7. If a newer compatible version exists, display the update banner.
8. If the check fails because the user is offline, GitHub is unavailable, CORS/network access fails, or release metadata is invalid:
   - Do not interrupt normal tracker use.
   - Do not display a blocking error.
   - Optionally expose the failure inside the Updates settings panel.

No user Data Capsule contents are included in the request.

---

## 11. Update Review Panel

Selecting **View Update** opens an update panel showing:

- Installed application version
- Available application version
- Current schema version
- Target schema version
- Compatibility status
- Release date
- Release notes
- Download size where available
- Verification status
- Update channel

Available actions:

```text
[Install Update]
[Download Release]
[Cancel]
```

No installation begins merely by opening the panel.

---

## 12. Official Online Update Integrity

Official online updates require verification before migration.

### 12.1 Mandatory SHA-256 Verification

For a downloaded release HTML:

1. Download the release bytes.
2. Compute SHA-256 locally using Web Crypto.
3. Compare the computed digest with the manifest SHA-256.
4. If an independent release asset digest is available from the release provider, compare against it as an additional integrity check.
5. Continue only if required verification succeeds.

If verification fails:

```text
Update verification failed.

The downloaded update does not match the expected release hash.
No project data was changed.
```

The update must stop.

The user must not be offered a "skip verification" option for an official online update.

---

## 13. Manual Update Trust Model

A manually selected update file follows these rules:

### Verified manual release

If it contains valid trusted release metadata and a verifiable hash/signature:

- Display it as a verified official release.
- Continue through the normal migration path.

### Unverified manual release

If it lacks trusted release metadata:

Display a clear warning:

```text
Unverified Update

This update file cannot be confirmed as an official Project Command Center release.

Your current HTML file will remain unchanged.

[Cancel]
[Use Unverified Update]
```

The user must explicitly choose the unverified path.

Unverified status should also be reflected in the generated application's metadata where practical.

---

## 14. Future Digital Signature Support

The manifest format reserves support for signed releases.

Future architecture:

1. Release manifest is signed with a private release key.
2. Public verification key is embedded in the application.
3. Tracker verifies the manifest signature.
4. SHA-256 verifies the release asset bytes.
5. Both checks must pass for an officially signed update.

This is not required for the first implementation, but the manifest format must not prevent its addition.

---

## 15. Data Schema Versioning

Every Data Capsule has an explicit schema version.

Example:

```js
{
  schemaVersion: 6,
  projects: [...],
  preferences: {...}
}
```

The schema version describes the shape of user data.

It does not equal the app version.

---

## 16. Sequential Migration Model

Schema changes are implemented as explicit one-step migrations.

Example:

```js
migrateSchema3To4(data)
migrateSchema4To5(data)
migrateSchema5To6(data)
```

Upgrade path:

```text
Schema 3
  ↓
migrateSchema3To4()
  ↓
Schema 4
  ↓
migrateSchema4To5()
  ↓
Schema 5
  ↓
migrateSchema5To6()
  ↓
Schema 6
```

The updater must never rely on a single giant migration that attempts to infer every historical format.

Each migration:

- Accepts exactly one known input schema.
- Returns the next schema.
- Does not mutate the user's live Data Capsule.
- Is independently testable.

---

## 17. Migration Compatibility Range

Each release declares:

```json
{
  "minSchemaVersion": 2,
  "schemaVersion": 6
}
```

If the installed Data Capsule schema is:

### Within supported range

Example:

```text
Installed schema: 4
Minimum supported: 2
Target: 6
```

Run:

```text
4 → 5 → 6
```

### Too old

Example:

```text
Installed schema: 1
Minimum supported: 2
```

The updater does not attempt an unsafe direct upgrade.

It explains that an intermediate release or dedicated migration package is required.

---

## 18. Transactional Migration Behavior

Migrations operate on a cloned Data Capsule.

Process:

```text
Live Data
   ↓ clone
Migration Working Copy
   ↓ migrate
Validation
   ↓
New HTML
```

The live in-memory data remains untouched until the export completes.

If any migration throws or validation fails:

```text
Update could not be completed.

Migration 5 → 6 failed.
Your existing file and project data are unchanged.
```

No partially migrated output is generated.

---

## 19. Data Validation

After the final migration, validate:

- Top-level Data Capsule structure
- Schema version
- Project IDs
- Project arrays
- Content item types
- Image data URLs
- Link URL safety
- Required fields
- User preferences
- Version metadata
- Any future schema-specific invariants

Validation must run before injecting data into the new shell.

---

## 20. Data Capsule Marker

The release HTML must contain a stable machine-readable injection region.

Example:

```js
const EMBEDDED_DATA =
/*__PCC_DATA_START__*/
{
  "schemaVersion": 6,
  "projects": []
}
/*__PCC_DATA_END__*/;
```

The marker names become part of the permanent updater contract.

Future App Shell releases must preserve compatible markers unless a specifically versioned installer handles the transition.

---

## 21. Release Shell Detection

A candidate update HTML must expose recognizable metadata independent of user data.

Example:

```js
/*__PCC_RELEASE_METADATA_START__*/
{
  "appVersion": "4.2.0",
  "schemaVersion": 6,
  "minSchemaVersion": 2,
  "releaseId": "pcc-v4.2.0"
}
/*__PCC_RELEASE_METADATA_END__*/
```

The updater validates this before injecting any Data Capsule.

---

## 22. Automatic Backup Before Migration

Before beginning a migration, generate a data-only backup:

```text
Project-Command-Center-backup-2026-08-14.json
```

The backup contains:

- Schema version
- Projects
- Embedded images
- Links
- Tasks
- Bullets
- Preferences
- Relevant application settings
- Backup timestamp
- Original app version

Because images are embedded, backup JSON files may be large.

The user may be given an option to disable automatic backup later, but it should default to enabled.

---

## 23. Recovery Layers

The update process provides three recovery layers:

### Layer 1 — Original HTML

The old standalone application is never overwritten.

### Layer 2 — Data Backup

A JSON backup is generated before migration.

### Layer 3 — New Upgraded HTML

Only generated after successful migration and validation.

---

## 24. Update Result

Successful update flow ends with:

```text
Update ready

Project Command Center 4.2.0 was created successfully.
Your previous file was not modified.

[Download Updated HTML]
```

The page may optionally show:

```text
Old version: 4.1.0
New version: 4.2.0
Schema: 5 → 6
Projects migrated: 17
Embedded images preserved: 43
```

---

## 25. User Data Privacy

The update checker must never send:

- Project names
- Notes
- Tasks
- Links
- Tags
- Images
- Image metadata
- Project counts
- Progress
- User preferences unrelated to update retrieval
- Backup contents

Online requests should contain only what is required to retrieve public release metadata and assets.

The merge between new App Shell and private Data Capsule occurs locally in the browser.

---

## 26. Release Automation

A GitHub Actions release workflow should eventually automate:

1. Install dependencies.
2. Run automated tests.
3. Run migration tests from supported historical schemas.
4. Build the standalone HTML.
5. Validate release metadata markers.
6. Validate Data Capsule markers.
7. Compute SHA-256.
8. Generate `update-manifest.json`.
9. Validate the manifest against `update-manifest.schema.json`.
10. Create or update the matching GitHub Release.
11. Upload:
    - standalone HTML
    - update manifest
    - optional future signature
12. Publish release only after all required checks pass.

---

## 27. Release Versioning

Use semantic versioning:

```text
MAJOR.MINOR.PATCH
```

Examples:

```text
4.0.0
4.1.0
4.1.1
5.0.0
```

Recommended meaning:

### PATCH

Bug fixes without intended feature or schema changes.

### MINOR

Backward-compatible feature additions.

May include a forward schema migration if older data can be migrated automatically.

### MAJOR

Breaking application architecture changes, major schema changes, or compatibility changes that deserve explicit user attention.

Schema version increments only when the stored Data Capsule shape changes.

---

## 28. Update Preferences

Persistent update settings should include:

```js
{
  checkForUpdatesAutomatically: true,
  updateChannel: "stable",
  automaticBackupBeforeUpdate: true
}
```

Default:

```text
Automatic checks: ON
Channel: Stable
Automatic backup: ON
```

There is no automatic installation preference in the initial design.

Updates always require explicit user approval.

---

## 29. Settings UI

Add an **Updates** section containing:

- Current app version
- Current schema version
- Update channel
- Automatic update-check toggle
- Last update-check timestamp
- `Check for Updates`
- `Install Update From File`
- `Export Data Backup`
- Release verification status where applicable

---

## 30. Failure Handling

### Network failure

Continue normal use.

### GitHub unavailable

Continue normal use.

### Invalid manifest

Ignore the update and expose a diagnostic inside update settings.

### Hash mismatch

Block installation.

### Unsupported old schema

Block migration and explain the required compatibility path.

### Migration failure

Abort; original file remains untouched.

### Validation failure

Abort; do not generate upgraded output.

### Download failure

Do not alter live data.

### Unverified manual update

Require explicit confirmation.

---

## 31. Testing Strategy

Automated tests must cover:

### Versioning

- Semantic version comparison
- Stable vs beta channel rules

### Manifest

- Valid manifest
- Missing required fields
- Unsupported manifest format
- Invalid SHA-256 format

### Verification

- Matching SHA-256
- Mismatched SHA-256
- Corrupt release bytes

### Migration

For every schema migration:

- Valid historical input
- Expected transformed output
- Invalid input
- Preservation of unrelated data
- Embedded image preservation
- Link preservation
- Task completion preservation

### Migration chains

Example:

```text
schema 2 → latest
schema 3 → latest
schema 4 → latest
schema 5 → latest
```

### Export

- New shell receives migrated Data Capsule
- Old user data marker is not accidentally retained
- New release metadata remains intact
- Result is standalone

### Privacy

- Update requests do not serialize Data Capsule content

---

## 32. Release Quality Gate

A release must not be published if:

- Any automated test fails
- Any supported migration path fails
- Standalone HTML build fails
- Release metadata markers are absent
- Data Capsule markers are absent
- Manifest validation fails
- SHA-256 generation fails
- Built file cannot parse

---

## 33. Development vs User Artifact

The GitHub repository should prioritize maintainable source code.

The user's workflow remains:

```text
one HTML file
```

This distinction is intentional.

Developers work on modular source files.

Users receive the compiled self-contained artifact.

---

## 34. Future Extensions

The architecture should leave room for:

- Cryptographically signed release manifests
- Differential update packages
- Beta/dev channels
- Migration diagnostics
- Restore-from-backup wizard
- Release history
- Schema compatibility visualization
- Optional portable encrypted backups
- Update mirrors if GitHub is unavailable
- Automatic tests against archived release fixtures

None of these are required for the initial updater implementation.

---

## 35. Out of Scope for Initial v4 Updater

- Silent automatic installation
- Modification of the currently opened HTML file
- Uploading user data to GitHub
- Cloud synchronization
- Account system
- Server-side project storage
- Required GitHub authentication
- Mandatory digital signatures in the first release
- Background service workers required for core operation
- Differential binary patching

---

## 36. Locked Decisions

The following decisions are approved and considered fixed unless explicitly changed later:

- Hybrid online + manual update pipeline.
- Public GitHub repository.
- GitHub Releases as the normal release distribution mechanism.
- Automatic non-intrusive update check on open.
- No automatic installation.
- Explicit user approval required.
- Official online updates require SHA-256 verification.
- Unverified manual updates require a warning and explicit confirmation.
- Separate app version and schema version.
- Sequential schema migrations.
- Compatibility range declared by each release.
- Transactional migration on cloned data.
- Automatic data backup before migration.
- Old HTML file remains untouched.
- Updated version is generated as a new self-contained HTML file.
- User Data Capsule never needs to leave the browser.
- Release manifest designed for future digital signatures.
- Modular GitHub source tree compiled into a single standalone user artifact.
