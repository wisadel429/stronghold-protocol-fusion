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
  [string]$Version = '',
  # 业主 2026-11-22 定的 C 方案：自有服务器优先，GitHub 兜底。
  # -GitHub 时：manifest 里写 zipFallback（GitHub 稳定地址），并把 zip + 给 GitHub 用的 manifest 发到 Release。
  [switch]$GitHub,
  [string]$Token = $env:GITHUB_TOKEN,
  [string]$Repo = 'wisadel429/stronghold-protocol-fusion',
  [int]$KeepReleases = 3,
  # 只打包、不联网（用于自测）
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stage = Join-Path $root '_pkg-stage\Stronghold-Protocol-v0.3.3-Fusion'
$outDir = Join-Path $root 'public\launcher-pkg'
if (-not $Version) { $Version = Get-Date -Format 'yyyyMMdd-HHmm' }

if (Test-Path (Join-Path $root '_pkg-stage')) { Remove-Item (Join-Path $root '_pkg-stage') -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null

# 收集规则：目录白名单 + 扩展名白名单 + 硬排除
$dirs = @('launcher', 'public\js', 'public\css', 'public\ui-themes', 'server', 'shared')
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
# 启动器自己的版本号（业主 2026-11-22）：与热更包 version 分开，来源是 launcher/version.json
$lvFile = Join-Path $root 'launcher\version.json'
$launcherVersion = ''
if (Test-Path -LiteralPath $lvFile) {
  try { $launcherVersion = (Get-Content -LiteralPath $lvFile -Raw -Encoding UTF8 | ConvertFrom-Json).launcher } catch { }
}
# GitHub Release 的稳定地址：latest 永远指向最新一版，不需要 API、不吃速率限制
$ghZip = "https://github.com/$Repo/releases/latest/download/launcher-pkg.zip"
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
if ($launcherVersion) { $manifest.launcherVersion = $launcherVersion }
if ($GitHub) { $manifest.zipFallback = $ghZip }
$json = ($manifest | ConvertTo-Json -Depth 4)
[System.IO.File]::WriteAllText((Join-Path $outDir 'manifest.json'), $json, (New-Object System.Text.UTF8Encoding($false)))

# 给 GitHub 用的那份 manifest：zip 必须是绝对地址（它在 Release 资产里，拼不到服务器路径）
if ($GitHub) {
  $ghManifest = [ordered]@{
    version   = $Version
    at        = (Get-Date -Format 's')
    zip       = $ghZip
    sha256    = $sha
    bytes     = (Get-Item $zip).Length
    files     = $copied
    notes     = $Notes
    policy    = 'code-only; no art assets'
    source    = 'github'
  }
  if ($launcherVersion) { $ghManifest.launcherVersion = $launcherVersion }
  [System.IO.File]::WriteAllText(
    (Join-Path $outDir 'launcher-pkg-manifest.json'),
    ($ghManifest | ConvertTo-Json -Depth 4),
    (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host ""
Write-Host ("  版本     : {0}" -f $Version)
Write-Host ("  启动器   : v{0}（独立版本号，来自 launcher/version.json）" -f ($(if ($launcherVersion) { $launcherVersion } else { '未设置' })))
Write-Host ("  包大小   : {0} KB（{1} 个文件）" -f $sizeKb, $copied)
Write-Host ("  sha256   : {0}" -f $sha)
Write-Host ("  产物目录 : {0}" -f $outDir)

# ---- 发到 GitHub Release（业主 2026-11-22 定的兜底源）----------------------------------
if (-not $GitHub) {
  Write-Host '  提示     : 未带 -GitHub，只更新了本机包（玩家拿到的仍是服务器那份）'
  return
}

if ($DryRun) {
  Write-Host '  DryRun   : 跳过上传（-GitHub 已写入 zipFallback 与 launcher-pkg-manifest.json）'
  return
}

# 令牌：参数 → 环境变量 → Windows 凭据管理器（push-to-github.ps1 存的那个）
if (-not $Token) {
  try {
    $lines = "protocol=https`nhost=github.com`n`n" | git credential fill 2>$null
    foreach ($line in $lines) { if ($line -match '^password=(.+)$') { $Token = $Matches[1] } }
  } catch { }
}
if (-not $Token) { throw '缺少 GitHub 令牌：用 -Token 传入，或先跑 push-to-github.ps1 存一次' }

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[System.Net.WebRequest]::DefaultWebProxy = $null      # 本机系统代理是自动检测，会卡十几秒

$apiBase = "https://api.github.com/repos/$Repo"
$headers = @{ Authorization = "token $Token"; 'User-Agent' = 'Stronghold-Publish-Script'; Accept = 'application/vnd.github+json' }
$tag = "launcher-$Version"

# 同版本重发：先把旧的那个删掉（tag 不能重复）
try {
  $old = Invoke-RestMethod -Method Get -Uri "$apiBase/releases/tags/$tag" -Headers $headers -TimeoutSec 30
  if ($old -and $old.id) {
    Invoke-RestMethod -Method Delete -Uri "$apiBase/releases/$($old.id)" -Headers $headers -TimeoutSec 30
    Write-Host ("  重发     : 已删除同版本旧 Release {0}" -f $tag)
  }
} catch { }

$body = @{
  tag_name = $tag
  name     = "启动器热更 $Version"
  body     = if ($Notes) { $Notes } else { "启动器/客户端热更包 $Version（只含代码，不含美术资源）" }
  draft    = $false
  prerelease = $false
} | ConvertTo-Json

Write-Host ("  发布     : {0}" -f $tag)
$rel = Invoke-RestMethod -Method Post -Uri "$apiBase/releases" -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 60

$assets = @(
  @{ file = $zip;                                  name = 'launcher-pkg.zip' },
  @{ file = (Join-Path $outDir 'launcher-pkg-manifest.json'); name = 'launcher-pkg-manifest.json' }
)
foreach ($a in $assets) {
  $up = "https://uploads.github.com/repos/$Repo/releases/$($rel.id)/assets?name=$($a.name)"
  $res = Invoke-RestMethod -Method Post -Uri $up -Headers $headers -InFile $a.file -ContentType 'application/octet-stream' -TimeoutSec 600
  Write-Host ("  上传     : {0} ({1:N0} B)" -f $res.name, $res.size)
}

# 只保留最近 N 个启动器 Release，避免仓库越堆越大（每版 ~7 MB）
try {
  $all = Invoke-RestMethod -Method Get -Uri "$apiBase/releases?per_page=100" -Headers $headers -TimeoutSec 60
  $mine = @($all | Where-Object { $_.tag_name -like 'launcher-*' } | Sort-Object created_at -Descending)
  $drop = @($mine | Select-Object -Skip $KeepReleases)
  foreach ($r in $drop) {
    Invoke-RestMethod -Method Delete -Uri "$apiBase/releases/$($r.id)" -Headers $headers -TimeoutSec 30
    Write-Host ("  清理     : 已删除旧 Release {0}" -f $r.tag_name)
  }
} catch { Write-Host '  清理     : 跳过（列取 Release 失败，不影响本次发布）' }

Write-Host ("  完成     : 玩家兜底下载地址 = {0}" -f $ghZip) -ForegroundColor Green
