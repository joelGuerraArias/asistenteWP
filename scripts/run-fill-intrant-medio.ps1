$ErrorActionPreference = 'Continue'
Set-Location 'C:\Users\Joel Guerra\Desktop\software\AsistenteWP'
$LogDir = Join-Path (Get-Location) 'logs'
$LogFile = Join-Path $LogDir 'sheet-maintain.log'
$Node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

$edesurOn = $true
$envPath = Join-Path (Get-Location) '.env'
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*EDESUR_ENABLED\s*=\s*false\s*$') { $edesurOn = $false }
    }
}

$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
if ($edesurOn) {
    Add-Content -Path $LogFile -Value "[$stamp] Mantener Sheets Intrant (medio) + Edesur (medio/titulo/fecha)"
} else {
    Add-Content -Path $LogFile -Value "[$stamp] Mantener Sheet Intrant (medio) — Edesur OFF"
}

& $Node 'scripts/fill-intrant-medio.mjs' *>> $LogFile 2>&1
$exit1 = $LASTEXITCODE

$exit2 = 0
if ($edesurOn) {
    & $Node 'scripts/maintain-electric-sheet.mjs' *>> $LogFile 2>&1
    $exit2 = $LASTEXITCODE
} else {
    Add-Content -Path $LogFile -Value "Edesur maintain omitido (EDESUR_ENABLED=false)"
}

$exit = if ($exit1 -ne 0) { $exit1 } elseif ($exit2 -ne 0) { $exit2 } else { 0 }
Add-Content -Path $LogFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Fin exit=$exit (intrant=$exit1 electric=$exit2)"
exit $exit
