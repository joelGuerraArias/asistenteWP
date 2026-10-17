# Verifica envíos programados (pauta + 5 min) y deja log.
$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "verify-sends.log"

$env:Path = "C:\Program Files\nodejs;C:\Windows\System32;C:\Windows;" + $env:Path
$Node = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $Node)) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    $Node = if ($cmd) { $cmd.Source } else { "node" }
}

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

Write-Log "Inicio verify-sends (node=$Node)"
Set-Location $Root
try {
    # Cron siempre notifica el resultado de las pautes de la ventana
    & $Node "scripts/verify-cron-sends.mjs" "--notify-ok" @args 2>&1 |
        ForEach-Object { Add-Content -Path $LogFile -Value ($_ | Out-String).TrimEnd() -Encoding utf8 }
    $exit = $LASTEXITCODE
} catch {
    Write-Log ("ERROR: " + $_.Exception.Message)
    $exit = 1
}
if ($null -eq $exit) { $exit = 0 }
Write-Log "Fin (exit=$exit)"
exit $exit
