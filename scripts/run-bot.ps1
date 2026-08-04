# Inicia el bot en segundo plano (una sola instancia)
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

& "$PSScriptRoot\stop-bot.ps1"
Start-Sleep -Seconds 2

$logDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$node = (Get-Command node -ErrorAction Stop).Source
$outLog = Join-Path $logDir "bot-out.log"
$errLog = Join-Path $logDir "bot-err.log"

Start-Process -FilePath $node `
    -ArgumentList "src/telegram-bot.mjs" `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog

Start-Sleep -Seconds 3

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:9000/health" -TimeoutSec 5
    Write-Host "Bot activo en puerto $($health.port) (uptime $($health.uptimeSec)s)."
} catch {
    Write-Host "Bot iniciado. Revisa logs en $logDir si no responde."
}
