# Quita tarea REPORTE Intrant
$ErrorActionPreference = "Continue"
$TaskName = "AsistenteWP-REPORTE"
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarea '$TaskName' eliminada."
} else {
    Write-Host "No había tarea $TaskName."
}
