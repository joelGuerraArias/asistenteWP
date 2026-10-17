# Instala tarea Windows: estado de Instagram + X al Intrant (default 09:00 y 17:00)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "AsistenteWP-EstadoRedes"
$RunScript = Join-Path $PSScriptRoot "run-social-report.ps1"

$timesRaw = "09:00,17:00"
$envPath = Join-Path $Root ".env"
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*SOCIAL_REPORT_CRON_TIMES\s*=\s*(.+)\s*$') { $timesRaw = $Matches[1].Trim() }
    }
}
$triggers = @()
foreach ($t in ($timesRaw -split ",")) {
    $t = $t.Trim(); if (-not $t) { continue }
    $p = $t -split ":"; $h = [int]$p[0]; $m = if ($p.Length -gt 1) { [int]$p[1] } else { 0 }
    $triggers += (New-ScheduledTaskTrigger -Daily -At (Get-Date -Hour $h -Minute $m -Second 0))
}
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunScript`"" -WorkingDirectory $Root
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings `
    -Description "Estado de Instagram y X (INTRANT) a las $timesRaw" | Out-Null
Write-Host "Tarea programada instalada: $TaskName ($timesRaw)"
Write-Host "Log: $(Join-Path $Root 'logs\estado-redes.log')"
