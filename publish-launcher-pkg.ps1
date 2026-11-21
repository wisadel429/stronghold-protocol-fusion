# publish-launcher-pkg.ps1 — 打包「只含代码」的启动器/游戏热更包并生成 manifest
#
# 业主 2026-11-22 铁律：**更新包里绝不含美术资源**（立绘 / UI 素材 / 图标 / 音频）。
# 所以这里只收集代码与文档类文件：.js .mjs .css .html .json(仅 launcher 配置类) .md
# 明确排除：public/assets、public/ui-art、public/icons、data/、任何图片/音频/字体。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File publish-launcher-pkg.ps1 [-Notes "本次改了什么"] [-Version "20261122-01"]
#
# 产物：
#   <安装目录>\public\launcher-pkg\launcher-pkg.zip
#   <安装目录>\public\launcher-pkg\manifest.json

param(
  [string]$Notes = '',
  [string]$Version = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stage = Join-Path $root '_pkg-stage\Stronghold-Protocol-v0.3.3-Fusion'
$outDir = Join-Path $root 'public\launcher-pkg'
if (-not $Version) { $Version = Get-Date -Format 'yyyyMMdd-HHmm' }

if (Test-Path (Join-Path $root '_pkg-stage')) { Remove-Item (Join-Path $root '_pkg-stage') -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null

# 收集规则：目录白名单 + 扩展名白名单 + 硬排除
$dirs = @('launcher', 'public\js', 'public\css', 'server', 'shared')
$exts = @('.js', '.mjs', '.css', '.html', '.md')
$hardExclude = @('assets', 'ui-art', 'icons', 'vendor', 'node_modules', 'launcher-pkg', '_pkg-stage')

$copied = 0
foreach ($d in $dirs) {
  $src = Join-Path $root $d
  if (-not (Test-Path $src)) { continue }
  Get-ChildItem $src -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1)
    foreach ($bad in $hardExclude) { if ($rel -match [regex]::Escape("\$bad\")) { return } }
    if ($exts -notcontains $_.Extension.ToLowerInvariant()) { return }
    # data/ 与任何资源目录一律不进包（双保险）
    if ($rel -match '^(data|public\\assets|public\\ui-art|public\\icons)\\') { return }
    $dst = Join-Path $stage $rel
    New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
    Copy-Item $_.FullName $dst -Force
    $script:copied++
  }
}
Write-Host ("  收集到 {0} 个代码文件（不含任何美术资源）" -f $copied)

New-Item -ItemType Directory -Force $outDir | Out-Null
$zip = Join-Path $outDir 'launcher-pkg.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
Remove-Item (Join-Path $root '_pkg-stage') -Recurse -Force

$sha = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$sizeKb = [math]::Round((Get-Item $zip).Length / 1KB, 1)
$manifest = [ordered]@{
  version = $Version
  at      = (Get-Date -Format 's')
  zip     = '/launcher-pkg/launcher-pkg.zip'
  sha256  = $sha
  bytes   = (Get-Item $zip).Length
  files   = $copied
  notes   = $Notes
  policy  = 'code-only; no art assets'
}
$json = ($manifest | ConvertTo-Json -Depth 4)
[System.IO.File]::WriteAllText((Join-Path $outDir 'manifest.json'), $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host ("  版本     : {0}" -f $Version)
Write-Host ("  包大小   : {0} KB（{1} 个文件）" -f $sizeKb, $copied)
Write-Host ("  sha256   : {0}" -f $sha)
Write-Host ("  产物目录 : {0}" -f $outDir)
