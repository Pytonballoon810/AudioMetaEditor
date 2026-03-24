# Release Readiness Checklist

Use this checklist for every release candidate.

## Release metadata

- [ ] Target version selected (example: `0.2.0`)
- [ ] Release type identified (`patch` / `minor` / `major`)
- [ ] Release owner assigned
- [ ] Target date and rollback owner assigned

## Version bump

1. Update `version` in `package.json`.
2. Confirm generated artifact names include the new version.
3. Verify app metadata for package targets still resolves correctly.

Verification command:

```bash
npm run build
```

## Changelog

Create/update release notes in your changelog entry using this template:

```md
## [<version>] - <YYYY-MM-DD>

### Added

- ...

### Changed

- ...

### Fixed

- ...

### Security

- ...

### Performance

- ...
```

Include:

- user-visible UI/behavior changes
- compatibility notes
- security policy changes (for example download host policy)
- migration notes pointer

## Migration notes (preload/API changes)

If preload bridge/API shape changed, include a migration section using this template:

```md
## Migration: <version>

### What changed

- ...

### Impact

- ...

### Required actions

1. Restart desktop app after upgrade.
2. Clear stale dev build caches if applicable.
3. Verify bridge contract and typings are updated together.

### Validation

- npm run typecheck
- npm run tests
```

## Mandatory quality gates

Run all before release sign-off:

```bash
npm run format
npm run lint
npm run typecheck
npm run tests
npm run build
```

## Final smoke matrix

Record pass/fail and evidence for each target environment.

| Area                  | Linux (dev) | Linux AppImage | Debian .deb | Fedora .rpm | Windows NSIS |
| --------------------- | ----------- | -------------- | ----------- | ----------- | ------------ |
| App launches          |             |                |             |             |              |
| Open file             |             |                |             |             |              |
| Open directory        |             |                |             |             |              |
| Play/Pause/Seek       |             |                |             |             |              |
| Waveform loads        |             |                |             |             |              |
| Save metadata         |             |                |             |             |              |
| Export clip           |             |                |             |             |              |
| Trim/Cut selection    |             |                |             |             |              |
| Move track to album   |             |                |             |             |              |
| Download from URL     |             |                |             |             |              |
| File association open |             |                |             |             |              |

## Security and policy checks

- [ ] CSP still compatible with release build behavior
- [ ] Private/local download hosts blocked by default
- [ ] `AUDIO_META_ALLOW_PRIVATE_DOWNLOADS` override behavior verified in trusted environment
- [ ] No new renderer direct Node/Electron imports introduced

## Release sign-off

- [ ] QA sign-off
- [ ] Security sign-off
- [ ] Release owner sign-off
- [ ] Rollback steps documented

## Rollback plan

At minimum, record:

1. last known good version
2. artifacts location for rollback
3. user-facing communication channel/message
4. criteria to trigger rollback
