# Instala tarea programada: Google Alerts Gmail → Sheets
# Respeta EDESUR_ENABLED=false (solo Intrant)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "AsistenteWP-GoogleAlerts"
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "google-alerts.log"
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
$Node = if ($NodeCmd) { $NodeCmd.Source } else { "C:\Program Files\nodejs\node.exe" }

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$timesRaw = "07:00,16:30"
$envPath = Join-Path $Root ".env"
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*GOOGLE_ALERTS_CRON_TIMES\s*=\s*(.+)\s*$') {
            $timesRaw = $Matches[1].Trim()
        }
    }
}

$times = @()
foreach ($t in ($timesRaw -split ",")) {
    $t = $t.Trim()
    if (-not $t -or $t.StartsWith("*")) { continue }
    $parts = $t -split ":"
    $h = [int]$parts[0]
    $m = if ($parts.Length -gt 1) { [int]$parts[1] } else { 0 }
    $times += (Get-Date -Hour $h -Minute $m -Second 0)
}

if ($times.Count -lt 1) {
    $times = @((Get-Date -Hour 8 -Minute 30 -Second 0), (Get-Date -Hour 16 -Minute 30 -Second 0))
    $timesRaw = "07:00,16:30"
}

$wrapper = Join-Path $PSScriptRoot "run-alerts-sync.ps1"
@"
`$ErrorActionPreference = 'Continue'
Set-Location '$Root'
`$LogFile = '$LogFile'
`$Node = '$Node'
`$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

`$edesurOn = `$true
`$envPath = Join-Path (Get-Location) '.env'
if (Test-Path `$envPath) {
    foreach (`$line in Get-Content `$envPath) {
        if (`$line -match '^\s*EDESUR_ENABLED\s*=\s*false\s*`$') { `$edesurOn = `$false }
    }
}

if (`$edesurOn) {
    Add-Content -Path `$LogFile -Value "[`$stamp] Sync Google Alerts Gmail → Sheets (Intrant + electrico, solo hoy)"
} else {
    Add-Content -Path `$LogFile -Value "[`$stamp] Sync Google Alerts Gmail → Sheet Intrant (Edesur OFF)"
}

& `$Node 'scripts/sync-google-alerts.mjs' '--replace' *>> `$LogFile 2>&1
`$exit1 = `$LASTEXITCODE

& `$Node 'scripts/purge-stale-intrant.mjs' *>> `$LogFile 2>&1
`$exitPurge = `$LASTEXITCODE

`$exit2 = 0
if (`$edesurOn) {
    & `$Node 'scripts/sync-electric-alerts.mjs' '--replace' *>> `$LogFile 2>&1
    `$exit2 = `$LASTEXITCODE
} else {
    Add-Content -Path `$LogFile -Value "Electrico omitido (EDESUR_ENABLED=false)"
}

`$exit = 0
if (`$exit1 -ne 0) { `$exit = `$exit1 }
elseif (`$exitPurge -ne 0) { `$exit = `$exitPurge }
elseif (`$exit2 -ne 0) { `$exit = `$exit2 }
Add-Content -Path `$LogFile -Value "[`$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Fin exit=`$exit (intrant=`$exit1 purge=`$exitPurge electric=`$exit2)"
exit `$exit
"@ | Set-Content -Path $wrapper -Encoding UTF8

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$wrapper`"" `
    -WorkingDirectory $Root

$triggers = @()
foreach ($at in $times) {
    $triggers += (New-ScheduledTaskTrigger -Daily -At $at)
}

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Description "Google Alerts → Sheets + purge Intrant >24h (verifica URL) a las $timesRaw" | Out-Null

Write-Host "Tarea instalada: $TaskName"
Write-Host "Horarios: $timesRaw (hora local)"
Write-Host "Log: $LogFile"
