[CmdletBinding()]
param(
    [ValidateSet('Install', 'Uninstall', 'Exit')]
    [string]$Choice
)

$ErrorActionPreference = 'Stop'

$scriptDir = (Resolve-Path -Path $PSScriptRoot).Path
$installScriptPath = Join-Path $scriptDir 'install.ps1'
$uninstallScriptPath = Join-Path $scriptDir 'uninstall.ps1'

function Invoke-ShortcutScript {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptPath,

        [Parameter(Mandatory = $true)]
        [string]$ActionName
    )

    if (-not (Test-Path -LiteralPath $ScriptPath)) {
        Write-Host "Could not find script: $ScriptPath" -ForegroundColor Red
        return
    }

    try {
        & $ScriptPath
    } catch {
        Write-Host "Failed to run $ActionName." -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
    }
}

function Invoke-Choice {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('Install', 'Uninstall', 'Exit')]
        [string]$SelectedChoice
    )

    switch ($SelectedChoice) {
        'Install' {
            Invoke-ShortcutScript -ScriptPath $installScriptPath -ActionName 'install'
            return $true
        }
        'Uninstall' {
            Invoke-ShortcutScript -ScriptPath $uninstallScriptPath -ActionName 'uninstall'
            return $true
        }
        'Exit' {
            return $false
        }
    }

    return $true
}

if ($PSBoundParameters.ContainsKey('Choice')) {
    [void](Invoke-Choice -SelectedChoice $Choice)
    return
}

while ($true) {
    Clear-Host
    Write-Host 'AudioMetaEditor Dev Shortcut Manager'
    Write-Host '-----------------------------------'
    Write-Host '1) Install Start Menu shortcut'
    Write-Host '2) Uninstall Start Menu shortcut'
    Write-Host '3) Exit'
    Write-Host ''

    $selection = (Read-Host 'Select an option (1-3)').Trim()

    switch ($selection) {
        '1' {
            [void](Invoke-Choice -SelectedChoice 'Install')
            Write-Host ''
            [void](Read-Host 'Press Enter to return to the menu')
        }
        '2' {
            [void](Invoke-Choice -SelectedChoice 'Uninstall')
            Write-Host ''
            [void](Read-Host 'Press Enter to return to the menu')
        }
        '3' {
            return
        }
        default {
            Write-Host ''
            Write-Host 'Invalid selection. Use 1, 2, or 3.' -ForegroundColor Yellow
            [void](Read-Host 'Press Enter to try again')
        }
    }
}
