# Instala tarea Windows: frase celebre diaria a las 08:00 (o FRASE_CRON_TIME).
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "AsistenteWP-FraseCelebre"
$RunScript = Join-Path $PSScriptRoot "run-frase-celebre.ps1"

$timeRaw = "08:00"
$envPath = Join-Path $Root ".env"
if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*FRASE_CRON_TIME\s*=\s*(.+)\s*$') {
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
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunScript`"" `
    -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -Daily -At $at

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
    -Trigger $trigger `
    -Settings $settings `
    -Description "Frase celebre HyperFrames: render 30s + R2 + webhook a las $timeRaw" | Out-Null

Write-Host "Tarea programada instalada:"
Write-Host "  Nombre:   $TaskName"
Write-Host "  Horario:  $timeRaw (hora local)"
Write-Host "  Script:   $RunScript"
Write-Host "  Log:      $(Join-Path $Root 'logs\frase-celebre.log')"
Write-Host ""
Write-Host "Probar (sin webhook):  npm run frase:test"
Write-Host "Correr hoy + publicar: npm run frase:render"
Write-Host "Quitar tarea:          npm run frase:cron:uninstall"
