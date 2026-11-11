@echo off
setlocal
cd /d "%~dp0"
echo.
echo ==========================================
echo   OliTechs Print Agent v2 - Windows Installer
echo ==========================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on this computer.
  echo Install Node.js 20 or newer, then run this installer again.
  pause
  exit /b 1
)
if not exist "%~dp0tools\print-agent\install-windows.ps1" (
  echo.
  echo The OliTechs installation script was not found:
  echo   %~dp0tools\print-agent\install-windows.ps1
  echo Copy the complete OliTechs PMS folder to this computer and run this installer again.
  pause
  exit /b 1
)
if "%WORKSPACE_ID%"=="" set /p WORKSPACE_ID=Workspace ID: 
if "%PRINT_AGENT_ID%"=="" set /p PRINT_AGENT_ID=Agent ID (UUID): 
setx WORKSPACE_ID "%WORKSPACE_ID%" >nul
setx PRINT_AGENT_ID "%PRINT_AGENT_ID%" >nul
rem Printing never needs a Supabase service-role key on a POS computer, and
rem storing one here would give the workstation full database access. The
rem agent is paired with Olitech through a scoped credential instead.
if defined SUPABASE_SERVICE_ROLE_KEY (
  echo.
  echo Note: an old SUPABASE_SERVICE_ROLE_KEY variable is still set on this
  echo computer. The Print Agent no longer uses it and it should be removed.
)
rem %~dp0 already ends with a backslash, so the path is built from the folder
rem that this installer sits in. Keep this path in step with the repository.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\print-agent\install-windows.ps1"
if errorlevel 1 (
  echo.
  echo Installation failed.
  pause
  exit /b 1
)
echo.
echo Installation complete. Print Agent v2 starts automatically at Windows logon.
echo Workspace: %WORKSPACE_ID%
echo Agent: %PRINT_AGENT_ID%
pause
