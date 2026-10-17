# Si el health check falla o Telegram está degradado, reinicia JARVIS.
# Tarea programada cada 2 minutos (install-autostart.ps1).
$ErrorActionPreference = "Continue"
$Root = Split-Path $PSScriptRoot -Parent
$Port = if ($env:BOT_PORT) { [int]$env:BOT_PORT } else { 9000 }
$HealthUrl = "http://127.0.0.1:$Port/health"
$LogDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$KeepLog = Join-Path $LogDir "keepalive.log"
# Reinicio preventivo si el proceso lleva demasiado tiempo (polling puede colgarse)
$MaxUptimeSec = if ($env:BOT_MAX_UPTIME_SEC) { [int]$env:BOT_MAX_UPTIME_SEC } else { 21600 } # 6h

function Write-Keep([string]$msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $KeepLog -Value $line -Encoding UTF8
}

$needRestart = $false
$reason = ""

try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
    if (-not $health -or -not $health.port) {
        $needRestart = $true
        $reason = "health sin puerto"
    }
    elseif ($health.ok -eq $false -or $health.telegramOk -eq $false) {
        $needRestart = $true
        $reason = "telegram degradado (age=$($health.lastTelegramOkAgeSec)s fails=$($health.telegramFailStreak))"
    }
    elseif ($health.lastTelegramOkAgeSec -ne $null -and [int]$health.lastTelegramOkAgeSec -gt 180) {
        $needRestart = $true
        $reason = "telegram sin ping >180s (age=$($health.lastTelegramOkAgeSec)s)"
    }
    elseif ($health.uptimeSec -ne $null -and [int]$health.uptimeSec -ge $MaxUptimeSec) {
        $needRestart = $true
        $reason = "uptime $($health.uptimeSec)s >= $MaxUptimeSec (reinicio preventivo)"
    }
}
catch {
    $needRestart = $true
    $reason = "health unreachable: $($_.Exception.Message)"
}

if (-not $needRestart) {
    exit 0
}

Write-Keep "DOWN — reiniciando ($reason)"
& "$PSScriptRoot\run-bot.ps1"
Start-Sleep -Seconds 5

try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 6
    if ($health.ok -eq $false) {
        Write-Keep "WARN — bot arriba pero telegram aún degradado (age=$($health.lastTelegramOkAgeSec)s)"
        exit 1
    }
    Write-Keep "OK — bot arriba (uptime $($health.uptimeSec)s telegram=$($health.telegram))"
}
catch {
    Write-Keep "FAIL — sigue caído tras reinicio. Ver logs/bot-err.log"
    exit 1
}
