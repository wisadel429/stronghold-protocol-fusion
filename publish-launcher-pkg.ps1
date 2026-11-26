# publish-launcher-pkg.ps1（游戏目录里的旧入口 → 已改为转发）
#
# 为什么转发：启动器已经独立成仓库（..\_repo-launcher）。
# 游戏目录里的 launcher/ 是旧副本，从这里打热更包会打出**旧页面**，
# 玩家更完还是旧界面（2026-11-22 踩过这个坑）。
# 所以这个脚本不再自己打包，只把参数原样转给启动器仓库的正式脚本。

param(
  [string]$Notes = '',
  [string]$Version = '',
  [switch]$LocalOnly,
  [string]$Token = $env:GITHUB_TOKEN,
  [int]$KeepReleases = 3,
  [switch]$DryRun
)

$target = 'E:\stronghold\_repo-launcher\publish-launcher-pkg.ps1'
if (-not (Test-Path -LiteralPath $target)) {
  throw "找不到启动器仓库的打包脚本：$target（启动器已独立成仓库，请先确认路径）"
}

$a = @()
if ($Notes) { $a += @('-Notes', $Notes) }
if ($Version) { $a += @('-Version', $Version) }
if ($LocalOnly) { $a += '-LocalOnly' }
if ($Token) { $a += @('-Token', $Token) }
if ($KeepReleases -ne 3) { $a += @('-KeepReleases', "$KeepReleases") }
if ($DryRun) { $a += '-DryRun' }

Write-Host "  转发 → $target" -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File $target @a
