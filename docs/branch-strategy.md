# Refactor Branch Strategy

Use short-lived branches for each production-readiness slice. Keep each PR limited to one logical concern.

## Branch Naming

- `refactor/production-readiness` for umbrella tracking only.
- `refactor/pr-<topic>` for implementation slices.
- `fix/pr-<topic>` for regressions found during refactor.

Examples:

- `refactor/pr-ci-quality-gates`
- `refactor/pr-ipc-contract-hardening`
- `fix/pr-waveform-stale-callback`

## Merge Workflow

1. Branch from `main`.
2. Implement one focused slice.
3. Run local gates before opening PR:
   - `npm run format`
   - `npm run lint`
   - `npm run typecheck`
   - `npm run tests`
4. Open PR to `main`.
5. Require CI green and at least one review.
6. Squash merge with a descriptive title.

## Commit Strategy

- Keep commits small and scoped.
- Use imperative messages.
- Suggested prefix convention:
  - `refactor:` structural changes
  - `fix:` behavior corrections
  - `test:` test additions/updates
  - `docs:` docs/process updates

## Rollback Strategy

- Revert by PR merge commit if a refactor slice regresses.
- Avoid mixing unrelated concerns in one PR to keep rollback safe.
