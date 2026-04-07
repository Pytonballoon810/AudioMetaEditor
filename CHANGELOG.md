# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Added repository operations guide in `AGENTS.md` for context loading and agent workflows.
- Added visual system specification in `DESIGN.md` (palette, typography, layout, motion, and maintenance rules).

## [v1] - 2026-04-03

### Changed

- CI release-tag workflow updated to include `GH_TOKEN` for tag publishing reliability.

## [v1.0.0] - 2026-03-27

### Added

- Stable release line for AudioMetaEditor v1.0.0.
- Audio conversion dropdown and FLAC support in player/import flows.

### Changed

- Cover editing workflow/toolbars unified and refined across library/metadata/player contexts.

### Fixed

- Reliability and UX fixes including cover persistence behavior, waveform loading robustness, and metadata-related polish.

## [0.2.0-rc.2] - 2026-03-24

### Fixed

- Resolved CSP regression that blocked WaveSurfer from loading `data:audio/*` URLs by allowing `data:` in `connect-src`.
- Removed `frame-ancestors` from meta CSP to avoid ignored-directive noise and false confidence.

### Added

- Added CSP regression tests in `tests/csp.test.ts` to ensure:
  - CSP meta remains present.
  - `connect-src` includes `data:` for waveform `data:` fetches.
  - `frame-ancestors` is not used in meta CSP.

## [0.2.0-rc.1] - 2026-03-24

### Added

- Production-readiness docs suite:
  - `docs/architecture.md`
  - `docs/performance-benchmark.md`
  - `docs/security-hardening-checklist.md`
  - `docs/release-readiness-checklist.md`
- New Electron main utility module `electron/main-utils.js` with smoke coverage.
- Performance telemetry utility `src/lib/performance.ts` with `[perf]` logs for startup, library load, and waveform load.

### Changed

- `App` orchestration split into feature hooks for library, metadata, transport, and bridge subscriptions.
- Renderer bridge access centralized through `src/services/audioMetaApi.ts`.
- IPC contracts typed via `src/ipc/contracts.ts` and wired into renderer typing.
- CI now enforces quality gates before packaging artifacts.

### Fixed

- Preload compatibility/runtime issues and bridge-availability fallbacks.
- WaveSurfer stale callback and region race handling during rapid track switching.
- Large audio blob read safety and bounded in-memory handling.

### Security

- Added baseline CSP in `index.html`.
- Added private/local host download blocking policy in `electron/main.js` with trusted-network override via `AUDIO_META_ALLOW_PRIVATE_DOWNLOADS=true`.
- Added and documented IPC payload validation strategy.

### Performance

- Added measurable benchmark points and memory snapshots for core flows.
- Added benchmark playbook and regression budgets in `docs/performance-benchmark.md`.

### Validation

- Quality gates passing during this release candidate cycle:
  - `npm run format`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run tests`

[Unreleased]: https://github.com/Pytonballoon810/AudioMetaEditor/compare/v1...main
[v1]: https://github.com/Pytonballoon810/AudioMetaEditor/releases/tag/v1
[v1.0.0]: https://github.com/Pytonballoon810/AudioMetaEditor/releases/tag/v1.0.0
[0.2.0-rc.2]: https://github.com/Pytonballoon810/AudioMetaEditor/blob/main/docs/releases/0.2.0-rc.2.md
[0.2.0-rc.1]: https://github.com/Pytonballoon810/AudioMetaEditor/blob/main/docs/releases/0.2.0-rc.1.md
