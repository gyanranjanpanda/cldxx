$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sourceDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tmpDir = Join-Path ([IO.Path]::GetTempPath()) ("cldx-sovereign-test-" + [guid]::NewGuid().ToString('N'))
$installDir = Join-Path $tmpDir 'deploy\sovereign'
$binDir = Join-Path $tmpDir 'bin'
$originalPath = $env:PATH
$originalLocation = Get-Location

try {
    New-Item -ItemType Directory -Path (Split-Path $installDir), $binDir -Force | Out-Null
    Copy-Item $sourceDir $installDir -Recurse -Force
    Copy-Item (Join-Path $sourceDir 'tests\docker_mock.py') (Join-Path $binDir 'docker_mock.py')
    [IO.File]::WriteAllText((Join-Path $binDir 'docker.cmd'), "@echo off`r`npython `"%~dp0docker_mock.py`" %*`r`n")
    $env:PATH = "$binDir;$originalPath"

    function global:Read-Host {
        param([string]$Prompt, [switch]$AsSecureString)
        ConvertTo-SecureString 'eight123' -AsPlainText -Force
    }

    $installer = Join-Path $installDir 'install.ps1'
    $firstOutput = (& $installer *>&1 | Out-String)
    $envFile = Join-Path $installDir '.env'
    $firstEnv = [IO.File]::ReadAllText($envFile)
    if ($firstEnv -notmatch '(?m)^SOVEREIGN_MODEL=qwen2\.5:1\.5b\r?$') { throw 'Compact chat model was not configured.' }
    if ($firstEnv -notmatch '(?m)^FRONTEND_URL=http://127\.0\.0\.1:8080\r?$') { throw 'Local origin was not configured.' }
    if ($firstOutput -notmatch 'Sovereign Mode is ready at http://127.0.0.1:8080') { throw 'Installer did not complete.' }
    if ($firstOutput -match 'eight123') { throw 'Password leaked to installer output.' }

    $secondOutput = (& $installer *>&1 | Out-String)
    if ([IO.File]::ReadAllText($envFile) -ne $firstEnv) { throw 'Repeat installation changed the local account.' }
    if ($secondOutput -notmatch 'Using the existing .env') { throw 'Repeat installation did not reuse configuration.' }
    Write-Host 'Windows installer fresh/resume smoke test passed'
}
finally {
    Remove-Item Function:Read-Host -ErrorAction SilentlyContinue
    $env:PATH = $originalPath
    Set-Location $originalLocation
    Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
