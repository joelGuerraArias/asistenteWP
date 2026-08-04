# Quita arranque automático (tarea + acceso directo Startup)
$ErrorActionPreference = "Stop"
$TaskName = "AsistenteWP-JARVIS"
$StartupLnk = Join-Path ([Environment]::GetFolderPath("Startup")) "AsistenteWP-JARVIS.lnk"

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarea '$TaskName' eliminada."
}

if (Test-Path $StartupLnk) {
    Remove-Item $StartupLnk -Force
    Write-Host "Acceso directo Startup eliminado."
}

if (-not $existing -and -not (Test-Path $StartupLnk)) {
    Write-Host "No había autoinicio instalado."
}
