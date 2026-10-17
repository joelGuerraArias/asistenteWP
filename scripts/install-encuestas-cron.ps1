# Instala publicaciones de encuestas temáticas (ALPHA) a las horas de ENCUESTAS_CRON_TIME.
# Default: 09:00 y 16:00. Una encuesta por corrida; al agotar el MD reinicia la cola.
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$PublishScript = Join-Path $PSScriptRoot "run-encuestas.ps1"
$CheckScript = Join-Path $PSScriptRoot "run-encuestas-check.ps1"
$PsExe = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

$publishTimes = @("09:00", "16:00")
$checkTime = ""
$envPath = Join-Path $Root ".env"
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*ENCUESTAS_CRON_TIME\s*=\s*(.+)\s*$') {
            $raw = $Matches[1].Trim()
            $publishTimes = @($raw -split '[,;\s]+' | Where-Object { $_ -match '^\d{1,2}:\d{2}$' })
            if (-not $publishTimes.Count) { $publishTimes = @("09:00", "16:00") }
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

# Quitar tareas viejas de un solo horario
foreach ($old in @("AsistenteWP-Encuestas", "AsistenteWP-Encuestas-Check")) {
    $existing = Get-ScheduledTask -TaskName $old -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $old -Confirm:$false
    }
}

# Quitar slots previos AsistenteWP-Encuestas-0900 etc.
Get-ScheduledTask -ErrorAction SilentlyContinue |
    Where-Object { $_.TaskName -like "AsistenteWP-Encuestas-*" } |
    ForEach-Object { Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false }

$i = 0
foreach ($t in $publishTimes) {
    $i++
    $slot = ($t -replace ":", "")
    $name = "AsistenteWP-Encuestas-$slot"
    Register-DailyTask `
        $name `
        $PublishScript `
        (Parse-Hm $t) `
        "Encuestas tematicas FV (ALPHA + WP + redes) a las $t"
    Write-Host "  Publish:  $name @ $t"
}

if ($checkTime -and $checkTime -match '^\d{1,2}:\d{2}$') {
    Register-DailyTask `
        "AsistenteWP-Encuestas-Check" `
        $CheckScript `
        (Parse-Hm $checkTime) `
        "Encuestas FV: verifica foto de la proxima encuesta a las $checkTime"
    Write-Host "  Check:    AsistenteWP-Encuestas-Check @ $checkTime"
}

Write-Host ""
Write-Host "Tareas instaladas. Logs: $(Join-Path $Root 'logs\encuestas.log')"
Write-Host "Probar: npm run encuestas -- --daily --tema"
Write-Host "Quitar: npm run encuestas:cron:uninstall"
