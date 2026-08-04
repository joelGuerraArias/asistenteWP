# Tarea cada 3 horas:
# - Intrant: completa medio vacío desde URL
# - Edesur: medio desde URL, título desde texto, fecha dd/mm/yyyy
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "AsistenteWP-IntrantMedio"
$RunScript = Join-Path $PSScriptRoot "run-fill-intrant-medio.ps1"
$LogDir = Join-Path $Root "logs"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunScript`"" `
    -WorkingDirectory $Root

# Empieza en la próxima hora en punto y se repite cada 3 horas
$start = (Get-Date).Date.AddHours((Get-Date).Hour + 1)
$trigger = New-ScheduledTaskTrigger -Once -At $start `
    -RepetitionInterval (New-TimeSpan -Hours 3) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

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
    -Description "Cada 3h: Intrant medio←URL; Edesur medio←URL, titulo←texto, fecha dd/mm/yyyy" | Out-Null

Write-Host "Tarea instalada: $TaskName"
Write-Host "Frecuencia: cada 3 horas (inicio $start)"
Write-Host "Probar Intrant:  node scripts/fill-intrant-medio.mjs"
Write-Host "Probar Edesur:   node scripts/maintain-electric-sheet.mjs"
Write-Host "Log: $(Join-Path $LogDir 'sheet-maintain.log')"
