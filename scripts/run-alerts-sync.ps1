$ErrorActionPreference = 'Continue'
Set-Location 'C:\Users\Joel Guerra\Desktop\software\AsistenteWP'
$LogFile = 'C:\Users\Joel Guerra\Desktop\software\AsistenteWP\logs\google-alerts.log'
$Node = 'C:\Program Files\nodejs\node.exe'
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

$edesurOn = $true
$envPath = Join-Path (Get-Location) '.env'
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*EDESUR_ENABLED\s*=\s*false\s*$') { $edesurOn = $false }
    }
}

if ($edesurOn) {
    Add-Content -Path $LogFile -Value "[$stamp] Sync Google Alerts Gmail → Sheets (Intrant + electrico, solo hoy)"
} else {
    Add-Content -Path $LogFile -Value "[$stamp] Sync Google Alerts Gmail → Sheet Intrant (Edesur OFF)"
}

& $Node 'scripts/sync-google-alerts.mjs' '--replace' *>> $LogFile 2>&1
$exit1 = $LASTEXITCODE

# Tras sync: revisar filas del día, abrir URL, borrar si noticia >24h + avisar bot
& $Node 'scripts/purge-stale-intrant.mjs' *>> $LogFile 2>&1
$exitPurge = $LASTEXITCODE

$exit2 = 0
if ($edesurOn) {
    & $Node 'scripts/sync-electric-alerts.mjs' '--replace' *>> $LogFile 2>&1
    $exit2 = $LASTEXITCODE
} else {
    Add-Content -Path $LogFile -Value "Electrico omitido (EDESUR_ENABLED=false)"
}

$exit = 0
if ($exit1 -ne 0) { $exit = $exit1 }
elseif ($exitPurge -ne 0) { $exit = $exitPurge }
elseif ($exit2 -ne 0) { $exit = $exit2 }
Add-Content -Path $LogFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Fin exit=$exit (intrant=$exit1 purge=$exitPurge electric=$exit2)"
exit $exit
