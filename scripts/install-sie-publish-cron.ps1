# Instala tarea Windows: SIE publish diario a las 06:00 (o SIE_PUBLISH_CRON_TIME).
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "AsistenteWP-SIE-Publish"
$RunScript = Join-Path $PSScriptRoot "run-sie-publish.ps1"
$PsExe = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

$timeRaw = "06:00"
$envPath = Join-Path $Root ".env"
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*SIE_PUBLISH_CRON_TIME\s*=\s*(.+)\s*$') {
            $timeRaw = $Matches[1].Trim()
        }
    }
}

$t = $timeRaw.Trim()
$parts = $t -split ":"
$h = [int]$parts[0]
$m = if ($parts.Length -gt 1) { [int]$parts[1] } else { 0 }
$at = Get-Date -Hour $h -Minute $m -Second 0

$action = New-ScheduledTaskAction `
    -Execute $PsExe `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunScript`"" `
    -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -Daily -At $at

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 45) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 2)

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "SIE: 1 video/día (STT + caption, sin lower-third) → R2 + webhook FV a las $timeRaw" | Out-Null

Write-Host "Tarea programada instalada:"
Write-Host "  Nombre:   $TaskName"
Write-Host "  Horario:  $timeRaw (hora local)"
Write-Host "  Script:   $RunScript"
Write-Host "  Log:      $(Join-Path $Root 'logs\sie-publish.log')"
Write-Host ""
Write-Host "Probar (sin enviar):  npm run sie:publish:dry"
Write-Host "Correr ahora:         npm run sie:publish"
Write-Host "Quitar tarea:         npm run sie:publish:cron:uninstall"
