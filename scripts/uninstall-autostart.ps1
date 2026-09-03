# Quita arranque automático (tareas + acceso directo Startup)
$ErrorActionPreference = "Continue"
$TaskNames = @("AsistenteWP-JARVIS", "AsistenteWP-JARVIS-Keepalive")
$StartupLnk = Join-Path ([Environment]::GetFolderPath("Startup")) "AsistenteWP-JARVIS.lnk"
$removed = $false

foreach ($TaskName in $TaskNames) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Tarea '$TaskName' eliminada."
        $removed = $true
    }
}

if (Test-Path $StartupLnk) {
    Remove-Item $StartupLnk -Force
    Write-Host "Acceso directo Startup eliminado."
    $removed = $true
}

if (-not $removed) {
    Write-Host "No había autoinicio instalado."
}
