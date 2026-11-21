# push-to-github.ps1 — 一键推送到 GitHub（源码only，绝不含美术资源）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File push-to-github.ps1 -Token <classic PAT>      # 首次：存令牌 + 建仓库 + 推送
#   powershell -ExecutionPolicy Bypass -File push-to-github.ps1                           # 之后：直接推送（令牌已在凭据管理器）
#   ... -Release -Tag v0.3.3-yuan-20261122 -Notes "本次说明"                              # 额外发 Release（附源码包）
#
# 安全：令牌只用于 git credential store（Windows 凭据管理器，加密）与本次 API 调用，
#       不写进任何文件、不写进 .git/config、不打印。

param(
  [string]$Token = '',
  [string]$Owner = 'wisadel429',
  [string]$Repo  = 'stronghold-protocol-fusion',
  [switch]$Release,
  [string]$Tag = '',
  [string]$Notes = '',
  [string]$CommitMessage = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$gcm = 'C:\Program Files\Git\mingw64\bin\git-credential-manager.exe'

function Say($m) { Write-Host "  $m" }

# ---------- 1) 令牌 ----------
if ($Token) {
  Say '校验令牌…'
  $h = @{ Authorization = "Bearer $Token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'dsh-export' }
  $me = (Invoke-WebRequest -UseBasicParsing 'https://api.github.com/user' -Headers $h -TimeoutSec 25).Content | ConvertFrom-Json
  Say "  账号：$($me.login)"
  Say '存入 Windows 凭据管理器（以后不再弹授权）…'
  $in = "protocol=https`nhost=github.com`nusername=$($me.login)`npassword=$Token`n`n"
  $in | & $gcm store | Out-Null
} else {
  Say '使用已保存的令牌（无则先带 -Token 跑一次）'
}

# 取回令牌备用（不打印）
$probe = "protocol=https`nhost=github.com`n`n" | git credential fill 2>&1
$pat = ($probe | Where-Object { $_ -match '^password=' }) -replace '^password=',''
if (-not $pat) { throw '没有可用令牌，请带 -Token 运行一次' }
$h = @{ Authorization = "Bearer $pat"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'dsh-export' }

# ---------- 2) 仓库 ----------
$apiRepo = "https://api.github.com/repos/$Owner/$Repo"
$exists = $true
try { Invoke-WebRequest -UseBasicParsing $apiRepo -Headers $h -TimeoutSec 20 | Out-Null } catch { $exists = $false }
if (-not $exists) {
  Say '创建公开仓库…'
  $body = @{ name = $Repo; description = '卫戍协议：盟约 · 融合版源码（仅代码，不含任何美术资源）'; private = $false; has_issues = $true; has_wiki = $false; auto_init = $false } | ConvertTo-Json
  $r = Invoke-WebRequest -UseBasicParsing 'https://api.github.com/user/repos' -Method POST -Headers $h -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 40
  $repoObj = $r.Content | ConvertFrom-Json
  Say "  已创建：$($repoObj.html_url)"
} else {
  Say '仓库已存在'
}

# ---------- 3) 安全检查（提交前） ----------
Say '检查暂存区有没有美术资源 / 密钥…'
git add -A
$staged = @(git diff --cached --name-only)
$bad = $staged | Where-Object { $_ -match '\.(png|jpe?g|webp|gif|bmp|ico|svg|ttf|otf|woff2?|mp3|ogg|wav|m4a|mp4|webm|pptx?|zip|rar|7z|apk|exe|dll)$' }
$secret = $staged | Where-Object { $_ -match '(^|/)(data/|packed/)|admin-password|admin-update-key|launcher-config\.json' }
if ($bad)    { throw ("拒绝推送：暂存区含美术/二进制文件`n" + ($bad -join "`n")) }
if ($secret) { throw ("拒绝推送：暂存区含玩家数据或密钥`n" + ($secret -join "`n")) }
Say ("  通过（暂存 " + $staged.Count + " 个文件）")

# ---------- 4) 提交并推送 ----------
if ($staged.Count -gt 0) {
  if (-not $CommitMessage) { $CommitMessage = 'chore: 同步源码 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') }
  git -c user.name=$Owner -c user.email="$Owner@users.noreply.github.com" commit -q -m $CommitMessage
  Say '已提交'
}
$env:GIT_TERMINAL_PROMPT = '0'
git remote remove origin 2>$null
git remote add origin "https://github.com/$Owner/$Repo.git"
Say '推送中…'
git push -u origin main 2>&1 | ForEach-Object { "    $_" }
if ($LASTEXITCODE -ne 0) { throw '推送失败' }
Say '推送完成'

# ---------- 5) Release（可选） ----------
if ($Release) {
  if (-not $Tag) { $Tag = 'v' + (Get-Date -Format 'yyyyMMdd-HHmm') }
  $stage = Join-Path $env:TEMP ('gh-release-' + [guid]::NewGuid().ToString('N').Substring(0,6))
  New-Item -ItemType Directory -Force $stage | Out-Null
  $zipName = "stronghold-source-$Tag.zip"
  $zipPath = Join-Path $stage $zipName
  Say "生成源码包 $zipName…"
  git archive --format=zip --prefix='stronghold-protocol-fusion/' -o $zipPath HEAD
  $entries = tar -t -f $zipPath
  $badZip = $entries | Where-Object { $_ -match '\.(png|jpe?g|webp|ico|svg|mp3|ogg|wav|ttf|otf|woff2?|mp4)$' }
  if ($badZip) { throw '源码包内含美术文件，已中止' }
  Say ("  包内 " + $entries.Count + " 个条目，美术文件 0 个")

  Say '创建 Release…'
  $relBody = @{ tag_name = $Tag; name = $Tag; body = $(if ($Notes) { $Notes } else { "源码快照 $Tag（仅代码，不含美术资源）" }); draft = $false; prerelease = $false } | ConvertTo-Json
  $rel = (Invoke-WebRequest -UseBasicParsing "https://api.github.com/repos/$Owner/$Repo/releases" -Method POST -Headers $h -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($relBody)) -TimeoutSec 40).Content | ConvertFrom-Json
  Say "  Release: $($rel.html_url)"

  Say '上传源码包…'
  $up = "https://uploads.github.com/repos/$Owner/$Repo/releases/$($rel.id)/assets?name=$zipName"
  $bytes = [System.IO.File]::ReadAllBytes($zipPath)
  $hr = Invoke-WebRequest -UseBasicParsing $up -Method POST -Headers @{ Authorization = "Bearer $pat"; 'User-Agent' = 'dsh-export'; Accept = 'application/vnd.github+json' } -ContentType 'application/zip' -Body $bytes -TimeoutSec 300
  $asset = $hr.Content | ConvertFrom-Json
  Say "  已上传：$($asset.browser_download_url)  ($([math]::Round($asset.size/1MB,2)) MB)"
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Say '全部完成'
