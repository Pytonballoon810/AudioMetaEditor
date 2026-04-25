$ErrorActionPreference = 'Stop'

$appFolder = 'AudioMetaEditor'
$shortcutName = 'AudioMetaEditor Dev.lnk'
$currentDir = (Resolve-Path -Path $PSScriptRoot).Path
$parentDir = (Resolve-Path -Path (Join-Path $PSScriptRoot '..')).Path

if (Test-Path -LiteralPath (Join-Path $currentDir 'package.json')) {
    $projectDir = $currentDir
} elseif (Test-Path -LiteralPath (Join-Path $parentDir 'package.json')) {
    $projectDir = $parentDir
} else {
    throw 'Could not find package.json to determine project root.'
}

$iconPath = Join-Path $projectDir 'build/icons/win/icon.ico'
$startMenuDir = Join-Path $env:APPDATA "Microsoft/Windows/Start Menu/Programs/$appFolder"
$shortcutPath = Join-Path $startMenuDir $shortcutName

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm was not found in PATH. Install Node.js and try again.'
}

New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $env:ComSpec
$shortcut.Arguments = '/k npm run dev'
$shortcut.WorkingDirectory = $projectDir

if (Test-Path -LiteralPath $iconPath) {
    $shortcut.IconLocation = "$iconPath,0"
}

$shortcut.Description = 'Start AudioMetaEditor in development mode (npm run dev).'
$shortcut.Save()

Write-Host 'Installed Start Menu shortcut:'
Write-Host $shortcutPath
Write-Host ''
Write-Host 'Launch "AudioMetaEditor Dev" from the Start Menu to run npm run dev.'
