# Si el health check falla, reinicia JARVIS. Pensado para tarea programada cada pocos minutos.
$ErrorActionPreference = "Continue"
$Root = Split-Path $PSScriptRoot -Parent
$Port = if ($env:BOT_PORT) { [int]$env:BOT_PORT } else { 9000 }
$HealthUrl = "http://127.0.0.1:$Port/health"
$LogDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$KeepLog = Join-Path $LogDir "keepalive.log"

function Write-Keep([string]$msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $KeepLog -Value $line -Encoding UTF8
}

$alive = $false
try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 4
    if ($health -and $health.port) { $alive = $true }
} catch {
    $alive = $false
}

if ($alive) {
    exit 0
}

Write-Keep "DOWN — reiniciando bot (puerto $Port sin respuesta)"
& "$PSScriptRoot\run-bot.ps1"
Start-Sleep -Seconds 4

try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
    Write-Keep "OK — bot arriba (uptime $($health.uptimeSec)s)"
} catch {
    Write-Keep "FAIL — sigue caído tras reinicio. Ver logs/bot-err.log"
    exit 1
}
