# Validation

There is no automated test suite yet. Until one exists, every feature should be validated with both static checks and targeted manual checks.

## Static validation

Run these commands before considering a feature complete:

```bash
npx tsc --noEmit
npm run build
```

What they cover:

- `npx tsc --noEmit`
  Ensures the renderer TypeScript code and ambient bridge typing still compile.

- `npm run build`
  Ensures the renderer bundles and Electron Builder can still package the application.

## CI validation

The repository includes a GitHub Actions pipeline at `.github/workflows/build.yml`.

It currently validates packaging on these targets:

- Ubuntu via AppImage
- Debian via `.deb`
- Fedora via `.rpm`
- Windows via NSIS `.exe`

If you change packaging configuration, update both local validation expectations and the workflow.

## Manual regression checklist

## Core app flow

- Launch the app directly.
- Open one MP3 file.
- Open one WAV file.
- Open a directory containing mixed supported files.
- Select a different track from the library and confirm the active track changes.

## Playback and waveform

- Confirm the waveform renders for the selected file.
- Press play and pause.
- Drag the selection region.
- Edit the start and end time inputs manually.
- Jump to the selection start.

## Metadata editing

- Change title, artist, album, composer, and producer.
- Save metadata.
- Confirm the status message reports success.
- Re-open the same file and confirm the saved metadata is still present.
- Replace artwork on an MP3 file and confirm it reloads correctly.

## Clip export

- Select a short segment.
- Export the segment to a new file.
- Open the exported clip and confirm it plays.
- Confirm the original source file remains unchanged.

## File association flow

- Install the packaged `.deb` or run the AppImage.
- Open an MP3 or WAV file from the file manager with AudioMetaEditor.
- Confirm the app window loads that file automatically.

## When to expand validation

Add more manual checks when a feature touches:

- new audio formats
- destructive editing
- playlist behavior
- drag and drop
- background processing
- packaging and installation

If automated tests are introduced later, update this file instead of leaving validation knowledge scattered across pull requests.

## Performance regression tracking

For startup, library load, waveform timing, and memory regression checks, follow:

- `docs/performance-benchmark.md`
