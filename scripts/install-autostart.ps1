# Registra arranque automático del bot (sin admin: inicio de sesión + carpeta Startup)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "AsistenteWP-JARVIS"
$RunScript = Join-Path $PSScriptRoot "run-bot.ps1"
$StartupLnk = Join-Path ([Environment]::GetFolderPath("Startup")) "AsistenteWP-JARVIS.lnk"

# 1) Tarea programada al iniciar sesión (no requiere admin)
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunScript`""

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 2) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Bot Telegram JARVIS — FV Digital (puerto 9000)" | Out-Null

# 2) Acceso directo en Startup (respaldo)
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($StartupLnk)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunScript`""
$shortcut.WorkingDirectory = $Root
$shortcut.WindowStyle = 7
$shortcut.Description = "Bot JARVIS FV Digital"
$shortcut.Save()

Write-Host "Autoinicio instalado:"
Write-Host "  - Tarea: $TaskName (al iniciar sesión)"
Write-Host "  - Acceso directo: $StartupLnk"
Write-Host "  - Puerto: http://127.0.0.1:9000/health"
Write-Host ""
Write-Host "Detener:     npm run bot:stop"
Write-Host "Quitar:      npm run bot:uninstall"
