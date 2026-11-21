@echo off
setlocal
cd /d "%~dp0"

rem ============================================================================
rem  部署公开服务器（不打开游戏画面，只开服务端 + 后台）
rem  业主 2026-11-17：启动器的「部署公开服务器」偶发失败（WebView2 用户目录被占用），
rem  这个脚本不依赖启动器界面：交给 deploy-public.ps1（WMI 建进程，脚本退出后服务器继续跑）。
rem
rem  用法：双击即可；加 --no-open 只起服务、不打开浏览器（自启动任务用）。
rem ============================================================================

set "PS1=%~dp0deploy-public.ps1"
if not exist "%PS1%" (
  echo [x] 找不到 deploy-public.ps1
  pause
  exit /b 1
)

if /i "%~1"=="--no-open" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -OpenAdmin
)
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" (
  echo [x] 部署失败，退出码 %RC%。看 .cache\deploy.log 与 .cache\server-err.log
  pause
  exit /b %RC%
)
echo   本机后台：  http://127.0.0.1:3000/admin
echo   公网地址：  http://8.134.50.56:3000/
echo   局域网：    本机局域网 IP:3000  （ipconfig 里查）
echo.
if /i "%~1"=="--no-open" exit /b 0
pause