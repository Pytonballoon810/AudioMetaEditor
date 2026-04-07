# AGENTS.md

Operational guide for human and AI coding agents working in this repository.

## Objective

Keep changes safe, incremental, and contract-consistent across Electron main, preload bridge, and React renderer.

## Architecture Snapshot

- Main process: `electron/main.js` (IPC handlers, dialogs, lifecycle, protocol)
- Native services: `electron/media-service.js`, `electron/file-io.js`, `electron/main-utils.js`, `electron/ipc-validators.js`
- Preload bridge: `electron/preload.js` (`window.audioMetaApi` surface)
- Renderer orchestration: `src/App.tsx`
- Renderer bridge accessor/cache: `src/services/audioMetaApi.ts`
- Shared API contracts: `src/ipc/contracts.ts`, `src/types.ts`, `src/vite-env.d.ts`
- Feature hooks:
	- Library: `src/features/library/*`
	- Metadata: `src/features/metadata/*`
	- Player/transport: `src/features/player/*`
- Key tests: `tests/*.test.*`

Primary invariant: renderer must not directly use Node/Electron APIs; privileged work must cross preload IPC.

## Context Loading Strategy

Use progressive context loading to stay fast and accurate.

### Level 1: Fast Scan (always)

Read first:

1. `README.md`
2. `docs/architecture.md`
3. `package.json`
4. `DESIGN.md`
5. This file (`AGENTS.md`)
6. `.github/copilot/SKILLS/MERGE_BRANCH.md` when merge-to-main work is requested
7. `.github/copilot/SKILLS/COMMIT.md` when commit creation is requested

Outcome: identify feature area, runtime boundary, and validation commands.

### Level 2: Change-Area Expansion

Load files by task type:

- UI/layout behavior:
	- `src/App.tsx`
	- `src/components/*`
	- `src/styles.css`
- Metadata field/model change:
	- `src/types.ts`
	- `electron/media-service.js`
	- `src/components/MetadataEditor.tsx`
	- `src/features/metadata/useMetadataActions.ts`
- IPC/native capability change:
	- `electron/main.js`
	- `electron/preload.js`
	- `electron/ipc-validators.js`
	- `src/ipc/contracts.ts`
	- `src/services/audioMetaApi.ts`
	- `src/vite-env.d.ts`
- Audio transport/edit/export:
	- `src/features/player/useTransportActions.ts`
	- `src/components/PlayerPane.tsx`
	- `src/hooks/useWaveSurfer.ts`
	- `electron/media-service.js`

### Level 3: Safety and Regression Expansion

Read and/or run:

- `tests/ipc-validators.test.js`
- `tests/media-service.test.js`
- Related `tests/*.test.*` for touched modules
- `docs/validation.md`
- `docs/performance-benchmark.md` when touching loading/waveform/perf-sensitive paths

## Agentic Workflows

### Workflow A: Renderer-only Change

1. Update renderer state/components only.
2. Ensure no Electron import is introduced in renderer.
3. Validate with `npm run typecheck`, `npm run tests`, `npm run lint`.

### Workflow B: New Native Feature via IPC

Implement in strict order:

1. Add validator in `electron/ipc-validators.js`.
2. Add main handler in `electron/main.js` using validator before side effects.
3. Expose preload method in `electron/preload.js`.
4. Update shared typings in `src/ipc/contracts.ts` and `src/vite-env.d.ts`.
5. Add/adjust renderer accessor usage in `src/services/audioMetaApi.ts` and feature call site.
6. Add tests for validator and behavior.
7. Run validation commands.

### Workflow C: Metadata Field Lifecycle Change

Update all layers together:

1. Types (`src/types.ts`, contract types if needed).
2. Extraction and persistence (`electron/media-service.js`).
3. Editor UI (`src/components/MetadataEditor.tsx`).
4. Save/apply logic (`src/features/metadata/useMetadataActions.ts`).
5. Round-trip verification by reload after save.

No partial metadata changes: field must be round-trippable or explicitly documented as derived-only.

### Workflow D: Audio Edit/Export Behavior Change

1. Keep ffmpeg orchestration in `electron/media-service.js`.
2. Preserve non-destructive defaults unless explicitly changing product behavior.
3. Keep renderer messaging user-first and channel-aware.
4. Validate trim/cut/export/manual playback path.

### Workflow E: Merge Branch Into Main

When explicitly instructed to merge a branch into `main`, follow `.github/copilot/SKILLS/MERGE_BRANCH.md`.

Mandatory rules:

1. Preserve history always.
2. Use merge commit mode only (`git merge --no-ff`).
3. Never squash or rebase merges for this workflow.
4. Immediately update `CHANGELOG.md` under `Unreleased` with contributor attribution in this format:
	- `- brief description of what the branch implemented - ~ [@user](https://github.com/user)`

### Workflow F: Commit Changes

When explicitly instructed to create commits, follow `.github/copilot/SKILLS/COMMIT.md`.

Mandatory rules:

1. If there are multiple features or many changed files, split into small commits by intent whenever possible.
2. Keep release/version metadata changes separate where practical.
3. If `package.json` version changes, ensure a matching tag is created for that version commit.
4. If a release tag is requested but `package.json` is not aligned, update `package.json`, commit, then tag that commit.

## Contract Integrity Rules

When changing preload/main bridge surface, update these together in the same PR:

- `electron/main.js`
- `electron/preload.js`
- `src/ipc/contracts.ts`
- `src/vite-env.d.ts`
- Renderer call site(s)
- Tests for validators/contracts

## Validation Commands

Run for any non-trivial change:

```bash
npm run typecheck
npm run tests
npm run lint
npm run build
```

If packaging/build config changed, also run target-specific build script(s) in `package.json`.

## PR and Commit Guidance

- Prefer small, vertical slices.
- Do not mix refactors with behavior changes unless necessary.
- Include a short test note in PR description: what was run, what was manually verified.
- If changing contracts/IPC, call that out explicitly in PR summary.
- Update `CHANGELOG.md` for user-visible behavior changes, release/process changes, or dependency/runtime policy changes.

## Always Keep This File Updated

This file is a living operations contract and must track reality.

Mandatory policy:

1. Any PR that changes architecture boundaries, IPC channels, preload API methods, validation commands, or feature workflows must update `AGENTS.md` in the same PR.
2. If no update is needed, explicitly state why in the PR description.
3. Reviewers should treat stale `AGENTS.md` as a blocking issue.

Minimum update triggers:

- New/renamed IPC channel
- New/removed preload API method
- Contract/type shape change affecting bridge payloads
- New major feature hook or service boundary
- Validation command or quality gate changes
- Significant workflow/policy changes in docs
- Visual system changes requiring `DESIGN.md` updates (tokens, typography, breakpoints, component style conventions)
- User-visible feature/fix changes that must be reflected in `CHANGELOG.md`
- New tags/releases that require adding or updating changelog version links

## Quick Start for New Agents

1. Read `README.md`, `docs/architecture.md`, and `AGENTS.md`.
2. Identify change workflow (A/B/C/D above).
3. Load only relevant module cluster first, then expand.
4. Implement smallest safe patch.
5. Run validation commands.
6. Update `AGENTS.md` if any trigger applies.
