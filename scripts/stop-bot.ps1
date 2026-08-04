# Detiene el bot JARVIS (puerto 9000 + procesos telegram-bot)
$ErrorActionPreference = "SilentlyContinue"
$Root = Split-Path $PSScriptRoot -Parent
$Port = if ($env:BOT_PORT) { [int]$env:BOT_PORT } else { 9000 }
$PidFile = Join-Path $Root ".bot.pid"

function Stop-ProcessSafe([int]$ProcessId) {
    if ($ProcessId -gt 0) {
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
}

# Por archivo PID
if (Test-Path $PidFile) {
    $botPid = (Get-Content $PidFile -Raw).Trim()
    if ($botPid -match '^\d+$') {
        Stop-ProcessSafe ([int]$botPid)
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

# Por puerto
$connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($conn in $connections) {
    Stop-ProcessSafe $conn.OwningProcess
}

# Por nombre de script (evita conflicto 409)
Get-CimInstance Win32_Process -Filter "name='node.exe'" |
    Where-Object { $_.CommandLine -like '*telegram-bot*' } |
    ForEach-Object { Stop-ProcessSafe $_.ProcessId }

Write-Host "Bot detenido (puerto $Port)."
