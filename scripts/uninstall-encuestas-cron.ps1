# Quita las tareas programadas de encuestas (slots 0900/1600 y legacy).
$ErrorActionPreference = "Stop"

$legacy = @("AsistenteWP-Encuestas", "AsistenteWP-Encuestas-Check")
foreach ($TaskName in $legacy) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Host "No existe la tarea $TaskName"
        continue
    }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarea $TaskName eliminada."
}

Get-ScheduledTask -ErrorAction SilentlyContinue |
    Where-Object { $_.TaskName -like "AsistenteWP-Encuestas-*" } |
    ForEach-Object {
        Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false
        Write-Host "Tarea $($_.TaskName) eliminada."
    }
