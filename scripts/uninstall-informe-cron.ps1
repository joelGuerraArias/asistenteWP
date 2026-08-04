# Quita la tarea programada de MONITOREO TV
$ErrorActionPreference = "Stop"
$TaskName = "AsistenteWP-MonitoreoTV"

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarea eliminada: $TaskName"
} else {
    Write-Host "No existía la tarea: $TaskName"
}
