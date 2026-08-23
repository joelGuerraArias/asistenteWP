# Ejecuta feed FV → webhook + Telegram y deja log.
$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "feed-repost.log"
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
$Node = if ($NodeCmd) { $NodeCmd.Source } else { "node" }

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $LogFile -Value "[$stamp] Inicio feed-repost"

Set-Location $Root
& $Node "scripts/run-feed-repost.mjs" *>> $LogFile 2>&1
$exit = $LASTEXITCODE

$stampEnd = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $LogFile -Value "[$stampEnd] Fin (exit=$exit)"
exit $exit
