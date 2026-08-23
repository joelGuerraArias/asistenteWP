# Instala tarea Windows: feed FV → redes cada hora :15 de 09:15 a 21:15.
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "AsistenteWP-FeedRepost"
$RunScript = Join-Path $PSScriptRoot "run-feed-repost.ps1"

$startRaw = "09:15"
$endRaw = "21:15"
$envPath = Join-Path $Root ".env"
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*FEED_REPOST_START\s*=\s*(.+)\s*$') {
            $startRaw = $Matches[1].Trim()
        }
        if ($line -match '^\s*FEED_REPOST_END\s*=\s*(.+)\s*$') {
            $endRaw = $Matches[1].Trim()
        }
    }
}

function Parse-Hm([string]$raw) {
    $parts = $raw.Trim() -split ":"
    $h = [int]$parts[0]
    $m = if ($parts.Length -gt 1) { [int]$parts[1] } else { 0 }
    return @{ Hour = $h; Minute = $m }
}

$start = Parse-Hm $startRaw
$end = Parse-Hm $endRaw
if (($end.Hour * 60 + $end.Minute) -lt ($start.Hour * 60 + $start.Minute)) {
    throw "FEED_REPOST_END ($endRaw) debe ser >= FEED_REPOST_START ($startRaw)"
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunScript`"" `
    -WorkingDirectory $Root

# Un trigger diario por cada hora :mm entre start y end (mismo minuto).
$triggers = @()
for ($h = $start.Hour; $h -le $end.Hour; $h++) {
    $at = Get-Date -Hour $h -Minute $start.Minute -Second 0
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
    -Description "Feeds FV + Motorsport F1: hasta 2 nuevas c/u → webhooks fvdigital y formula1rd ($startRaw-$endRaw)" | Out-Null

Write-Host "Tarea programada instalada:"
Write-Host "  Nombre:   $TaskName"
Write-Host "  Horario:  cada hora desde $startRaw hasta $endRaw (hora local, $($triggers.Count) triggers)"
Write-Host "  Script:   $RunScript"
Write-Host "  Log:      $(Join-Path $Root 'logs\feed-repost.log')"
Write-Host ""
Write-Host "Probar ahora:  npm run feed:repost"
Write-Host "Dry-run:       npm run feed:repost:dry"
Write-Host "Quitar tarea:  npm run feed:repost:cron:uninstall"
