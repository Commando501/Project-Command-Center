# Project Command Center Agent Instructions

## Product invariant

Project Command Center is developed as modular source code but MUST ship as
one completely self-contained HTML file.

The release artifact must not require:

- a database
- a server
- npm at runtime
- external JavaScript
- external CSS
- external images
- browser extensions
- cloud storage

## Legacy compatibility

`Project-Command-Center-v3.html` is the legacy behavioral reference.

Do not remove or regress existing v3 functionality while modularizing it.

v3 data using:

/*__PROJECT_DATA_START__*/
/*__PROJECT_DATA_END__*/

must remain upgradeable.

v3 is treated as data schema 3.

## Permanent v4+ data contract

Use:

/*__PCC_DATA_START__*/
/*__PCC_DATA_END__*/

for the Data Capsule.

Use:

/*__PCC_RELEASE_METADATA_START__*/
/*__PCC_RELEASE_METADATA_END__*/

for application/release metadata.

Do not rename these markers without introducing an explicit migration path.

## User data safety

Never overwrite the currently opened HTML during an update.

Update flow must be:

old Data Capsule
→ clone
→ migrate
→ validate
→ inject into new App Shell
→ generate new HTML

If migration or validation fails, produce no upgraded HTML.

Never transmit project data during update checks.

## Updates

Online updates:

- check GitHub Releases
- never auto-install
- require explicit user approval
- require SHA-256 verification
- verify GitHub release asset digest when available

Manual updates:

- use the same migration engine
- verified official files may proceed normally
- offline/unverified files require an explicit warning and confirmation

## Migration rules

Migrations are sequential:

3 → 4
4 → 5
5 → 6

Never replace this with one migration function that guesses historical schemas.

Each migration must:

- accept one known schema
- return exactly the next schema
- operate on cloned data
- have automated tests

## Existing progress rules

Manual project progress is the integer portion.

Task completion determines the decimal portion.

Examples:

42 base + 3/4 tasks = 42.75%
99 base + all tasks complete = 99.99%
Explicit Complete status = 100%

Bullets, links, and images do not affect progression.

## Images

Images remain embedded in the standalone HTML.

Display resizing must not recompress the image source.

Preserve:

- src
- caption
- displayWidth
- intrinsic dimensions
- MIME type
- filename
- encoded size

## Development process

Use tests before implementing behavioral changes.

Before considering work complete, run:

npm test
npm run build
npm run validate:build

The standalone output must be tested against a legacy v3 fixture.

Do not claim completion if any required verification fails.

## Git

Make focused commits.

Do not rewrite history or force-push.

Do not publish a release until all release gates in the v4 implementation
plan pass.
