# Quita la tarea programada de feed-repost.
$ErrorActionPreference = "Stop"
$TaskName = "AsistenteWP-FeedRepost"

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "No existe la tarea $TaskName"
    exit 0
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Tarea $TaskName eliminada."
