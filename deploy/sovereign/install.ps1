$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envFile = Join-Path $PSScriptRoot '.env'

function Invoke-Docker {
    & docker @args
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed (exit $LASTEXITCODE)." }
}

function Get-EnvValue([string]$key) {
    $line = Get-Content $envFile | Where-Object { $_.StartsWith("$key=") } | Select-Object -Last 1
    if (-not $line) { return '' }
    return $line.Substring($key.Length + 1).Trim('"')
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Install and start Docker Desktop before running this installer.'
}
Write-Host 'Checking Docker engine...'
$dockerCheck = Start-Job -ScriptBlock {
    & docker info --format '{{.ServerVersion}}' *> $null
    $LASTEXITCODE
}
try {
    if (-not (Wait-Job $dockerCheck -Timeout 20)) {
        Stop-Job $dockerCheck
        throw 'Docker is not ready. Open Docker Desktop, wait for the engine to start, then rerun .\install.ps1.'
    }
    $dockerExit = Receive-Job $dockerCheck
    if ($dockerExit -ne 0) {
        throw 'Docker is not ready. Open Docker Desktop, wait for the engine to start, then rerun .\install.ps1.'
    }
}
finally { Remove-Job $dockerCheck -Force }
Invoke-Docker compose version | Out-Null

if (-not (Test-Path $envFile)) {
    $securePassword = Read-Host 'Create a password for this computer (at least 16 characters)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($password.Length -lt 16) { throw 'Password must contain at least 16 characters.' }

    $env:LOCAL_AUTH_NEW_PASSWORD = $password
    $password = $null
    try {
        $backendPath = Join-Path $repoRoot 'backend\app'
        $passwordHash = (Invoke-Docker run --rm --network none --env LOCAL_AUTH_NEW_PASSWORD `
            --mount "type=bind,source=$backendPath,target=/app,readonly" `
            --workdir /app node:22-slim node scripts/hash-local-password.mjs | Select-Object -Last 1).Trim()
    }
    finally { Remove-Item Env:LOCAL_AUTH_NEW_PASSWORD -ErrorAction SilentlyContinue }
    if ($passwordHash -notmatch '^[a-f0-9]{32}:[a-f0-9]{128}$') {
        throw 'Could not create the password hash.'
    }

    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) }
    finally { $rng.Dispose() }
    $internalKey = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    $template = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '.env.example'))
    $template = $template.Replace('INTERNAL_API_KEY=change-me-to-a-long-random-string', "INTERNAL_API_KEY=$internalKey")
    $template = $template.Replace('LOCAL_AUTH_PASSWORD_HASH=replace-with-scrypt-hash', "LOCAL_AUTH_PASSWORD_HASH=$passwordHash")
    $template = $template.Replace('SOVEREIGN_MODEL=llama3.1', 'SOVEREIGN_MODEL=qwen2.5:1.5b')
    $template = $template.Replace('SOVEREIGN_CODING_MODEL=qwen2.5-coder', 'SOVEREIGN_CODING_MODEL=qwen2.5-coder:1.5b')
    $template = $template.Replace('SOVEREIGN_VISION_MODEL=llama3.2-vision', 'SOVEREIGN_VISION_MODEL=moondream:1.8b')
    [IO.File]::WriteAllText($envFile, $template, [Text.UTF8Encoding]::new($false))
    $internalKey = $null
    $passwordHash = $null
    Write-Host 'Created a private local account (username: admin).'
} else {
    Write-Host 'Using the existing .env. Your account and data will be preserved.'
}

$models = @(
    (Get-EnvValue 'SOVEREIGN_MODEL'),
    (Get-EnvValue 'SOVEREIGN_CODING_MODEL'),
    (Get-EnvValue 'SOVEREIGN_VISION_MODEL'),
    (Get-EnvValue 'SOVEREIGN_EMBEDDING_MODEL')
)
if ($models | Where-Object { -not $_ }) { throw 'Model names are missing from .env.' }
$ollamaImage = Get-EnvValue 'OLLAMA_IMAGE'
if (-not $ollamaImage) { $ollamaImage = 'ollama/ollama:latest' }
$webPort = Get-EnvValue 'WEB_PORT'
if (-not $webPort) { $webPort = '8080' }

Invoke-Docker compose --env-file $envFile config --quiet | Out-Null
Invoke-Docker compose --env-file $envFile build
Invoke-Docker compose --env-file $envFile pull mongo redis qdrant ollama
Invoke-Docker volume create cldx-sovereign_ollama-models | Out-Null

# The app has no internet route. Only this short-lived model loader can pull.
$loader = "cldx-sovereign-model-loader-$PID"
try {
    Invoke-Docker run -d --name $loader --network bridge `
        --mount 'type=volume,source=cldx-sovereign_ollama-models,target=/root/.ollama' `
        $ollamaImage serve | Out-Null
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        & docker exec $loader ollama list *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Ollama did not start in the model loader.' }
    foreach ($model in $models) {
        Write-Host "Downloading $model to this computer..."
        Invoke-Docker exec $loader ollama pull $model
    }
}
finally { & docker rm -f $loader *> $null }

Invoke-Docker compose --env-file $envFile up -d
$servicesReady = $false
for ($i = 0; $i -lt 45; $i++) {
    & docker compose --env-file $envFile exec -T app node -e `
        'fetch("http://127.0.0.1:8000/").then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))' *> $null
    $appReady = $LASTEXITCODE -eq 0
    & docker compose --env-file $envFile exec -T agent node -e `
        'fetch("http://127.0.0.1:8003/").then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))' *> $null
    if ($appReady -and $LASTEXITCODE -eq 0) { $servicesReady = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $servicesReady) { throw 'CLDX services did not become healthy. Check docker compose logs.' }
$internal = (Invoke-Docker network inspect -f '{{.Internal}}' cldx-sovereign_internal | Select-Object -Last 1).Trim()
if ($internal -ne 'true') { throw 'Containment check failed: network is not internal.' }
foreach ($service in @('app', 'agent', 'mongo', 'redis', 'qdrant', 'ollama', 'web')) {
    $container = Invoke-Docker compose --env-file $envFile ps --status running -q $service
    if (-not $container) { throw "Containment check failed: $service is not running." }
}
foreach ($service in @('app', 'agent')) {
    & docker compose --env-file $envFile exec -T $service node -e `
        'fetch("http://1.1.1.1/", { signal: AbortSignal.timeout(6000) }).then(() => process.exit(0), () => process.exit(1))' *> $null
    if ($LASTEXITCODE -eq 0) { throw "Containment check failed: $service reached the internet." }
}
Write-Host "Sovereign Mode is ready at http://127.0.0.1:$webPort"
Write-Host 'Sign in as admin with the password you created on this computer.'
# The final containment probe intentionally returns 1 when egress is blocked.
# Clear that native exit code so a successful installer reports success.
$global:LASTEXITCODE = 0
