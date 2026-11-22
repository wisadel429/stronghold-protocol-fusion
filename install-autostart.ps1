<#
install-autostart.ps1 — 游戏服开机自启（业主 2026-11-22，待办 T-06）

平时不需要跑这个脚本：服务端每次启动都会自检（server/autostart.js），
没有计划任务就自己建一个。只有当 /healthz 里 autostart.state 是 "denied"
（服务端进程没有管理员权限）时，才需要在这里手动跑一次。

用法：
  powershell -ExecutionPolicy Bypass -File install-autostart.ps1           # 注册（会提权）
  powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -Status    # 查看当前状态
  powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -Remove    # 删除

参数：
  -TaskName  计划任务名，默认 StrongholdGameServer（必须与 data/autostart.json 的 name 一致）
  -DelaySec  开机延迟秒数，默认 30 —— 等网卡和磁盘就绪再起，否则开机瞬间域名会 502
#>
param(
  [switch]$Status,
  [switch]$Remove,
  [string]$TaskName = 'StrongholdGameServer',
  [int]$DelaySec = 30
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$entry = Join-Path $root 'server\index.js'

# schtasks 往 stderr 写东西时，$ErrorActionPreference='Stop' 会把它当异常抛出，
# 输出一片红字。这里临时切成 Continue，只取退出码和文本。
function Invoke-Schtasks {
  param([string[]]$Arguments)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    # 原生命令的 stderr 会被包成 ErrorRecord，Out-String 会把调用栈一起打出来（一片红字）。
    # 逐项取文本：ErrorRecord 取 Exception.Message，其余取字符串。
    $lines = & schtasks.exe @Arguments 2>&1 | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { [string]$_ }
    }
    $code = $LASTEXITCODE
    return [pscustomobject]@{ Code = $code; Text = (($lines -join "`n").Trim()) }
  } finally {
    $ErrorActionPreference = $prev
  }
}

# ---- 查状态（不需要管理员）----
if ($Status) {
  Write-Host "计划任务：$TaskName"
  $r = Invoke-Schtasks @('/Query', '/TN', $TaskName)
  if ($r.Text) { $r.Text -split "`r?`n" | ForEach-Object { "  $_" } }
  if ($r.Code -eq 0) { Write-Host '  → 已注册' -ForegroundColor Green }
  else { Write-Host '  → 尚未注册（服务端启动时会自动尝试；也可以 -Remove 之外的默认用法手动注册）' -ForegroundColor Yellow }
  exit 0
}

# ---- 提权：建/删任务都必须管理员 ----
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host '需要管理员权限，正在提权重开…' -ForegroundColor Yellow
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-TaskName', $TaskName, '-DelaySec', $DelaySec)
  if ($Remove) { $argList += '-Remove' }
  $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs -PassThru -Wait
  exit $proc.ExitCode
}

# ---- 删 ----
if ($Remove) {
  $r = Invoke-Schtasks @('/Delete', '/TN', $TaskName, '/F')
  if ($r.Text) { $r.Text -split "`r?`n" | ForEach-Object { "  $_" } }
  if ($r.Code -eq 0) { Write-Host "已删除计划任务 $TaskName" -ForegroundColor Green }
  else { Write-Host "删除失败（exit $($r.Code)）" -ForegroundColor Red }
  exit $r.Code
}

# ---- 建 ----
$node = Join-Path $root 'node\node.exe'
if (-not (Test-Path -LiteralPath $node)) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { throw '找不到 node.exe：包里没有 node\node.exe，PATH 里也没有' }
  $node = $cmd.Source
}
if (-not (Test-Path -LiteralPath $entry)) { throw "找不到服务端入口：$entry" }

$delay = '0000:{0:D2}' -f [int]$DelaySec
$run = '"' + $node + '" "' + $entry + '"'

Write-Host "node  ：$node"
Write-Host "入口  ：$entry"
Write-Host "延迟  ：${DelaySec}s"
Write-Host ''

$r = Invoke-Schtasks @('/Create', '/TN', $TaskName, '/TR', $run, '/SC', 'ONSTART', '/DELAY', $delay, '/RU', 'SYSTEM', '/RL', 'HIGHEST', '/F')
if ($r.Text) { $r.Text -split "`r?`n" | ForEach-Object { "  $_" } }

if ($r.Code -eq 0) {
  Write-Host ''
  Write-Host "已注册：$TaskName（开机延迟 ${DelaySec}s，以 SYSTEM 运行）" -ForegroundColor Green
  Write-Host '验证：http://8.134.50.56:3000/healthz 里的 autostart.state 应为 "ok"' -ForegroundColor Cyan
  exit 0
}

Write-Host "注册失败（exit $($r.Code)）" -ForegroundColor Red
exit $r.Code