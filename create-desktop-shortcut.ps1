# create-desktop-shortcut.ps1 — 在桌面建「卫戍协议：盟约」快捷方式，运行方式=最大化（业主 2026-11-21）
#
# 为什么要快捷方式：Stronghold.exe 是编译好的宿主，窗口尺寸（1296×939）写在程序里，没有源码改不了；
# 但 Windows 快捷方式可以指定「运行方式：最大化」，实测宿主会照做（showCmd=3，窗口铺满屏幕）。
#
# 用法：双击同目录的「创建桌面快捷方式.cmd」，或在 PowerShell 里跑本脚本。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $root 'Stronghold.exe'
if (-not (Test-Path -LiteralPath $exe)) { Write-Host "找不到 Stronghold.exe：$exe" -ForegroundColor Red; exit 1 }

$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop '卫戍协议：盟约.lnk'

$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($lnkPath)
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = $root
$lnk.WindowStyle = 3          # 3 = 最大化（1 普通 / 3 最大化 / 7 最小化）
$lnk.Description = '卫戍协议：盟约 · 电脑版（默认最大化）'
# 图标：优先用 launcher\game.ico —— 由 public/icons/app-512.png（游戏 logo 的 512px 原图）
# 生成的多尺寸图标（16/24/32/48/64/128/256），与网页端 favicon 是同一张美术。
# 业主 2026-11-21「游戏图标用错了」：之前指到 launcher\app.ico —— 那是启动器的灰白标记，
# 跟游戏 logo 完全无关；Stronghold.exe 内嵌的那份也不是游戏 logo（实测与 favicon 差异 12 万+）。
$gameIcon = Join-Path $root 'launcher\game.ico'
$lnk.IconLocation = if (Test-Path -LiteralPath $gameIcon) { "$gameIcon,0" } else { "$exe,0" }
$lnk.Save()

$check = $sh.CreateShortcut($lnkPath)
Write-Host ''
Write-Host "  已创建：$lnkPath"
Write-Host "  目标：$($check.TargetPath)"
Write-Host "  运行方式：$($check.WindowStyle)（3 = 最大化）"
Write-Host ''
