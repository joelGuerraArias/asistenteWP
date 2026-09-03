# Instala tareas Windows: check 09:00 + publicar 10:00 (ENCUESTAS_* en .env).
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$PublishTask = "AsistenteWP-Encuestas"
$CheckTask = "AsistenteWP-Encuestas-Check"
$PublishScript = Join-Path $PSScriptRoot "run-encuestas.ps1"
$CheckScript = Join-Path $PSScriptRoot "run-encuestas-check.ps1"
$PsExe = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

$publishTime = "10:00"
$checkTime = "09:00"
$envPath = Join-Path $Root ".env"
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*ENCUESTAS_CRON_TIME\s*=\s*(.+)\s*$') {
            $publishTime = $Matches[1].Trim()
        }
        if ($line -match '^\s*ENCUESTAS_CHECK_TIME\s*=\s*(.+)\s*$') {
            $checkTime = $Matches[1].Trim()
        }
    }
}

function Parse-Hm([string]$raw) {
    $parts = $raw.Trim() -split ":"
    $h = [int]$parts[0]
    $m = if ($parts.Length -gt 1) { [int]$parts[1] } else { 0 }
    return Get-Date -Hour $h -Minute $m -Second 0
}

function Register-DailyTask([string]$name, [string]$script, [datetime]$at, [string]$desc) {
    $action = New-ScheduledTaskAction `
        -Execute $PsExe `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" `
        -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -Daily -At $at
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
        -RestartCount 2 `
        -RestartInterval (New-TimeSpan -Minutes 2)
    $principal = New-ScheduledTaskPrincipal `
        -UserId $env:USERNAME `
        -LogonType Interactive `
        -RunLevel Limited
    $existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
    }
    Register-ScheduledTask `
        -TaskName $name `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description $desc | Out-Null
}

Register-DailyTask `
    $CheckTask `
    $CheckScript `
    (Parse-Hm $checkTime) `
    "Encuestas FV: verifica foto de la proxima encuesta a las $checkTime"

Register-DailyTask `
    $PublishTask `
    $PublishScript `
    (Parse-Hm $publishTime) `
    "Encuestas FV: 1 pendiente a WP + webhook fvdigital a las $publishTime"

Write-Host "Tareas programadas instaladas:"
Write-Host "  Check:    $CheckTask @ $checkTime"
Write-Host "  Publish:  $PublishTask @ $publishTime"
Write-Host "  Logs:     $(Join-Path $Root 'logs\encuestas.log')"
Write-Host ""
Write-Host "Probar check:   npm run encuestas:check"
Write-Host "Probar 1 dia:   npm run encuestas -- --daily"
Write-Host "Quitar tareas:  npm run encuestas:cron:uninstall"
