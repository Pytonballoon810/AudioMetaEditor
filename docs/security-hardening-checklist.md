# Security Hardening Checklist

This checklist documents current security posture and required controls for releases.

## Current posture summary

Implemented controls:

- renderer isolation via `contextIsolation: true`
- `nodeIntegration: false` in renderer window
- preload bridge is explicit through `contextBridge.exposeInMainWorld`
- IPC payload validation in `electron/ipc-validators.js`
- channel-prefixed IPC error wrapping to avoid silent failures
- bounded local file reads for waveform load (`MAX_AUDIO_BLOB_BYTES`)
- baseline CSP in `index.html`
- URL download policy blocks private/local hosts by default

## Electron window and preload controls

Required:

- [x] `contextIsolation: true`
- [x] `nodeIntegration: false`
- [x] only preload-exposed API surface used by renderer
- [x] no direct `electron` or `node:*` imports in renderer code

Documented assumptions:

- preload runs in isolated context and is the only trusted boundary between unprivileged UI and native APIs
- bridge changes must be reflected in `src/ipc/contracts.ts` and `src/vite-env.d.ts`

## IPC and input validation

Required:

- [x] validate every `ipcMain.handle` payload before side effects
- [x] reject invalid file paths, URLs, numeric ranges, and mode enums
- [x] keep validators unit-tested in `tests/ipc-validators.test.js`

## CSP strategy

Policy is defined in `index.html` via meta CSP.

Current directives:

- `default-src 'self'`
- `script-src 'self'`
- `style-src 'self' 'unsafe-inline'`
- `img-src 'self' data: blob: audio-meta:`
- `media-src 'self' data: blob: audio-meta:`
- `font-src 'self' data:`
- `connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173 audio-meta:`
- `object-src 'none'`
- `base-uri 'self'`
- `frame-ancestors 'none'`

Notes:

- dev server endpoints are intentionally included in `connect-src`
- if future external APIs are needed, extend `connect-src` narrowly

## Download URL policy decisions

Default policy:

- allow only `http` and `https`
- block localhost and private/link-local hosts by default
  - examples: `localhost`, `127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, IPv6 loopback/local ranges

Override for trusted environments:

- set `AUDIO_META_ALLOW_PRIVATE_DOWNLOADS=true`

Rationale:

- reduces SSRF-style access to local/internal services from pasted URLs

## Release gate checks

Before release:

1. run `npm run lint`
2. run `npm run typecheck`
3. run `npm run tests`
4. run `npm run format`
5. manually validate that blocked private-host URLs are rejected
6. manually validate public direct MP3/WAV downloads still work

## Follow-up hardening candidates

- add explicit `webContents.setWindowOpenHandler(() => ({ action: 'deny' }))`
- evaluate strict host allowlist mode for downloads
- evaluate streaming download path with byte cap instead of full in-memory buffering
- add automated CSP verification check in CI
