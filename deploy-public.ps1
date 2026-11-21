# deploy-public.ps1 — 公开服务器后台部署（自启动任务 / 手动都可用）
#
# 业主 2026-11-17：启动器的「部署公开服务器」偶发失败（WebView2 用户目录被占用），
# 这个脚本不依赖启动器界面：检查 → 起 node 服务端（隐藏窗口、独立进程）→ 等 /healthz → 写日志。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy-public.ps1            # 部署（已在跑就跳过）
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy-public.ps1 -OpenAdmin # 部署后打开后台
#
param(
  [int]$Port = 3000,
  [int]$WaitSeconds = 90,
  [switch]$OpenAdmin
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path $root 'node\node.exe'
$cache = Join-Path $root '.cache'
$log = Join-Path $cache 'server-out.log'
$err = Join-Path $cache 'server-err.log'
$deployLog = Join-Path $cache 'deploy.log'

if (-not (Test-Path -LiteralPath $node)) { throw "找不到 $node" }
if (-not (Test-Path -LiteralPath $cache)) { New-Item -ItemType Directory -Path $cache | Out-Null }

function Write-DeployLog([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -LiteralPath $deployLog -Value $line -Encoding UTF8
  Write-Host $line
}

function Test-Health([int]$timeoutSec = 3) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec $timeoutSec "http://127.0.0.1:$Port/healthz"
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

if (Test-Health) {
  Write-DeployLog "服务器已在运行（端口 $Port 有响应），跳过启动"
} else {
  # 端口被别的程序占着但没有 /healthz：报出来，别盲目起进程
  $busy = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if ($busy) {
    Write-DeployLog "端口 $Port 被 pid=$($busy[0].OwningProcess) 占用，但没有 /healthz 响应，放弃启动"
    exit 2
  }
  Write-DeployLog "启动服务端：$node server\index.js（隐藏窗口）"
  # 用 WMI 建进程：它挂在 WmiPrvSE 下，**不属于本脚本的进程树**，脚本退出 / 控制台关闭都不会带走它；
  # 重定向交给 cmd 自己（>>），父进程不持有管道，所以脚本能立刻退出（任务计划里不会一直「运行中」）。
  $line = 'cmd.exe /c ""{0}" server\index.js >> "{1}" 2>> "{2}""' -f $node, $log, $err
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $line; CurrentDirectory = $root }
  if ($created.ReturnValue -ne 0) { Write-DeployLog "创建进程失败（WMI ReturnValue=$($created.ReturnValue)）"; exit 3 }
  Write-DeployLog "已启动（cmd pid=$($created.ProcessId)），等待就绪（最多 $WaitSeconds 秒）…"
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  $ok = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 800
    if (Test-Health 2) { $ok = $true; break }
  }
  if (-not $ok) { Write-DeployLog "$WaitSeconds 秒内没有响应 /healthz，看 $err"; exit 4 }
  Write-DeployLog "就绪：http://127.0.0.1:$Port/ （公网 http://8.134.50.56:$Port/）"
}

if ($OpenAdmin) { Start-Process "http://127.0.0.1:$Port/admin" | Out-Null }
exit 0
