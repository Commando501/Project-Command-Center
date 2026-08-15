# Project Command Center v3 — Images, Links, and Resizable Embedded Media

**Date:** 2026-08-14  
**Target:** `Project-Command-Center-v2.html` → `Project-Command-Center-v3.html`  
**Architecture:** One self-contained HTML file; no database, server, framework, external stylesheet, external script, or separate media files.

## 1. Goals

Enhance the existing Project Command Center with:

1. Embedded image uploads stored directly inside the HTML.
2. Adaptive client-side image optimization before embedding.
3. Freely resizable image blocks whose display size is independent of the stored image resolution.
4. Dedicated hyperlink content blocks.
5. Automatic clickable URL rendering in notes, bullets, and task text.
6. Per-image and per-project embedded-storage visibility.
7. Full compatibility with the existing inline editing, clickable tag filtering, nested tasks/bullets, decimal subtask progress, HTML export, and JSON backup behavior.

## 2. Unified Mixed Content Stream

Each project continues to use `contentItems`, extended to support these item types:

- `task`
- `bullet`
- `link`
- `image`

Items are displayed in the order stored in the project array.

The stream is intentionally one level deep in this revision. Arbitrary nested trees and drag-and-drop ordering are out of scope.

## 3. Link Blocks

A dedicated `link` item contains:

```js
{
  id,
  type: "link",
  label,
  url
}
```

Behavior:

- Label is editable inline.
- URL is editable inline.
- Valid `http://` and `https://` URLs open in a new tab.
- Unsafe or malformed schemes are never turned into active links.
- Link blocks can be deleted.
- Empty link blocks are not preserved in exported data.

## 4. Automatic URL Linking in Text

Notes, bullets, and task text may contain ordinary plain-text URLs.

When those fields are displayed in read mode:

- `http://...` and `https://...` sequences become clickable links.
- Non-URL surrounding text remains unchanged.
- User text remains HTML-escaped before links are inserted.
- Links open in a new tab with `rel="noopener noreferrer"`.

When editing, the field remains plain text.

## 5. Image Block Data Model

An image content item contains:

```js
{
  id,
  type: "image",
  src,               // embedded data URL
  caption,
  filename,
  mimeType,
  width,             // intrinsic optimized width
  height,            // intrinsic optimized height
  displayWidth,      // desired CSS display width in px or null for fit-width
  originalWidth,
  originalHeight,
  sizeBytes,
  optimizedAt
}
```

Optional implementation-only metadata may be added if needed for re-optimization, provided the final file remains self-contained.

## 6. Upload Limits

Before decoding/optimization:

- Soft warning threshold: **5 MB**
- Hard per-source-image upload limit: **25 MB**

Behavior:

- Files larger than 25 MB are rejected before processing.
- Files larger than 5 MB but at or below 25 MB are accepted after a warning.
- The UI shows the optimized embedded size after processing.

## 7. Adaptive Image Optimization Pipeline

### 7.1 General Rules

- Never upscale during initial optimization.
- Preserve aspect ratio.
- Default maximum long edge: **1600 px**.
- If the source is already at or below the long-edge limit, it may remain at original dimensions.
- Re-rendering through Canvas strips most unnecessary metadata.

### 7.2 Candidate Selection

For an uploaded image:

1. Decode the source image.
2. Determine the target dimensions using the 1600 px long-edge cap.
3. Generate a high-quality WebP candidate using native browser encoding.
4. Optionally probe native AVIF encoding:
   - Attempt AVIF only if the browser actually returns `image/avif`.
   - Do not assume AVIF encode support from decode/display support.
5. Generate or preserve fallback candidates as needed.
6. Compare candidate byte sizes.
7. Select the smallest acceptable candidate that meets visual-quality expectations.
8. If the original source is already within the dimension cap and is smaller than the generated optimized candidate, retain the original instead.

### 7.3 Quality Policy

Primary goal: smallest practical embedded file while maintaining near-lossless visual quality.

Recommended defaults:

- WebP quality target: high-quality / visually lossless range.
- AVIF, when genuinely available, may use a similarly conservative high-quality setting.
- PNG/original may be retained for graphics where lossy encoding would noticeably degrade sharp edges, text, transparency, or flat-color art.

The implementation may use a heuristic based on transparency, source type, dimensions, and candidate byte size.

### 7.4 Fallback

If the browser cannot encode WebP or AVIF:

- Fall back to PNG/JPEG as appropriate.
- Never silently fail an upload solely because an optional codec is unavailable.

## 8. Free Display Resizing

The stored optimized image data and the displayed size are independent.

Each image block supports:

- Drag-resize using a corner handle.
- Preserve aspect ratio by default.
- `Fit width`
- `Original size`
- `Re-optimize larger`
- `Replace image`
- `Remove image`

Changing display size:

- Updates `displayWidth`.
- Does not recompress or rewrite `src`.
- Marks the document dirty.
- Persists into the generated HTML export.

The rendered image may be enlarged beyond its intrinsic optimized resolution, but the UI should not claim this improves source detail.

## 9. Re-optimize Larger

If the user decides that a 1600 px optimized source is insufficient:

- `Re-optimize larger` allows selecting a larger target cap from the still-available source during the current session when possible, or by reselecting/replacing the original source file.
- Recommended selectable target caps:
  - 1600 px
  - 2400 px
  - 3200 px
  - Preserve source dimensions

If the original source bytes are not retained in the project, re-optimization beyond the already embedded resolution requires the user to reselect the source image.

The project does **not** retain the full original image by default, because doing so would defeat the file-size optimization goal.

## 10. Image Captions

Each image block has an optional editable caption.

Captions:

- Are plain text.
- May contain auto-linked `http://` or `https://` URLs when displayed.
- Do not affect project progress.

## 11. Storage Visibility

The UI shows:

### Per image
- Embedded size after optimization
- Encoded format
- Intrinsic dimensions

### Per project
- Total bytes used by embedded image blocks
- Human-readable total such as `2.4 MB`

Optional overall file/media total may also be shown if implementation remains compact.

## 12. Image Block Rendering

Inside the expanded project details:

- Images render responsively.
- `displayWidth` controls their normal desktop size.
- CSS prevents images from overflowing the card/container.
- Clicking the image opens a lightweight in-page enlarged view/lightbox.
- The lightbox does not navigate away from the tracker.
- Image controls remain accessible on mobile.

## 13. Existing Progress Behavior Remains Unchanged

- Manual base progress is the integer portion.
- Tasks contribute the decimal portion.
- All tasks complete contribute `.99`.
- Base `99` plus all tasks complete displays `99.99%`.
- Explicit project completion displays `100%`.
- Images, links, bullets, and captions do not affect progress.

## 14. Data Normalization

`normalizeContentItem()` is extended to safely normalize:

- legacy task items
- legacy bullet items
- new link items
- new image items

Malformed content must never break project loading.

Legacy projects with no `contentItems` remain valid.

## 15. Persistence

The existing persistence approach remains unchanged:

- All project data stays in memory while the page is open.
- Images are stored as data URLs inside `project.contentItems`.
- `Save Updated HTML` embeds the entire project array, including image data.
- JSON backup includes image data and link blocks.
- No external media files are required after export.

## 16. File Size Considerations

Because Base64/data URLs add storage overhead:

- Optimized source size should be minimized before embedding.
- UI should surface large per-project image totals.
- The page may warn when aggregate embedded images become unusually large.
- No arbitrary project-level hard limit is imposed in this revision.

## 17. Safety and Error Handling

- Only image MIME types supported by browser decoding are accepted.
- Corrupt or undecodable files show an error without breaking the page.
- Unsafe URL schemes are never activated.
- User text remains escaped before display.
- Image processing errors leave the project unchanged.
- Replacing an image only commits once the new source is successfully processed.
- Large uploads rejected by the 25 MB cap never enter the project model.

## 18. Backward Compatibility

Opening an HTML produced by v2 must:

- Load all existing projects.
- Preserve tasks, bullets, tags, notes, links, progress, and existing fields.
- Normalize missing image/link-specific properties safely.
- Require no user migration.

## 19. Verification

Before handoff verify:

- v2 project data loads correctly.
- Image upload works for common PNG/JPEG/WebP inputs.
- 25 MB+ images are rejected.
- 5 MB+ accepted images produce a warning.
- Images are embedded as self-contained data URLs.
- Adaptive candidate selection produces a valid encoded image.
- Image display resizing persists without changing `src`.
- Fit width and Original size work.
- Replace and Remove work.
- Captions persist.
- Link blocks open valid HTTP(S) URLs.
- Unsafe URL schemes are inert.
- URLs inside notes/tasks/bullets/captions render clickable in display mode.
- Per-image and per-project byte totals are correct.
- Images and links do not affect task-derived progress.
- Save Updated HTML preserves images, dimensions, captions, links, and display sizes.
- Reopening the generated HTML restores the same data.
- JSON backup contains the new fields.
- JavaScript parses without syntax errors.
- No external dependencies were introduced.
- Mobile layout remains usable.

## 20. Out of Scope for v3

- Cloud/media hosting
- External image database
- Full original image retention by default
- Bundled WASM AVIF encoder
- Arbitrary multi-level content nesting
- Drag-and-drop content reordering
- Image annotation/cropping editor
- Collaborative editing
