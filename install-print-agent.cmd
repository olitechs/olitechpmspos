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
if "%WORKSPACE_ID%"=="" set /p WORKSPACE_ID=Workspace ID: 
if "%PRINT_AGENT_ID%"=="" set /p PRINT_AGENT_ID=Agent ID (UUID): 
if "%SUPABASE_SERVICE_ROLE_KEY%"=="" set /p SUPABASE_SERVICE_ROLE_KEY=Supabase service-role key (local PC only): 
setx WORKSPACE_ID "%WORKSPACE_ID%" >nul
setx PRINT_AGENT_ID "%PRINT_AGENT_ID%" >nul
if not "%SUPABASE_SERVICE_ROLE_KEY%"=="" setx SUPABASE_SERVICE_ROLE_KEY "%SUPABASE_SERVICE_ROLE_KEY%" >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0toolsprint-agentinstall-windows.ps1"
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
