# Publica 1 encuesta temática pendiente (cron 09:00 / 16:00) → WP + ALPHA + redes.
$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "encuestas.log"

# PATH mínimo para Task Scheduler (evita 0xC000026B / node no encontrado).
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

Write-Log "Inicio encuestas publish (node=$Node)"
Set-Location $Root
try {
    & $Node "scripts/run-encuestas.mjs" "--daily" "--tema" 2>&1 |
        ForEach-Object { Add-Content -Path $LogFile -Value ($_ | Out-String).TrimEnd() -Encoding utf8 }
    $exit = $LASTEXITCODE
} catch {
    Write-Log ("ERROR: " + $_.Exception.Message)
    $exit = 1
}
if ($null -eq $exit) { $exit = 0 }
Write-Log "Fin publish (exit=$exit)"
exit $exit
