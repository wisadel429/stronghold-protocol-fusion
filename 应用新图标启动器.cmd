@echo off
rem ===========================================================================
rem  Apply the new launcher exe (icon updated to the game art, 2026-11-21).
rem  A running exe cannot be overwritten on Windows, so this script:
rem    1) closes Stronghold.exe
rem    2) backs it up as Stronghold.exe.bak-icon-<stamp>
rem    3) moves Stronghold.exe.new into place
rem  Requires: Stronghold.exe.new next to this file (it ships in the hotfix zip).
rem ===========================================================================
setlocal
cd /d "%~dp0"

if not exist "Stronghold.exe.new" (
  echo [x] Stronghold.exe.new not found next to this script.
  pause
  exit /b 1
)

echo   [1/3] Closing launcher...
taskkill /f /im Stronghold.exe >nul 2>nul
ping -n 3 127.0.0.1 >nul

echo   [2/3] Backing up and swapping...
for /f "tokens=2 delims==" %%i in ('wmic os get localdatetime /value 2^>nul') do set "DT=%%i"
set "STAMP=%DT:~0,8%"
if exist "Stronghold.exe" (
  if exist "Stronghold.exe.bak-icon-%STAMP%" del /f /q "Stronghold.exe.bak-icon-%STAMP%" >nul 2>nul
  move /y "Stronghold.exe" "Stronghold.exe.bak-icon-%STAMP%" >nul
)
move /y "Stronghold.exe.new" "Stronghold.exe" >nul
if errorlevel 1 (
  echo   [x] Swap failed. Close the launcher (including the tray icon) and retry.
  pause
  exit /b 1
)

echo   [3/3] Done. Taskbar icon is now the game art.
echo.
echo   To revert: rename Stronghold.exe.bak-icon-%STAMP% back to Stronghold.exe
echo.
pause
