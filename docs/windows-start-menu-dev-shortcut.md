# Windows Start Menu Dev Shortcut

Use the install script to create a Start Menu entry that launches the app in development mode with npm run dev.

Scripts live in: `dev-install/`

## Main Menu Script

Use a simple text menu to run install/uninstall:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev-install\main.ps1
```

Menu options:

- `1` Install Start Menu shortcut
- `2` Uninstall Start Menu shortcut
- `3` Exit

## What It Creates

- Shortcut location: `%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\AudioMetaEditor\\AudioMetaEditor Dev.lnk`
- Command run by shortcut: `npm run dev`
- Working directory: project root (auto-detected from script location)
- Icon: `build/icons/win/icon.ico`

## Install

Run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev-install\install.ps1
```

You can also run it from an existing PowerShell session:

```powershell
.\dev-install\install.ps1
```

## Remove Shortcut

Run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\dev-install\uninstall.ps1
```

You can also run it from an existing PowerShell session:

```powershell
.\dev-install\uninstall.ps1
```

The script removes this shortcut:

`%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\AudioMetaEditor\\AudioMetaEditor Dev.lnk`

## Troubleshooting

### npm was not found in PATH

Install Node.js (which includes npm), then reopen your terminal/session and run the script again.

### Shortcut opens but icon is generic

Confirm this file exists:

`build/icons/win/icon.ico`

If it was added after first install, re-run `install.ps1` to refresh the shortcut icon.

If scripts are moved again, update command paths in this document and in `README.md`.
