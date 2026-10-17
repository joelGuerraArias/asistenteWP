# Instala tarea Windows: Así va el día a las 12:00 y 16:00 (o ASI_VA_EL_DIA_CRON_TIMES).
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "AsistenteWP-AsiVaElDia"
$RunScript = Join-Path $PSScriptRoot "run-asi-va-el-dia.ps1"
$PsExe = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

$timesRaw = "12:00,16:00"
$envPath = Join-Path $Root ".env"
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*ASI_VA_EL_DIA_CRON_TIMES\s*=\s*(.+)\s*$') {
            $timesRaw = $Matches[1].Trim()
        }
    }
}

$times = @()
foreach ($t in ($timesRaw -split ",")) {
    $parts = $t.Trim() -split ":"
    if ($parts.Count -lt 1) { continue }
    $h = [int]$parts[0]
    $m = if ($parts.Length -gt 1) { [int]$parts[1] } else { 0 }
    $times += (Get-Date -Hour $h -Minute $m -Second 0)
}
if ($times.Count -lt 1) { throw "No hay horarios válidos en ASI_VA_EL_DIA_CRON_TIMES" }

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
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description "Así va el día Intrant: alertas sheet → correo a las $timesRaw" | Out-Null

Write-Host "Tarea programada instalada:"
Write-Host "  Nombre:   $TaskName"
Write-Host "  Horarios: $timesRaw (hora local)"
Write-Host "  Log:      $(Join-Path $Root 'logs\asi-va-el-dia.log')"
Write-Host ""
Write-Host "Muestra:   npm run asi:dia:sample"
Write-Host "Probar:    npm run asi:dia:dry"
Write-Host "Quitar:    npm run asi:dia:cron:uninstall"
