@echo off
rem 启动工坊编辑器（Forge 0.19.1 本体，从 Stronghold-Protocol-Forge-0.19.1-0.3.1 移植）
rem 只绑本机 127.0.0.1:3311；它写 forge\workshop\ 与 data\support.json，游戏服务器不会加载它。
chcp 65001 >nul
cd /d "%~dp0forge"
node tools\workshop-editor.mjs --port 3311 %*
if errorlevel 1 pause
