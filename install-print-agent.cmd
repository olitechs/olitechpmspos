@echo off
setlocal
cd /d "%~dp0"
echo.
echo ==========================================
echo   OliTechs Print Agent - Windows Installer
echo ==========================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on this computer.
  echo Install Node.js 20 or newer, then run this installer again.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\print-agent\install-windows.ps1"
if errorlevel 1 (
  echo.
  echo Installation failed.
  pause
  exit /b 1
)
echo.
echo Installation complete. The print agent will start automatically at Windows logon.
pause
