@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo  把启动器的「服务器列表」默认地址换成 121.4.51.247
echo ============================================
echo.

if not exist "Stronghold.exe.new" (
  echo [x] 找不到 Stronghold.exe.new，补丁副本不在这个目录。
  pause
  exit /b 1
)

rem 启动器还在运行的话，文件会被占用，替换会失败
tasklist /fi "imagename eq Stronghold.exe" 2>nul | find /i "Stronghold.exe" >nul
if not errorlevel 1 (
  echo [!] 检测到启动器还在运行，请先关掉它（包含托盘里的图标）再运行本脚本。
  pause
  exit /b 1
)

if exist "Stronghold.exe" (
  if exist "Stronghold.exe.old" del /f /q "Stronghold.exe.old"
  move /y "Stronghold.exe" "Stronghold.exe.old" >nul
  echo [1/2] 原文件已备份为 Stronghold.exe.old
)
move /y "Stronghold.exe.new" "Stronghold.exe" >nul
if errorlevel 1 (
  echo [x] 替换失败。请确认没有其它程序占用 Stronghold.exe。
  pause
  exit /b 1
)
echo [2/2] 新启动器已就位（默认列表 = http://121.4.51.247/）
echo.
echo 现在可以重新双击 Stronghold.exe 了。
echo 想还原的话：把 Stronghold.exe.old 改名回 Stronghold.exe 即可。
echo.
pause
