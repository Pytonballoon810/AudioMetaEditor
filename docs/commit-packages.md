# Commit Packages

This file tracks the intentional commit split used to reconstruct project history.

## Package 1: App baseline and Electron runtime

- `package.json`, `package-lock.json`
- `tsconfig*.json`, `vite*.ts`, `index.html`
- `electron/main.js`, `electron/preload.js`, `electron/media-service.js`
- `src/main.tsx`, `src/App.tsx`, `src/types.ts`, `src/styles.css`
- UI components under `src/components/*`

Commit message:

- `feat(core): bootstrap electron renderer baseline`

## Package 2: Renderer feature modularization

- `src/features/library/*`
- `src/features/metadata/*`
- `src/features/player/*`
- `src/services/audioMetaApi.ts`
- `src/hooks/useWaveSurfer.ts`

Commit message:

- `refactor(renderer): split app orchestration into feature hooks`

## Package 3: IPC contracts, validation, and file I/O hardening

- `src/ipc/contracts.ts`
- `src/vite-env.d.ts`
- `src/lib/errors.ts`
- `electron/ipc-validators.js`
- `electron/file-io.js`
- `electron/main-utils.js`

Commit message:

- `feat(ipc): add typed contracts validators and hardened io helpers`

## Package 4: Test coverage expansion

- `tests/*`

Commit message:

- `test: add unit and smoke coverage for ipc media io and main utils`

## Package 5: Quality gates and strictness

- `.github/workflows/build.yml`
- `eslint.config.mjs`
- `.prettierrc.json`, `.prettierignore`
- `tsconfig.json`

Commit message:

- `chore(quality): enforce lint format typecheck and ci gates`

## Package 6: Architecture and engineering docs

- `docs/architecture.md`
- `docs/iteration-guide.md`
- `docs/validation.md`
- `docs/branch-strategy.md`
- `docs/performance-benchmark.md`
- `docs/security-hardening-checklist.md`
- `docs/production-readiness-refactor-todo.md`

Commit message:

- `docs: add architecture security and performance playbooks`

## Package 7: Release docs and metadata

- `docs/release-readiness-checklist.md`
- `docs/releases/0.2.0-rc.1.md`
- `docs/migrations/0.2.0-rc.1.md`
- `CHANGELOG.md`
- `README.md`

Commit message:

- `docs(release): add rc notes migration and release checklist`
