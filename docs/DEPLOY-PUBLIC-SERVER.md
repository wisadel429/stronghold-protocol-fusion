# 2026-11-17 公开服务器部署记录（8.134.50.56:3000）

## 一、现状

| 项 | 值 |
|---|---|
| 玩法地址 | `http://8.134.50.56:3000/` |
| 管理后台 | `http://8.134.50.56:3000/admin`（口令见业主自留） |
| 本机 | `http://127.0.0.1:3000/` |
| 版本 | `0.3.3-Yuan`，`build=0c6682201e37` |
| 开放版本 | 只有 `act2autochess`（第二期下半）；其余四期 `blocked`，选择器里显示「暂未开放」 |
| 家宽/公网 | 出口公网 IP 实测 = `8.134.50.56`（`https://ifconfig.me/ip`），端口 3000 外部可达 |
| 监听 | `::`（所有网卡，IPv4/IPv6 双栈），Windows 防火墙当前**三个配置全部关闭** |

## 二、为什么你「开启失败」

两个独立原因，都已处理：

### 1）启动器窗口起来但一片空白（2026-11-17 14:12 / 14:13 的两次）

`launcher.log` 里是：

```
FATAL System.Runtime.InteropServices.COMException (0x800700AA): 请求的资源在使用中。
   在 Microsoft.Web.WebView2.Core.CoreWebView2Environment.<CreateCoreWebView2ControllerAsync>...
```

0x800700AA = `ERROR_BUSY`：WebView2 的**用户数据目录**被上一次异常退出的实例占着/写坏了。
处理：把 `%LOCALAPPDATA%\StrongholdProtocol\WebView2` 改名备份，让启动器重建 —— 改名后立刻
`webview ready`、`navigate issued`，恢复正常。

以后再遇到：双击 **`修复启动器.cmd`**（它会关掉残留进程 + 重置该目录，并保留备份）。

### 2）从「下载」目录运行未签名 exe，Windows 弹「无法验证发布者」

代理在会话里起启动器时，枚举到它的窗口就是一个「打开文件 - 安全警告」对话框：
`名称: ...\Downloads\Stronghold-Protocol-v0.3.3-Fusion\Stronghold.exe · 发行商: 未知发布者`。
这是 Windows 对"下载目录 + 未签名程序"的保护。你自己的双击如果也被这个弹窗拦住，点「运行」即可；
更彻底的做法是把整个安装目录挪出 `Downloads`（例如 `C:\Stronghold`），挪完记得重跑一次
`部署公开服务器.cmd`、并重建自启动任务（见下）。

### 3）顺带确认掉的

- 服务端进程本身没有问题（`/healthz` 200、`artKey ok`）；
- 端口没被占用，防火墙没拦；
- 公网 IP 就是本机（不是别的机器）。

## 三、以后怎么开 / 怎么关

| 操作 | 做法 |
|---|---|
| 开公开服务器（推荐） | 双击 **`部署公开服务器.cmd`**：已运行就直接开后台；没运行就隐藏启动 → 等 `/healthz` → 打开 `/admin` |
| 只起服务不开浏览器 | `部署公开服务器.cmd --no-open`（自启动任务用的就是这条） |
| 用 PowerShell 起 | `powershell -NoProfile -ExecutionPolicy Bypass -File deploy-public.ps1 [-OpenAdmin]` |
| 关服务器 | 任务管理器结束 `node.exe`；或 `Get-Process node | Stop-Process -Force` |
| 看日志 | `.cache\server-out.log`、`.cache\server-err.log`、`.cache\deploy.log`、`launcher.log` |

> 启动方式说明：`deploy-public.ps1` 用 **WMI `Win32_Process.Create`** 建进程（`cmd /c node … >> 日志`）。
> 这样 node 不挂在脚本的进程树里，脚本退出、cmd 窗口关闭都不会带走服务器；
> 也没给 `Start-Process` 挂 `-RedirectStandardOutput`（那会让 PowerShell 等管道关闭，任务计划里会一直显示「运行中」）。
> 脚本是 **UTF-8 带 BOM** 保存的（PowerShell 5.1 不带 BOM 会把中文当 ANSI，直接语法报错）。

## 四、开机自启（已装）

登录 30 秒后自动隐藏启动公开服务器，任务名 **`Stronghold-Public-Server`**（任务计划程序 → 任务计划程序库）。

```powershell
# 查看
Get-ScheduledTask -TaskName 'Stronghold-Public-Server' | Select TaskName,State
Get-ScheduledTaskInfo -TaskName 'Stronghold-Public-Server'
# 手动跑一次
Start-ScheduledTask -TaskName 'Stronghold-Public-Server'
# 不想要了
Unregister-ScheduledTask -TaskName 'Stronghold-Public-Server' -Confirm:$false
```

它执行的是：`powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File deploy-public.ps1`
- 已有服务器在跑 → 记一行日志后退出（不会重复起进程）；
- 没有 → 隐藏启动 `node\node.exe server\index.js`（WMI 建进程，脱离任务进程树），等就绪，写 `.cache\deploy.log`。
- 实测：`LastTaskResult = 0`；停掉服务后手动跑一次任务，10 秒内 `/healthz` 恢复 200，任务随即结束（不会卡在「运行中」）。

> 说明：这是「登录时」触发（用户 Administrator 登录后）。如果机器长期不登录、当纯服务器用，
> 要改成「开机时」触发并让任务以 SYSTEM 运行，需要另配（`deploy-public.ps1` 与绝对路径都兼容）。

## 五、注意

- **Windows 防火墙三个配置都是关闭状态**。对外开服可以，但这台机器等于没有入站防护；
  建议至少打开「公用网络」配置，并为 3000 端口放行入站：
  `New-NetFirewallRule -DisplayName "Stronghold 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow`。
- 如果外部玩家连不上而本机自测正常：检查路由器上 3000 → 本机的端口映射是否还在（本机公网 IP 是 8.134.50.56）。
- 改 `server/**`（例如版本策略）仍需要重启服务端才生效；用后台 `/admin` 的「重启」或 `部署公开服务器.cmd`。
- 启动器只负责「起服务 + 打开后台」，公网可达与否和它无关；它坏了也不影响用 `.cmd` 开服。
