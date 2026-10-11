@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR_FERRAMENTAS.ps1"
if errorlevel 1 echo A instalacao falhou. Veja os erros acima.
pause
