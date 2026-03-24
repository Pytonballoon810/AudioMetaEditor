# Performance Benchmark and Regression Guide

This guide defines how to measure startup, library load, and waveform latency consistently.

## Goals

Track these user-visible metrics over time:

- renderer first mount latency
- library scan latency
- first waveform load latency
- renderer heap usage at key checkpoints

## Instrumentation

Dev builds emit performance logs to the renderer console with the prefix `[perf]`.

Current markers:

- `[perf] renderer:first-mount: <ms>`
- `[perf] library:load: <ms>`
- `[perf] waveform:load: <ms>`
- `[perf] memory:<label> used=<MB> limit=<MB> (<percent>%)`

Implemented in:

- `src/lib/performance.ts`
- `src/App.tsx`
- `src/features/library/useLibraryState.ts`
- `src/hooks/useWaveSurfer.ts`

## Baseline Procedure

1. Start app in dev mode.
   - `npm run dev`
2. Open DevTools console for the renderer window.
3. Record `[perf] renderer:first-mount`.
4. Open a representative music folder and record `[perf] library:load`.
5. Select one medium-size track and record `[perf] waveform:load`.
6. Capture memory lines printed at `renderer:first-mount`, `library:load:end`, and `waveform:load:end`.

Repeat 3 times and keep the median for each metric.

## Suggested Bench Dataset

Keep a stable local dataset for comparisons:

- small: ~25 tracks (mixed MP3/WAV)
- medium: ~250 tracks
- large: ~1000 tracks
- at least one long track (>30 minutes)

Use the same dataset for all releases.

## Regression Budgets

Treat these as initial guardrails and tune over time:

- renderer first mount: do not regress by more than 20%
- library load: do not regress by more than 25% on the same dataset
- waveform load: do not regress by more than 20%
- memory usage at `waveform:load:end`: do not regress by more than 25%

## Reporting Template

Use this table in PR notes for perf-sensitive changes:

| Metric                      | Baseline | Change | Delta |
| --------------------------- | -------: | -----: | ----: |
| renderer:first-mount        |          |        |       |
| library:load (dataset size) |          |        |       |
| waveform:load (track name)  |          |        |       |
| memory:waveform:load:end    |          |        |       |

## Actions on Regression

If any metric exceeds budget:

1. confirm test conditions and rerun measurements
2. bisect recent changes affecting load path
3. inspect hot path logs for synchronous heavy work
4. ship only with documented exception and follow-up issue

## CI Guardrails

Static gates already run in CI and should remain required:

- `npm run lint`
- `npm run typecheck`
- `npm run tests`
- `npm run format`

Performance checks are currently manual but standardized by this guide.
