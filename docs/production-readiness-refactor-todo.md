# Production Readiness Refactor TODO

This checklist is intentionally exhaustive. Use it as a phased execution plan, not a single batch change.

## Phase 0: Baseline and Safety Nets

- [x] Create a dedicated `refactor/production-readiness` branch.
- [x] Capture a baseline build and test report (`npm run tests`, `npm run build`).
- [ ] Capture manual smoke baseline:
- [ ] Open file
- [ ] Open directory
- [ ] Play/pause/seek
- [ ] Save metadata
- [ ] Export clip
- [ ] Trim/cut selection
- [ ] Move track to album
- [ ] Download from URL
- [ ] Record memory usage while loading large files.
- [ ] Record startup and first-waveform render timings.

## Phase 1: Architecture Boundaries

- [ ] Split `src/App.tsx` into feature hooks/services:
- [ ] `useLibraryState`
- [ ] `useMetadataActions`
- [ ] `useTransportActions`
- [ ] `useSessionRestore`
- [x] Create `src/services/audioMetaApi.ts` as the only renderer bridge entrypoint.
- [x] Remove direct `window.audioMetaApi` usage from React components.
- [ ] Introduce domain folders:
- [ ] `src/features/library`
- [ ] `src/features/player`
- [ ] `src/features/metadata`
- [ ] Keep components mostly presentational; move orchestration into hooks.

## Phase 2: IPC Contract Hardening

- [x] Define shared request/response types for each IPC channel.
- [x] Add runtime payload validation in `electron/main.js` handlers.
- [ ] Return structured error objects from main process handlers.
- [ ] Normalize renderer-side error mapping and user status messages.
- [ ] Add a typed wrapper for `ipcRenderer.invoke` with channel-specific signatures.
- [ ] Add versioning strategy for preload API shape changes.

## Phase 3: Electron Main Process Refactor

- [ ] Split `electron/main.js` into modules:
- [ ] `window-factory.js`
- [ ] `ipc/handlers/*.js`
- [ ] `download-service.js`
- [ ] `launch-paths.js`
- [ ] Replace ad-hoc logs with leveled logger utility.
- [ ] Add per-handler input guard clauses and assertions.
- [ ] Add graceful fallback for protocol failures with telemetry context.
- [ ] Ensure all async handlers use centralized error boundary wrapper.

## Phase 4: Media Service Reliability

- [ ] Split `electron/media-service.js` into:
- [ ] `library-scan.js`
- [ ] `metadata-extract.js`
- [ ] `metadata-save.js`
- [ ] `audio-edit.js`
- [ ] `cover-art.js`
- [ ] Replace recursive scanner with iterative queue for very deep trees.
- [ ] Add cancellation support for long-running scans.
- [ ] Add explicit timeout and stderr parsing for ffmpeg/ffprobe calls.
- [ ] Add cleanup guards for temp file leaks under partial failures.
- [ ] Add collision-safe temp file naming strategy (UUID-based).
- [ ] Add retry strategy for transient network mount failures.

## Phase 5: Audio Loading Pipeline

- [ ] Revisit `audio:load-blob` memory strategy for large files.
- [ ] Evaluate file/protocol streaming path instead of base64 data URLs.
- [ ] If base64 retained, enforce max-size guard and user-facing guidance.
- [ ] Add progressive loading telemetry for waveform readiness.
- [ ] Ensure cleanup of object URLs/data allocations on track changes.

## Phase 6: Hook and Component Refactor

- [ ] Refactor `useWaveSurfer` into smaller concerns:
- [ ] init/destroy
- [ ] selection state
- [ ] loop behavior
- [ ] loading state
- [ ] Remove `any` usage from `useWaveSurfer`.
- [ ] Add explicit finite-state model for player/loading/editing states.
- [ ] Extract reusable suggestion input logic from metadata and album dialogs.
- [ ] Add controlled state reset points for modal/context-menu interactions.

## Phase 7: Testing Expansion

- [ ] Add tests for IPC handler validation and error cases.
- [ ] Add tests for media-service temp file cleanup on failure.
- [ ] Add tests for malformed metadata and cover-art payloads.
- [x] Add import-level references from implementation modules to their primary test files (comment links for maintenance).
- [ ] Add renderer tests for:
- [ ] session restore
- [ ] API unavailable fallback
- [ ] toolbar operations
- [ ] album bulk-edit flows
- [ ] Add integration smoke tests for Electron critical flows.
- [ ] Add regression tests for rapid track switching and stale callbacks.

## Phase 8: Comments and Documentation

- [ ] Add concise comments only at non-obvious logic points:
- [ ] race-condition guards
- [ ] filesystem fallback behavior
- [ ] protocol/bridge assumptions
- [ ] album mismatch canonicalization
- [x] Document app architecture in `docs/architecture.md` with module boundaries.
- [ ] Add sequence diagrams for:
- [x] load-library flow
- [x] save-metadata flow
- [x] waveform load flow
- [x] edit-selection flow
- [x] Add troubleshooting section for preload bridge/version mismatch.

## Phase 9: Quality Gates and Tooling

- [x] Add ESLint config with TypeScript and React rules.
- [x] Add Prettier config and formatting script.
- [x] Add `npm run typecheck` script and CI step.
- [x] Add CI matrix for Linux/Windows packaging smoke checks.
- [ ] Add conventional commit + PR checklist template.

## Phase 10: Security and Release Readiness

- [x] Review Electron security checklist and document current posture.
- [x] Validate CSP strategy for production build.
- [x] Ensure context isolation, sandbox assumptions, and preload constraints are documented.
- [x] Add download URL allowlist/denylist policy decisions.
- [x] Add release checklist:
- [x] version bump
- [x] changelog
- [x] migration notes for preload/API changes
- [x] final smoke test matrix

## Suggested Execution Order for This Repo

1. Phase 1 (App split + API service) and Phase 2 (typed IPC contracts)
2. Phase 3 and Phase 4 (main/media modularization)
3. Phase 6 and Phase 7 (hook cleanup + tests)
4. Phase 5 (audio loading strategy), then Phase 10 hardening

## Done in Current Pass

- [x] Added bridge-usage guard path in renderer orchestration (`App.tsx`).
- [x] Added focused comments in complex backend flows (`main.js`, `media-service.js`).
- [x] Captured this exhaustive roadmap for staged refactor execution.
- [x] Centralized renderer bridge access in `src/services/audioMetaApi.ts`.
- [x] Removed direct bridge globals from React code paths (`App.tsx`, `useWaveSurfer.ts`).
- [x] Extracted library loading/sizing state into `src/features/library/useLibraryState.ts`.
- [x] Extracted session restore and preload event subscriptions into dedicated hooks.
- [x] Extracted metadata save/bulk-edit orchestration into `src/features/metadata/useMetadataActions.ts`.
- [x] Extracted export/edit/move/download orchestration into `src/features/player/useTransportActions.ts`.
- [x] Extracted library-derived metadata/album calculations into `src/features/library/useLibraryDerivations.ts`.
- [x] Gated waveform debug logs to dev mode to reduce production console noise.
- [x] Added shared renderer IPC contract types in `src/ipc/contracts.ts` and wired global API typing to them.
- [x] Added validator unit tests in `tests/ipc-validators.test.js`.
- [x] Added consistent IPC error-prefix wrapping in `electron/main.js` handler registration.
- [x] Added shared renderer error normalization utility in `src/lib/errors.ts` and applied it across hooks/actions.
- [x] Added large-file guard for `audio:load-blob` in `electron/main.js` to avoid unsafe in-memory waveform loads.
- [x] Added stale/invalid region selection guards in `src/hooks/useWaveSurfer.ts`.
- [x] Extracted blob-read file I/O into `electron/file-io.js` with focused tests in `tests/file-io.test.js`.
- [x] Added branch workflow guidance in `docs/branch-strategy.md` for focused refactor slices.
- [x] Strengthened TypeScript strictness in `tsconfig.json` (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`) and resolved surfaced type-safety issues.
- [x] Added Electron-main smoke coverage in `tests/main-utils.test.js` by extracting launch/download path helpers into `electron/main-utils.js`.
- [x] Rewrote `docs/architecture.md` with ADR-style decisions, module boundaries, sequence diagrams, and preload mismatch troubleshooting.
- [x] Added perf instrumentation logs for startup/library/waveform paths and captured benchmark protocol in `docs/performance-benchmark.md`.
- [x] Added security hardening checklist in `docs/security-hardening-checklist.md`, baseline CSP in `index.html`, and private-host download blocking policy with override in `electron/main.js`.
- [x] Added `docs/release-readiness-checklist.md` with version/changelog/migration templates and cross-platform final smoke matrix.
- [x] Drafted release artifacts for `0.2.0-rc.1` in `CHANGELOG.md`, `docs/migrations/0.2.0-rc.1.md`, and `docs/releases/0.2.0-rc.1.md`.
- [x] Aligned package version to `0.2.0-rc.1` and validated packaging outputs for Ubuntu/Debian/Fedora/Windows installers.
