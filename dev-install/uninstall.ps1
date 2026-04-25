[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'

$appFolder = 'AudioMetaEditor'
$shortcutName = 'AudioMetaEditor Dev.lnk'
$startMenuDir = Join-Path $env:APPDATA "Microsoft/Windows/Start Menu/Programs/$appFolder"
$shortcutPath = Join-Path $startMenuDir $shortcutName

if (Test-Path -LiteralPath $shortcutPath) {
    if ($PSCmdlet.ShouldProcess($shortcutPath, 'Remove Start Menu shortcut')) {
        Remove-Item -LiteralPath $shortcutPath -Force
        Write-Host 'Removed Start Menu shortcut:'
        Write-Host $shortcutPath
    }
} else {
    Write-Host 'Shortcut not found (nothing to remove):'
    Write-Host $shortcutPath
}

if (Test-Path -LiteralPath $startMenuDir) {
    $remainingItems = @(Get-ChildItem -LiteralPath $startMenuDir -Force -ErrorAction SilentlyContinue)
    if ($remainingItems.Count -eq 0) {
        if ($PSCmdlet.ShouldProcess($startMenuDir, 'Remove empty Start Menu folder')) {
            Remove-Item -LiteralPath $startMenuDir -Force
            Write-Host 'Removed empty Start Menu folder:'
            Write-Host $startMenuDir
        }
    }
}

Write-Host 'Done.'
