@echo off
cd /d "%~dp0.."
echo Instalando envio automatico del estado de Instagram y X (09:00 y 17:00)...
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-social-report-cron.ps1
echo.
pause
