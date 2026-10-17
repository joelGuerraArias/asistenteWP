# Quita tarea de verificación de envíos
$ErrorActionPreference = "Continue"
$TaskName = "AsistenteWP-VerifySends"
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarea '$TaskName' eliminada."
} else {
    Write-Host "No había tarea $TaskName."
}
