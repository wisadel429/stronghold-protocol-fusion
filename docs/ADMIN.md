# 管理后台与资源检测（0.3.3-Fusion）

> 按 `后台-交接.md` 移植的后台，外加一个**服务器资源检测器**（CPU / 内存 / 带宽 / 游戏网站访问量）。
> 后台与游戏**同进程**，挂在游戏主端口的 `/admin` 上；`/api/*` 归游戏自己，后台只占 `/admin/api/*`。

## 〇、从启动器进后台（推荐）

双击 `Stronghold.exe` 后，启动页有**三张卡**：

| 卡片 | 行为 |
|---|---|
| 本地游戏 | 开服并进入游戏画面 |
| **部署公开服务器** | 开服，**不进入游戏画面**，就绪后同一窗口直接打开 `/admin` 后台 |
| 服务器游玩 | 连到别人的服务器 |

「部署公开服务器」的进度会显示在启动页的加载层里（检查服务器 → 启动进程 → 校验素材 → 打开后台）；
就绪后窗口直接变成后台页面，顶部的「← 返回」可以回到启动页。

> 若这台服务器是**改动前**启动的旧进程（没有 `/admin`），启动器会提示「旧服务器没有后台」，关掉它再点一次即可。

## 一、打开与口令

| 项 | 值 |
|---|---|
| 页面 | `http://<服务器地址>:<PORT>/admin` |
| 免口令探活 | `GET /admin/healthz` |
| 口令 | `ADMIN_PASSWORD` 环境变量（不设时用 `server/admin.js` 里的 `DEFAULT_ADMIN_PASSWORD`） |
| 登录方式 | 页面口令框；脚本用 `x-admin-password` 头或 `?password=` |

> 本整合包的默认口令是 **`88888888`**（八个八；`server/admin.js` 的 `DEFAULT_ADMIN_PASSWORD`）。
> **登录页会直接提示这个初始口令**（改掉后提示自动隐藏）；登录后台后还会弹窗提醒修改（弹窗里的「现在去改」直接打开修改口令对话框），面板顶部也会常驻一条红色横幅；口令改掉之前，谁拿到这个整合包都能进后台，只适合内网 / 自己人使用。
> 公网开服请务必换成长口令——改法见下。

**换口令（推荐：后台页面里改）**

登录后台 → 右上角橙色的「修改口令」→ 输入当前口令和新口令（两次）→ 保存。新口令**立即生效**（旧口令马上失效），并保存到安装目录的 `admin-password.json`（scrypt 哈希 + 随机盐，**不是明文**），重启服务器后仍然有效。

**换口令（环境变量，部署时固定）**（Windows CMD）：

```bat
set ADMIN_PASSWORD=换成一串足够长的口令
node server\index.js
```

环境变量设置的口令**优先于** `admin-password.json`；这种情况下后台的「修改口令」会提示口令由环境变量指定、页面里改不了，登录后的初始口令提醒也不会出现（`/admin/api/state` 的 `passwordFromEnv: true`）。

后台只监听主端口。确需另开端口（反代 / 防火墙 / 旧书签）时再设 `ADMIN_PORT`：

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | 不设 = 初始口令 `88888888` | 想固定口令时设置；设置后**优先于**页面里改的 `admin-password.json`（页面里就改不了） |
| `ADMIN_PORT` | `0`（不开） | `5000` 表示另开一个独立端口，`/admin` 在主端口上仍然可用 |
| `ADMIN_HOST` | `0.0.0.0` | 独立端口的绑定地址；只想本机就 `127.0.0.1` |
| `SERVER_NAME` | `server1` | 多服区分，显示在页面头部与 `/healthz` |

## 二、接口契约（与交接文档 §二一致）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin`、`/admin/` | 后台页面（口令门在页面里） |
| GET | `/admin/healthz` | 免口令探活，不含敏感信息 |
| GET | `/admin/api/state` | 完整快照（玩家 / 房间 / 门禁 / 预警 / 公告 / 资源） |
| POST | `/admin/api/notice` | `{text, ttlMin?}` 发/清公告（`text:""` 清除） |
| POST | `/admin/api/gate` | `{open, text?}` 开/关服务器 |
| POST | `/admin/api/warn` | `{seconds, text?, closeOnExpire?}` 闪断预警（`seconds:0` 取消） |
| POST | `/admin/api/kick` | `{playerId}` 踢人（房内→移出；大厅→断开） |
| POST | `/admin/api/close-room` | `{code}` 解散房间 |
| POST | `/admin/api/password` | `{current, next}` 修改口令：立即生效，写入 `admin-password.json`（scrypt）；环境变量指定口令时答 **409** |

- 鉴权：`x-admin-password` 头或 `?password=`；无口令 **401**，连错 **12 次/分钟 → 429**，错误方法 **405**，未知路径 **404**
- 返回：`{ok:true, ...}` 或 `{ok:false, error}`
- 页面与 API 都是 `Cache-Control: no-store`
- 页面需要内联脚本，所以 `/admin*` 使用单独的 CSP（`ADMIN_CSP`，`script-src 'self' 'unsafe-inline'`）；站点其余部分策略不变

## 三、资源检测器（`server/admin-monitor.js`）

结果在 `GET /admin/api/state` 的 `resource` 字段，页面每 2 秒刷新：

```jsonc
{
  "cpu": {
    "systemPct": 12.3,          // 整机占用率（两次 os.cpus() 采样）
    "processPct": 4.1,          // 本进程（单核口径，类似 top 的 %CPU）
    "processPctOfHost": 0.5,    // 本进程占整机
    "cores": 16, "model": "…", "loadavg": [0, 0, 0]   // Windows 的 loadavg 恒为 0，属正常
  },
  "memory": {
    "totalBytes": 0, "freeBytes": 0, "usedBytes": 0, "usedPct": 41.2,
    "process": { "rssBytes": 0, "heapTotalBytes": 0, "heapUsedBytes": 0, "rssPctOfSystem": 1.8 }
  },
  "bandwidth": {
    "windowSec": 2.0,
    "outBytesPerSec": 2048, "inBytesPerSec": 512,   // HTTP 响应体 + WebSocket 线上字节
    "outBytes": 0, "inBytes": 0, "httpRequests": 0,
    "byCategory": { "assets": {…}, "audio": {…}, "code": {…}, "data": {…}, "other": {…} },
    "ws": { "connections": 0, "wireOut": 0, "wireIn": 0, "open": 0, … }
  },
  "site": {
    "pageViews": 3, "todayPageViews": 3, "uniqueVisitors": 2,
    "wsConnections": 5, "wsOpen": 1,
    "onlinePlayers": 1, "roomsOnline": 0, "roomsTotal": 1
  },
  "process": { "pid": 0, "uptimeSec": 0, "node": "v22…", "platform": "win32", "arch": "x64" }
}
```

口径说明：

- **CPU** 是"两次读取之间的整机占用率"，第一次请求还没有基线，可能显示 `–`，下一次刷新就有；页面每次刷新调用一次，没人看后台时**不跑定时器**。
- **内存** 的 `usedPct` 是系统口径（`totalmem - freemem`），进程 RSS 单列在 `memory.process`。
- **带宽** 是**本进程的 HTTP + WebSocket 流量**，来自 `server/http/traffic.js`；不是网卡总量（同机其它程序不计入）。所以页面标的是"本服务流量"。没有流量计数器时该卡片显示"不可用"。
- **访问量** 只数游戏首页 `GET /`（`/index.html` 同页），**不数**后台页面和静态资源；`uniqueVisitors` 是去重后的客户端地址数（本进程内，上限 5000），`wsConnections` 是累计 WebSocket 连接数。
- 所有数字都只存在内存里，进程重启归零，不写盘、不外发。

## 四、关服 / 预警 / 踢人在客户端的样子

| 动作 | 服务端行为 | 客户端行为 |
|---|---|---|
| 关服 | 先广播 `server.closed`，约 0.3 秒后逐个 `close(4004)`；关服期间新连接**升级成功 → 收到 `server.closed` → 4004**，不会收到 `welcome` | 弹窗提示原因，`net.js` 识别 4004 后**停止自动重连**，避免反复撞门 |
| 开服 | `gate.open = true` | 玩家可重新连接 |
| 公告 | 广播 `notice {text, at, until}`，后连入的会话在 `onHello` 补发 | 客户端 toast 显示公告 |
| 闪断预警 | 广播 `server.warn {until, text, closeOnExpire}`；到点按选项关服或只取消 | 客户端 toast 显示预警 |
| 踢人 | 房内：移出房间并 `room.closed`；大厅：`close(4003)` | 房内回到大厅；大厅停止重连并提示 |
| 关房间 | `lobby.disposeRoom(room, 'admin')`，房内玩家收到 `room.closed` | 回到大厅并提示 |

`/admin/healthz` 额外带 `game.playersOnline / rooms / roomsTotal`；`/healthz` 额外带 `serverName`、`open`、`warnSec`、`roomsTotal`、`online{players,rooms,names}`，原有字段不变。

## 五、0.3.3 上游与本树的差异（实现时已按实际能力处理）

- 0.3.3 **没有** `/test` 测试车道：关服时所有人（包括运维）都走同一道门；后台页面是普通 HTTP，不受影响，可随时重开。
- 0.3.3 **没有** `lobby.onlineSummary()`：`playersOnline` 由适配层数 `connected === true` 的会话；`stats.humans` 是房内席位，不能当在线人数。
- 0.3.3 的 `Network.close(code)` 是**整体停机**（会停心跳、标记 closed），不能拿来关服；关服走每个 `Connection` 的 `close(4004)`。
- 0.3.3 **没有**私密房间、`maxSeats`：页面不显示私密徽章，`seats` 对 solo 报 1、对 coop 报 4。
- 房间在线数按"房里至少有一个 `connected` 真人"计算；`roomsTotal` 单独保留，避免断线/空房把房间数虚高。

## 六、验收

```bash
node tools/verify-admin.mjs
```

脚本会真实启动服务（临时端口、不改数据），并用真实 WebSocket 探针检查：

- `/admin` 200、无口令 401、带口令 200 + JSON、`/admin/healthz` 免口令 200
- `/admin` 的 CSP 放行内联脚本
- `resource` 的 CPU / 内存 / 带宽 / 访问量
- 公告、预警帧能到达已连接客户端
- 关服：先收 `server.closed`，再收 **4004**；关服期间新连接同样只收 `server.closed` + **4004**，**没有 welcome**
- 重开后可重新连入；踢人收 **4003**
- `/healthz` 带 `serverName / open / online`

也可以手工验：

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/admin
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/admin/api/state
curl -s -H "x-admin-password: $ADMIN_PASSWORD" http://127.0.0.1:3000/admin/api/state | head -c 300
curl -s http://127.0.0.1:3000/admin/healthz
```

> 交接文档 §七.1 的"必须用非 loopback 地址再验一遍"针对的是 0.3.0 的 loopback 豁免。本树没有 loopback 豁免：
> 关服与重开都走同一套升级后帧 + 4004，局域网地址与 127.0.0.1 行为一致。

## 七、改动的文件

新增：

- `server/admin.js` — 后台本体（口令门 / API / 页面托管）
- `server/admin-live.js` — 本树的适配层（快照、开关服、公告、预警、踢人、关房、广播）
- `server/admin-monitor.js` — 资源检测器
- `server/admin.html` — 单文件后台页面（含"资源检测"卡片）
- `tools/verify-admin.mjs` — 验收脚本
- `docs/ADMIN.md` — 本文

改动：

- `server/index.js` — 创建 `traffic` → `monitor` → `live` → `admin`，挂载 `/admin`，接上关服 gate 与访问量计数，优雅关闭
- `server/http/routes.js` — 在**方法检查之前**路由 `/admin`、为 `/admin` 覆盖 CSP；`/healthz` 增加在线/门禁字段（原字段不变）
- `public/js/net.js` — 识别关闭码 4003 / 4004，停止无意义的重连
- `public/js/main.js` — 显示公告 / 预警 / 关服 / 踢人提示
