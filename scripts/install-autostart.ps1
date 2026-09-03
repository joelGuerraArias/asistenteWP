# Registra arranque automático + keepalive cada 3 min (sin admin)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "AsistenteWP-JARVIS"
$KeepaliveName = "AsistenteWP-JARVIS-Keepalive"
$RunScript = Join-Path $PSScriptRoot "run-bot.ps1"
$KeepScript = Join-Path $PSScriptRoot "keepalive-bot.ps1"
$StartupLnk = Join-Path ([Environment]::GetFolderPath("Startup")) "AsistenteWP-JARVIS.lnk"

function Register-JarvisTask {
    param(
        [string]$Name,
        [string]$ScriptPath,
        [string]$Description,
        $Trigger
    )

    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""

    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount 5 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
        -MultipleInstances IgnoreNew

    $existing = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    }

    Register-ScheduledTask `
        -TaskName $Name `
        -Action $action `
        -Trigger $Trigger `
        -Settings $settings `
        -Description $Description | Out-Null
}

# 1) Arranque al iniciar sesión
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-JarvisTask `
    -Name $TaskName `
    -ScriptPath $RunScript `
    -Description "Bot Telegram JARVIS — FV Digital (arranque al login, puerto 9000)" `
    -Trigger $logonTrigger

# 2) Keepalive cada 3 minutos (reinicia si el health check falla)
$keepTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 3) -RepetitionDuration (New-TimeSpan -Days 3650)
Register-JarvisTask `
    -Name $KeepaliveName `
    -ScriptPath $KeepScript `
    -Description "Keepalive JARVIS — reinicia el bot si http://127.0.0.1:9000/health falla" `
    -Trigger $keepTrigger

# 3) Acceso directo en Startup (respaldo)
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($StartupLnk)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunScript`""
$shortcut.WorkingDirectory = $Root
$shortcut.WindowStyle = 7
$shortcut.Description = "Bot JARVIS FV Digital"
$shortcut.Save()

# Arrancar ya
& $RunScript

Write-Host ""
Write-Host "Autoinicio + keepalive instalados:"
Write-Host "  - Tarea: $TaskName (al iniciar sesión)"
Write-Host "  - Tarea: $KeepaliveName (cada 3 min si está caído)"
Write-Host "  - Acceso directo: $StartupLnk"
Write-Host "  - Health: http://127.0.0.1:9000/health"
Write-Host ""
Write-Host "Detener:     npm run bot:stop"
Write-Host "Quitar:      npm run bot:uninstall"
