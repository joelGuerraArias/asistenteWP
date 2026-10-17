# Instala tarea Windows: verificación de envíos 5 min después de cada pauta.
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "AsistenteWP-VerifySends"
$RunScript = Join-Path $PSScriptRoot "run-verify-sends.ps1"
$PsExe = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
$Node = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $Node)) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    $Node = if ($cmd) { $cmd.Source } else { "node" }
}

$env:Path = "C:\Program Files\nodejs;C:\Windows\System32;C:\Windows;" + $env:Path
Set-Location $Root

# Lee horarios (pauta+offset) del verificador vía Node (sin ejecutar el CLI)
$timesRaw = & $Node --input-type=module -e "import { allVerifyTimes } from './scripts/verify-cron-sends.mjs'; console.log(allVerifyTimes().join(','))"
if (-not $timesRaw) {
    throw "No se pudieron calcular horarios de verificación"
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
    throw "Lista de horarios vacía"
}

$action = New-ScheduledTaskAction `
    -Execute $PsExe `
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
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 1 `
    -RestartInterval (New-TimeSpan -Minutes 1)

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
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description "Verifica envíos AsistenteWP 5 min después de cada pauta; Telegram si falla" | Out-Null

Write-Host "Tarea instalada: $TaskName"
Write-Host "Horarios verify (+5): $timesRaw"
Write-Host "Triggers: $($triggers.Count)"
Write-Host "Log: $(Join-Path $Root 'logs\verify-sends.log')"
Write-Host ""
Write-Host "Probar ahora:  npm run verify:sends -- --all --notify-ok"
Write-Host "Quitar tarea:  npm run verify:sends:cron:uninstall"
