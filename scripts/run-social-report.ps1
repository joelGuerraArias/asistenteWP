# Wrapper cron: estado de Instagram + X → correo Intrant (09:00 y 17:00)
$ErrorActionPreference = "Continue"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root
$LogDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir "estado-redes.log"
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { $Node = "C:\Program Files\nodejs\node.exe" }
Add-Content -Path $LogFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Estado redes (Instagram + X)"
& $Node "scripts/run-social-report.mjs" *>> $LogFile 2>&1
Add-Content -Path $LogFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Fin exit=$LASTEXITCODE"
exit $LASTEXITCODE
