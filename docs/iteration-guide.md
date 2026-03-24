# Iteration Guide

This guide is for future feature requests. It is intentionally biased toward safe, incremental changes.

## Default implementation strategy

When adding a feature, decide first which bucket it belongs to:

1. Renderer-only UI feature
2. Native capability exposed through Electron
3. Metadata model change
4. Audio processing change
5. Packaging or OS integration change

That classification usually tells you which files should change.

## Renderer-only UI features

Examples:

- search and filtering
- better empty states
- keyboard shortcuts already backed by existing state
- layout changes

Typical files:

- `src/App.tsx`
- `src/components/*`
- `src/styles.css`

Guideline:

Do not add Electron dependencies or filesystem logic here. Keep UI features reading from the existing renderer state when possible.

## Native capabilities

Examples:

- drag-and-drop import handling in the shell
- reveal file in file manager
- open recent files
- save-as flows

Typical files:

- `electron/main.js`
- `electron/preload.js`
- `src/vite-env.d.ts`
- renderer call site

Checklist:

1. Add an IPC handler in the main process.
2. Expose it from preload.
3. Type it in `src/vite-env.d.ts`.
4. Use it from the renderer.
5. Update docs and validation steps.

## Metadata changes

Examples:

- lyricist
- BPM
- copyright
- publisher

Checklist:

1. Add the field to `EditableMetadata` in `src/types.ts`.
2. Extract it in `extractMetadata()`.
3. Persist it in `saveMetadata()`.
4. Add the field to `MetadataEditor`.
5. Confirm reloaded metadata matches what was saved.

Rule:

Do not add UI-only metadata fields that are not round-trippable unless the product explicitly wants derived or transient values.

## Audio processing changes

Examples:

- trim in place
- fade in and fade out
- normalization
- volume analysis
- waveform zoom generated from decoded data

Checklist:

1. Keep ffmpeg orchestration inside `electron/media-service.js`.
2. Make destructive operations opt-in.
3. Decide whether the result overwrites the source or creates a new file.
4. Return normalized results to the renderer.
5. Document format-specific caveats.

Rule:

If the operation can destroy user data, add an explicit confirmation step and document the risk.

## New audio formats

Adding a new format is more than extending the extension list.

Required checks:

1. Can `music-metadata` read the tags reliably?
2. Can ffmpeg write the fields you want to preserve?
3. Does waveform playback work through the custom protocol?
4. Does clip export preserve usable output?
5. Should the format be included in packaging file associations?

If any answer is uncertain, document the limitation instead of pretending full support exists.

## State management rules

Right now, `src/App.tsx` is the orchestration layer. That is acceptable while the app remains small.

Refactor into dedicated hooks or reducer-based state when any of these become true:

- more than one independently editable track is active
- playlist behavior becomes complex
- background jobs need progress tracking
- undo and redo are introduced
- app-level preferences are added

Until then, keep changes simple.

## Good places to refactor later

- Extract a `useLibrary` hook if import, filtering, sorting, and refresh behavior grow.
- Extract a `useMetadataEditor` hook if dirty-state, validation, or reset logic grows.
- Extract an Electron service contract file if the preload API grows beyond a small handful of methods.

## Suggested feature template

Use this structure when planning a new feature:

1. User-visible behavior
2. Affected layers
3. Data shape changes
4. IPC changes
5. Validation steps
6. Known risks

That keeps changes reviewable and reduces hidden coupling.

## Common mistakes to avoid

- Putting Node or Electron APIs directly into renderer code
- Adding format-specific behavior only in the UI and not in persistence
- Returning raw ffmpeg or parser output shapes to React components
- Making destructive edit operations the default behavior
- Expanding file support without updating dialogs, docs, and packaging together
