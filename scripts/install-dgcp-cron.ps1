# Instala tarea programada Windows: resumen DGCP a las 08:00 y 17:00 (hora local)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "AsistenteWP-DGCP-Digest"
$RunScript = Join-Path $PSScriptRoot "run-dgcp-digest.ps1"

# Horarios desde .env DGCP_DIGEST_CRON_TIMES (fallback 08:00,17:00)
$timesRaw = "08:00,17:00"
$envPath = Join-Path $Root ".env"
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*DGCP_DIGEST_CRON_TIMES\s*=\s*(.+)\s*$') {
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
    throw "No hay horarios válidos en DGCP_DIGEST_CRON_TIMES"
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
    -Description "Resumen diario de licitaciones DGCP a las $($timesRaw)" | Out-Null

Write-Host "Tarea programada instalada:"
Write-Host "  Nombre:  $TaskName"
Write-Host "  Horarios: $timesRaw (hora local)"
Write-Host "  Script:  $RunScript"
Write-Host "  Log:     $(Join-Path $Root 'logs\dgcp-digest.log')"
Write-Host ""
Write-Host "Probar ahora:  npm run dgcp:digest"
Write-Host "Quitar tarea:  npm run dgcp:cron:uninstall"
