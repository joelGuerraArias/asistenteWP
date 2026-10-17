# Ejecuta Así va el día y deja log.
$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "asi-va-el-dia.log"
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
$Node = if ($NodeCmd) { $NodeCmd.Source } else { "node" }

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $LogFile -Value "[$stamp] Inicio Así va el día"

Set-Location $Root
& $Node "scripts/run-asi-va-el-dia.mjs" *>> $LogFile 2>&1
$exit = $LASTEXITCODE

$stampEnd = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $LogFile -Value "[$stampEnd] Fin (exit=$exit)"
exit $exit
