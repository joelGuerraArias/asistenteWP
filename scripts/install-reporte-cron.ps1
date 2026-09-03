# Instala tarea Windows: REPORTE Intrant (default 07:30 y 17:00)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "AsistenteWP-REPORTE"
$RunScript = Join-Path $PSScriptRoot "run-intrant-report.ps1"

$timesRaw = "07:30,17:00"
$envPath = Join-Path $Root ".env"
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*(INTRANT_REPORT_CRON_TIMES|REPORTE_CRON_TIMES)\s*=\s*(.+)\s*$') {
            $timesRaw = $Matches[2].Trim()
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
    $times = @(
        (Get-Date -Hour 7 -Minute 30 -Second 0),
        (Get-Date -Hour 17 -Minute 0 -Second 0)
    )
    $timesRaw = "07:30,17:00"
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
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Description "REPORTE Intrant PDF+correo a las $timesRaw" | Out-Null

Write-Host "Tarea instalada: $TaskName"
Write-Host "Horarios: $timesRaw (hora local)"
