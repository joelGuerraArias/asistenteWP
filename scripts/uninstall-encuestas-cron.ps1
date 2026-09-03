# Quita las tareas programadas de encuestas.
$ErrorActionPreference = "Stop"
$names = @("AsistenteWP-Encuestas", "AsistenteWP-Encuestas-Check")

foreach ($TaskName in $names) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Host "No existe la tarea $TaskName"
        continue
    }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarea $TaskName eliminada."
}
