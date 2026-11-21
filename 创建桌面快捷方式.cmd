@echo off
rem Create a desktop shortcut that starts the launcher MAXIMIZED.
rem Why: the window size is compiled into Stronghold.exe; a shortcut's "Run: Maximized"
rem is honored by the host (verified: showCmd=3), so this needs no change to the exe.
setlocal
cd /d "%~dp0"
if not exist "create-desktop-shortcut.ps1" (
  echo [x] create-desktop-shortcut.ps1 not found next to this file.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-desktop-shortcut.ps1"
if errorlevel 1 (
  echo [x] failed
  pause
  exit /b 1
)
pause
