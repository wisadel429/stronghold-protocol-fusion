# publish-launcher-pkg.ps1 — 打「只含代码」的启动器页面热更包
#
# 业主 2026-11-22 最终口径：
#   · **游戏代码热更通道已关闭** —— 分发版想换代码只能整包换；
#   · 只剩**启动器页面**一条通道（launcher/），而且**只有业主自己的机器**联网检查
#     （宿主读 data/update-channel.json，enabled 不为 true 就一点网都不发）。
#   · 铁律不变：更新包里**绝不含美术资源**（立绘 / UI 素材 / 图标 / 音频）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File publish-launcher-pkg.ps1 -Notes "改了什么" [-Version 20261123-08] [-GitHub] [-DryRun]
#
# 产物（<安装目录>\public\launcher-pkg\）：
#   launcher-pkg.zip           启动器热更包（服务器用）
#   manifest.json              服务器用清单（zip 为相对路径）
#   launcher-pkg-manifest.json -GitHub 时给 Release 用的清单（zip 为绝对地址）

param(
  [string]$Notes = '',
  [string]$Version = '',
  [switch]$GitHub,
  [string]$Token = $env:GITHUB_TOKEN,
  [string]$Repo = 'wisadel429/stronghold-protocol-fusion',
  [int]$KeepReleases = 3,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root 'public\launcher-pkg'
if (-not $Version) { $Version = Get-Date -Format 'yyyyMMdd-HHmm' }
New-Item -ItemType Directory -Force $outDir | Out-Null

$dirs = @('launcher')
$exts = @('.js', '.mjs', '.css', '.html', '.md')
$hardExclude = @('assets', 'ui-art', 'icons', 'vendor', 'node_modules', 'launcher-pkg', '_pkg-stage')

$stageRoot = Join-Path $root '_pkg-stage'
if (Test-Path $stageRoot) { Remove-Item $stageRoot -Recurse -Force }
$stage = Join-Path $stageRoot 'Stronghold-Protocol-v0.3.3-Fusion'
New-Item -ItemType Directory -Force $stage | Out-Null

$copied = 0
foreach ($d in $dirs) {
  $src = Join-Path $root $d
  if (-not (Test-Path $src)) { continue }
  Get-ChildItem $src -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($root.Length + 1)
    foreach ($bad in $hardExclude) { if ($rel -match [regex]::Escape("\$bad\")) { return } }
    if ($exts -notcontains $_.Extension.ToLowerInvariant()) { return }
    if ($rel -match '^(data|public\\assets|public\\ui-art|public\\icons)\\') { return }
    $dst = Join-Path $stage $rel
    New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
    Copy-Item $_.FullName $dst -Force
    $script:copied++
  }
}
Write-Host ("  收集到 {0} 个启动器页面文件（不含任何美术资源）" -f $copied)

$zip = Join-Path $outDir 'launcher-pkg.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
# -Path 传的是顶层目录，所以 zip 里带一层 Stronghold-Protocol-v0.3.3-Fusion/，宿主解压时会剥掉
Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stageRoot -Recurse -Force

$sha = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$bytes = (Get-Item $zip).Length
$sizeKb = [math]::Round($bytes / 1KB, 1)

# 启动器版本号（与热更包 version 是两个口径）
$launcherVersion = ''
$lvFile = Join-Path $root 'launcher\version.json'
if (Test-Path -LiteralPath $lvFile) {
  try { $launcherVersion = (Get-Content -LiteralPath $lvFile -Raw -Encoding UTF8 | ConvertFrom-Json).launcher } catch { }
}

# GitHub Release 的稳定地址：latest 永远指向最新一版，不需要 API、不吃速率限制
$ghZip = "https://github.com/$Repo/releases/latest/download/launcher-pkg.zip"
$manifest = [ordered]@{
  version = $Version
  kind    = 'launcher'
  at      = (Get-Date -Format 's')
  zip     = '/launcher-pkg/launcher-pkg.zip'
  sha256  = $sha
  bytes   = $bytes
  files   = $copied
  notes   = $Notes
  policy  = 'code-only; launcher page only'
}
if ($launcherVersion) { $manifest.launcherVersion = $launcherVersion }
if ($GitHub) { $manifest.zipFallback = $ghZip }
[System.IO.File]::WriteAllText((Join-Path $outDir 'manifest.json'), ($manifest | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))

if ($GitHub) {
  $ghManifest = [ordered]@{
    version = $Version; kind = 'launcher'; at = (Get-Date -Format 's')
    zip = $ghZip; sha256 = $sha; bytes = $bytes; files = $copied
    notes = $Notes; policy = 'code-only; launcher page only'; source = 'github'
  }
  if ($launcherVersion) { $ghManifest.launcherVersion = $launcherVersion }
  [System.IO.File]::WriteAllText((Join-Path $outDir 'launcher-pkg-manifest.json'),
    ($ghManifest | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host ""
Write-Host ("  版本     : {0}" -f $Version)
Write-Host ("  启动器   : v{0}（独立版本号，来自 launcher/version.json）" -f ($(if ($launcherVersion) { $launcherVersion } else { '未设置' })))
Write-Host ("  包大小   : {0} KB（{1} 个文件）" -f $sizeKb, $copied)
Write-Host ("  sha256   : {0}" -f $sha)
Write-Host ("  产物目录 : {0}" -f $outDir)

if (-not $GitHub) {
  Write-Host '  提示     : 未带 -GitHub，只更新了本机包（玩家拿到的仍是服务器那份）'
  return
}
if ($DryRun) {
  Write-Host '  DryRun   : 跳过上传（-GitHub 已写入 zipFallback 与 launcher-pkg-manifest.json）'
  return
}

if (-not $Token) {
  try {
    $lines = "protocol=https`nhost=github.com`n`n" | git credential fill 2>$null
    foreach ($line in $lines) { if ($line -match '^password=(.+)$') { $Token = $Matches[1] } }
  } catch { }
}
if (-not $Token) { throw '缺少 GitHub 令牌：用 -Token 传入，或先跑 push-to-github.ps1 存一次' }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[System.Net.WebRequest]::DefaultWebProxy = $null

$apiBase = "https://api.github.com/repos/$Repo"
$headers = @{ Authorization = "token $Token"; 'User-Agent' = 'Stronghold-Publish-Script'; Accept = 'application/vnd.github+json' }
$tag = "launcher-$Version"

try {
  $old = Invoke-RestMethod -Method Get -Uri "$apiBase/releases/tags/$tag" -Headers $headers -TimeoutSec 30
  if ($old -and $old.id) {
    Invoke-RestMethod -Method Delete -Uri "$apiBase/releases/$($old.id)" -Headers $headers -TimeoutSec 30
    Write-Host ("  重发     : 已删除同版本旧 Release {0}" -f $tag)
  }
} catch { }

$body = @{
  tag_name   = $tag
  name       = "启动器热更 $Version"
  body       = if ($Notes) { $Notes } else { "启动器页面热更 $Version（只含 launcher/，不含美术资源；游戏代码通道已关闭）" }
  draft      = $false
  prerelease = $false
} | ConvertTo-Json

Write-Host ("  发布     : {0}" -f $tag)
$rel = Invoke-RestMethod -Method Post -Uri "$apiBase/releases" -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 60

$assets = @(
  @{ file = $zip; name = 'launcher-pkg.zip' },
  @{ file = (Join-Path $outDir 'launcher-pkg-manifest.json'); name = 'launcher-pkg-manifest.json' }
)
foreach ($a in $assets) {
  $up = "https://uploads.github.com/repos/$Repo/releases/$($rel.id)/assets?name=$($a.name)"
  $res = Invoke-RestMethod -Method Post -Uri $up -Headers $headers -InFile $a.file -ContentType 'application/octet-stream' -TimeoutSec 600
  Write-Host ("  上传     : {0} ({1:N0} B)" -f $res.name, $res.size)
}

try {
  $all = Invoke-RestMethod -Method Get -Uri "$apiBase/releases?per_page=100" -Headers $headers -TimeoutSec 60
  $mine = @($all | Where-Object { $_.tag_name -like 'launcher-*' } | Sort-Object created_at -Descending)
  $drop = @($mine | Select-Object -Skip $KeepReleases)
  foreach ($r in $drop) {
    Invoke-RestMethod -Method Delete -Uri "$apiBase/releases/$($r.id)" -Headers $headers -TimeoutSec 30
    Write-Host ("  清理     : 已删除旧 Release {0}" -f $r.tag_name)
  }
} catch { Write-Host '  清理     : 跳过（列取 Release 失败，不影响本次发布）' }

Write-Host ("  完成     : 兜底下载地址 = {0}" -f $ghZip) -ForegroundColor Green
