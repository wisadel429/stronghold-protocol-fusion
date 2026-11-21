@echo off
setlocal

rem --- admin console: http://localhost:3000/admin ---
rem Initial password 88888888. After login, use "修改口令" to set your own; it is saved to
rem admin-password.json and survives restarts.
rem To force a password from the environment, uncomment the next line (then the page cannot change it).
rem set "ADMIN_PASSWORD=change-me"

title Stronghold Protocol - 3000
cd /d "%~dp0"

rem --- allow audio to start as soon as the page opens (Chromium autoplay policy for WebView2 hosts) ---
set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--autoplay-policy=no-user-gesture-required"

rem --- already running? just open the browser ---
netstat -an | findstr /C:":3000" | findstr /C:"LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo Server is already running. Opening http://localhost:3000 ...
  start "" "http://localhost:3000"
  exit /b 0
)

rem --- find Node.js ---
set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"

if not defined NODE (
  echo.
  echo Node.js was not found.
  echo Install Node.js 22 or newer from https://nodejs.org/ and run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Stronghold Protocol: Alliance
echo   Starting the server (the first start builds the asset index, ~15 s)...
echo   The browser opens at http://localhost:3000 when it is ready.
echo   Close this window to stop the server.
echo.

rem --- open the browser once /healthz answers ---
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i=0; $i -lt 120; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:3000/healthz; if ($r.StatusCode -eq 200) { Start-Process 'http://localhost:3000'; break } } catch {}; Start-Sleep -Milliseconds 1000 }"

"%NODE%" server\index.js
echo.
echo Server stopped.
pause
