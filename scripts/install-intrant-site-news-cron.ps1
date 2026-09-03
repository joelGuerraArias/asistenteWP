# Instala tarea Windows: noticias oficiales INTRANT (default 08:00 y 18:00)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "AsistenteWP-IntrantSiteNews"
$RunScript = Join-Path $PSScriptRoot "run-intrant-site-news.ps1"

$timesRaw = "08:00,18:00"
$envPath = Join-Path $Root ".env"
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*INTRANT_SITE_NEWS_CRON_TIMES\s*=\s*(.+)\s*$') {
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
    $times = @(
        (Get-Date -Hour 8 -Minute 0 -Second 0),
        (Get-Date -Hour 18 -Minute 0 -Second 0)
    )
    $timesRaw = "08:00,18:00"
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
    -Description "Noticias nuevas intrant.gob.do/noticias a las $($timesRaw)" | Out-Null

Write-Host "Tarea programada instalada:"
Write-Host "  Nombre:   $TaskName"
Write-Host "  Horarios: $timesRaw (hora local)"
Write-Host "  Script:   $RunScript"
Write-Host "  Log:      $(Join-Path $Root 'logs\intrant-site-news.log')"
Write-Host ""
Write-Host "Probar ahora:  npm run intrant:noticias"
Write-Host "Quitar tarea:  npm run intrant:noticias:cron:uninstall"
