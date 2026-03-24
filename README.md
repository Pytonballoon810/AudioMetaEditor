# AudioMetaEditor

The DAW that is not really a DAW.

AudioMetaEditor is a desktop audio workstation for people who do not need 600 tracks, 200 plugins, or a mixing console the size of a spaceship. It is built for focused audio metadata work with fast playback, waveform selection, album-level organization, and practical file operations.

## Why This Exists

Most tools are either:

- full DAWs that are overkill for tagging and organizing libraries, or
- tag editors with weak playback and almost no workflow ergonomics.

AudioMetaEditor sits in the middle:

- player-grade playback with waveform control,
- editor-grade metadata tooling,
- library-grade folder and album operations.

## Core Features

- Open audio files directly or scan folders recursively.
- Supported formats: `mp3`, `wav`.
- Waveform playback with range selection and clip export.
- Keyboard transport shortcut: `Space` for play/pause.
- Metadata editing for:
- `title`, `album`, `artist`, `albumArtist`, `composer`, `producer`, `genre`, `year`, `track`, `disc`, `comment`, `coverArt`.
- Suggestion dropdowns for repeated metadata values.
- Album-level metadata editing from the library album header.
- Per-field mismatch indicators in the metadata panel.
- Library grouping by album folder, with collapse/expand behavior.
- Album-level context menu actions:
- `Collapse all`, `Expand all`.
- Track-level context menu actions:
- `Move to album...` with loaded album targets,
- `Pick a different path...`,
- `Create new album...` with inline create-and-move flow.
- Root pseudoalbum behavior for opened directories:
- files in the opened directory root are grouped under `Root`,
- mismatch warnings are suppressed for that `Root` group.
- Session restore for last opened paths and active track.
- Built-in clip export (non-destructive to source).
- Packaging support for Linux (`AppImage`, `deb`, `rpm`) and Windows (`nsis`).

## Product Tour

### Library Pane

- Shows grouped albums based on folder structure.
- `Root` pseudoalbum is used for files that live directly in an opened directory.
- Album header click toggles collapse/expand.
- Album name click opens album metadata bulk editor.
- Right-click album header opens context menu for `Collapse all` and `Expand all`.
- Right-click track row opens file-move menu.

### Player Pane

- Waveform rendering via WaveSurfer.
- Selection looping and export range handling.
- Loading spinner for waveform refresh.
- Volume control in detail strip.

### Metadata Pane

- Track-level metadata editing form.
- Carry-over cover action from derived album covers.
- Album-wide apply button for selected track's folder.
- Field-level mismatch badge where the selected track differs from album consensus.

## Quick Start

### Prerequisites

- Node.js 20+ recommended.
- npm.
- Linux is the primary target, but packaging includes Windows output.

### Install

```bash
npm install
```

### Run in Development

```bash
npm run dev
```

This starts:

- Vite renderer at `http://127.0.0.1:5173`.
- Electron shell after renderer is reachable.

### Run Tests

```bash
npm run tests
```

### Type Check and Production Build

```bash
npx tsc --noEmit
npm run build
```

## Packaging Commands

- `npm run build:ubuntu` -> AppImage
- `npm run build:debian` -> `.deb`
- `npm run build:fedora` -> `.rpm`
- `npm run build:windows` -> NSIS installer

Build outputs are generated in `dist/`.

## Typical Workflows

### 1. Open and Clean Up an Album Folder

1. Click `Open directory`.
2. Select your album folder.
3. Review mismatch warnings in library and metadata panel.
4. Click album name to bulk-edit album fields.
5. Save changes to normalize metadata.

### 2. Reorganize Misplaced Tracks

1. Right-click a track.
2. Choose `Move to album...`.
3. Pick an existing album folder, or choose `Create new album...`.
4. Use `Create and move` to create the folder and move the file in one step.

### 3. Export a Clip

1. Select a track.
2. Drag/select waveform region.
3. Export clip to a new file.

## Keyboard and Interaction Notes

- `Space`: play/pause active track.
- Album header click: collapse/expand that album group.
- Right-click album header: open album group context menu.
- Right-click track: open move menu.

## Safety and File Behavior

- Metadata save writes back to source file.
- Clip export always writes a new file.
- File move uses safe fallback handling for cross-device operations.
- Name collisions during move are resolved by generating unique filenames.
- Network/GVFS paths use robust copy/staging fallbacks where needed.

## Architecture

### Stack

- Electron for shell, IPC, dialogs, and lifecycle.
- React + TypeScript renderer.
- Vite build/dev server.
- WaveSurfer for waveform UI.
- `music-metadata` for reads.
- `ffmpeg-static` and `ffprobe-static` for write/export and cover fallback extraction.

### High-Level Structure

```text
electron/
  main.js            Electron lifecycle + IPC handlers
  preload.js         secure renderer bridge (window.audioMetaApi)
  media-service.js   scanning, metadata extract/save, export, ffmpeg helpers
src/
  App.tsx            app orchestration and state
  components/        LibraryPane, PlayerPane, MetadataEditor
  hooks/             waveform hook and playback lifecycle
  lib/               formatting utilities
  types.ts           shared renderer types
```

## Additional Docs

- `CHANGELOG.md`
- `docs/architecture.md`
- `docs/iteration-guide.md`
- `docs/migrations/0.2.0-rc.1.md`
- `docs/release-readiness-checklist.md`
- `docs/releases/0.2.0-rc.1.md`
- `docs/releases/0.2.0-rc.2.md`
- `docs/security-hardening-checklist.md`
- `docs/validation.md`

## Troubleshooting

### Move API not available

If you see a status message about move API availability, restart the Electron app so preload/main changes are fully loaded.

Run:

```bash
npm run dev
```

### No audio files detected

- Confirm files are `.mp3` or `.wav`.
- Confirm the selected path exists and is readable.

### Cover art oddities

- Embedded cover behavior is strongest for MP3.
- Some WAV tag/art compatibility depends on downstream tools.

### Menu placement or stale UI behavior

If behavior seems stale after code updates, fully restart the dev app process.

## Current Scope and Limits

- Not a multi-track DAW.
- Not a plugin host.
- No timeline editing across multiple clips.
- Focus is deliberate: playback + metadata + practical file operations.

That is the point.

It is the DAW that is not really a DAW.

## Contributing

Contributions are welcome. For larger changes:

1. Read `docs/architecture.md`.
2. Follow `docs/iteration-guide.md`.
3. Run:

```bash
npm run tests
npx tsc --noEmit
```
