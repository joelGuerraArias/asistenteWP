# Instala tarea programada Windows: MONITOREO TV a las 17:00 y 23:00 (hora local)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "AsistenteWP-MonitoreoTV"
$RunScript = Join-Path $PSScriptRoot "run-informe-emails.ps1"

# Horarios desde .env INFORME_CRON_TIMES (fallback 17:00,23:00)
$timesRaw = "17:00,23:00"
$envPath = Join-Path $Root ".env"
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*INFORME_CRON_TIMES\s*=\s*(.+)\s*$') {
            $timesRaw = $Matches[1].Trim()
        }
    }
}

$times = @()
foreach ($t in ($timesRaw -split ",")) {
    $t = $t.Trim()
    if (-not $t) { continue }
    $parts = $t -split ":"
    $h = [int]$parts[0]
    $m = if ($parts.Length -gt 1) { [int]$parts[1] } else { 0 }
    $times += (Get-Date -Hour $h -Minute $m -Second 0)
}

if ($times.Count -lt 1) {
    throw "No hay horarios válidos en INFORME_CRON_TIMES"
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunScript`"" `
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
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Description "MONITOREO TV+RADIO — correos Intrant y Edesur (Analisishoy / AnalisisHoyRadio) a las $($timesRaw)" | Out-Null

Write-Host "Tarea programada instalada:"
Write-Host "  Nombre:  $TaskName"
Write-Host "  Horarios: $timesRaw (hora local)"
Write-Host "  Script:  $RunScript"
Write-Host "  Log:     $(Join-Path $Root 'logs\informe-emails.log')"
Write-Host ""
Write-Host "Probar ahora:  npm run informe:send"
Write-Host "Quitar tarea:  npm run informe:cron:uninstall"
