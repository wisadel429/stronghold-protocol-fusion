@echo off
cd /d "%~dp0"

rem ============================================================================
rem  修复启动器打不开（窗口出现但一片空白；launcher.log 里 0x800700AA「请求的资源在使用中」）
rem  原因：WebView2 的用户数据目录被上一次异常退出的实例占用或损坏。
rem  做法：关掉所有启动器 / WebView2 进程，把用户数据目录改名备份，下次打开自动重建。
rem ============================================================================

echo.
echo   修复启动器（WebView2 用户数据目录）
echo   ------------------------------------

echo   [1/3] 关掉启动器与 WebView2 进程...
taskkill /f /im Stronghold.exe >nul 2>nul
taskkill /f /im msedgewebview2.exe >nul 2>nul
ping -n 3 127.0.0.1 >nul

set "UDF=%LOCALAPPDATA%\StrongholdProtocol\WebView2"
if not exist "%UDF%" (
  echo   [i] 没有用户数据目录，跳过清理
  goto :done
)

echo   [2/3] 备份并重置用户数据目录...
for /f "tokens=2 delims==" %%i in ('wmic os get localdatetime /value 2^>nul') do set "DT=%%i"
set "STAMP=%DT:~0,8%-%DT:~8,6%"
if exist "%UDF%.bak-%STAMP%" rd /s /q "%UDF%.bak-%STAMP%" >nul 2>nul
move "%UDF%" "%UDF%.bak-%STAMP%" >nul 2>nul
if errorlevel 1 (
  echo   [x] 改名失败，可能还有进程占用。请在任务管理器里结束 Stronghold.exe 再试。
  pause
  exit /b 1
)
echo   已备份到：%UDF%.bak-%STAMP%

:done
echo   [3/3] 完成。现在可以重新双击 Stronghold.exe 了。
echo.
pause