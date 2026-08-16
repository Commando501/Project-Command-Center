# Project Command Center

Read these documents before implementation:

@docs/Project-Command-Center-v4-as-built.md
@docs/Project-Command-Center-v3-design.md
@docs/Project-Command-Center-v4-update-pipeline-design.md
@docs/Project-Command-Center-v4-update-pipeline-implementation-plan.md

The immutable v3 reference application is:

@legacy/Project-Command-Center-v3.html

## Priority of instructions

If instructions conflict, use this order:

1. CLAUDE.md locked invariants
2. v4 as-built document (what the code actually does)
3. v4 update-pipeline design, including its section 37 amendments
4. v4 implementation plan (executed; historical)
5. v3 design
6. existing v3 implementation behavior

## Product invariant

Development may be modular, but the release artifact MUST remain one
completely self-contained HTML file.

It must not require at runtime:
- database
- backend
- npm
- external JavaScript
- external CSS
- external images
- browser extension
- cloud storage

## Legacy reference

Never edit:

legacy/Project-Command-Center-v3.html

It is the behavioral and migration reference.

Do not remove or regress existing v3 functionality unless explicitly
required by the approved v4 design.

## Data safety

The update pipeline must never overwrite the user's currently opened HTML
file. An update always produces a new versioned file, leaving the previous one
intact as the rollback copy.

Updates must use:

current data
→ clone
→ migrate
→ validate
→ inject into new application shell
→ generate new HTML

If migration or validation fails, produce no upgraded application.

Saving the user's own edits is a different operation from updating, and may
write in place to a file handle the user explicitly granted. Scoped on
2026-08-15, after the File System Access API was verified working from
`file://` in Chrome 151. In-place writing must:

- require an explicit opt-in that can be revoked at any time
- commit atomically, never streaming into the live file
- refuse to write a shell that fails marker validation
- never become the only route out: Save Updated HTML and Export JSON Backup
  remain available and unchanged

Never transmit project data during update checks.

## Versioning

Legacy v3 data is schema 3.

v4 Data Capsule is schema 4.

Permanent markers:

/*__PCC_DATA_START__*/
/*__PCC_DATA_END__*/

/*__PCC_RELEASE_METADATA_START__*/
/*__PCC_RELEASE_METADATA_END__*/

Do not rename these markers without a defined migration mechanism.

## Migrations

Use sequential migrations only:

3 → 4
4 → 5
5 → 6

Each migration must:
- accept exactly one known schema
- return exactly the next schema
- operate on cloned data
- preserve unrelated fields
- have automated tests

## Progress behavior

Manual progress is the integer portion.

Tasks determine the decimal portion.

42 base + 3/4 tasks = 42.75%
99 base + all tasks complete = 99.99%
Explicit Complete = 100%

Bullets, links, and images do not affect progress.

## Image invariants

Image display resizing must never recompress the embedded source.

Preserve:
- src
- caption
- displayWidth
- intrinsic dimensions
- MIME type
- filename
- encoded size

## Update security

Official GitHub updates:
- never auto-install
- require explicit user approval
- require SHA-256 verification
- verify GitHub release asset digest when available

Manual offline updates:
- use the same migration engine
- must be labeled unverified when authenticity cannot be established
- require explicit confirmation

## Development workflow

Use test-first development for behavioral changes.

Work through the approved implementation plan task by task.

Before claiming completion, run all applicable tests, build validation,
migration tests, and legacy-v3 round-trip tests.

Do not publish a GitHub Release unless explicitly asked.

## Engineering restraint

Do not introduce a framework, database, server, runtime package manager,
state-management library, or build dependency unless it provides a clear
benefit required by the specification.

Prefer:
- browser-native APIs
- vanilla JavaScript
- Node built-ins where practical
- deterministic build tooling
- small focused modules

Do not convert the project to React/Vue/Svelte merely to modularize it.


The implementation plan is approved, but it is not sacred at the
line-by-line engineering level.

You may improve:
- module boundaries
- test organization
- dependency choices
- build mechanics
- internal APIs

You may not change without approval:
- user-facing behavior
- data migration guarantees
- update-security guarantees
- persistence architecture
- progress semantics
- image semantics
- self-contained release requirement

You may use subagents for independent work such as:

- migration test review
- security/integrity review
- build-system review
- legacy v3 behavior inventory

Do not have multiple agents concurrently modify the same files.

The primary agent remains responsible for integrating and independently
verifying all delegated work.