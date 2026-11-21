# 卫戍协议：盟约 · 融合版 —— 运维交接文档

> **本文件是主文档，后续改动都记在这里。**（旧的 `HANDOFF-STRONGHOLD-2026-11-14.md` 是历史记录，保留不动）
> 最后更新：2026-11-15
> 维护方式：和 AI 对话时说「改交接文档」，直接改这一份。

---

## 0.5 当前状态快照（新对话从这里接手）

> 2026-11-15 收工状态。**改代码前先读这一节**，别凭记忆改。

### 已经完成并上线的

| 模块 | 状态 |
|---|---|
| 美术资源加密（10,207 文件 / 1.2 GB → `SPLOCK1`） | 本地验证通过；**浏览器实测**立绘 180×180、Spine 216×216、界面图 432×828 全部正常（7–9 ms） |
| 密钥下发 `/api/art-key` + 首次启动领取 | **全链路实测通过**（删密钥 → 启动 → 自动领回，密钥一致） |
| 未获取密钥的前端提示条 | **CDP 实测通过**（missing 时出现、ok 时消失） |
| 后台每 30 秒重试领取（最多 20 次） | 已写，未单独实测 |
| 注册限流（10/小时 + 失败 5 次锁 1 分钟 + 60 次尝试上限） | 探针 8/8 + 远程实测 |
| 打包纯净度自查 `check-package.mjs` | 三个包都跑过，RESULT 通过 |
| 交接文档加密 | 明文 28 KB 不含口令，密文含口令 |

### 只在本地、**远程服务器还没有**的

远程最后一次部署是 `build 79ee9a00cf3d`，之后本地又改了这些，**尚未同步到远程**：

```
server/http/routes.js          （/healthz 增加 artKey 字段）
server/index.js                （artKeyStatus + 后台重试定时器）
public/js/main.js              （接入 updateArtKeyNotice）
public/js/ui/artKeyNotice.js   （新文件）
```

> 用户已主动关服去下载包体。**等他服务器起来后再同步**（用 `tools/zip-append.mjs` 生成小包上传，
> 结构必须带 `Stronghold-Protocol-v0.3.3-Fusion/` 顶层目录，否则会被 strip 掉 —— 见 9 节排障表）。

### 待办

1. **远程同步上面 4 个文件** → 重启 → 验证 `/healthz.artKey`
2. 远程的资源目前仍是**明文**（1.2 GB 加密版没上传）。分发包已加密，这是主防线；远程要不要传由业主决定
3. 剩下 5 个垃圾文件在包里（`Stronghold.exe.old`、`*.bak-list`、`ui-layout.json.bak`、10-25 旧合并文档），
   不含个人信息，下次重打时加 `--exclude='*.bak*'` 清掉

### 一句话现状

**分发包已加密、密钥改为联网领取、注册限流已生效。远程服务器代码落后 4 个文件，等用户开服后同步。**

### 2026-11-15 傍晚补丁：等待室头像 + 随机 tag（已上线）

| 项 | 内容 |
|---|---|
| 症状 | 同盟 / 独立模拟的**等待室座位卡不加载头像**，只显示昵称首字；名牌上还多一个随机编号 tag |
| 根因 | 默认界面是「可露希尔」，它的 import map 把 `/js/screens/room.js` 指到 `ui-themes/closure/js/screens/room.js`（10-24 的旧分叉，头像用的是 `seatAccount?.avatar`，而该字段早已固定为 `null`）。**只改基线文件，主题页永远看不到** —— 之前连发 4 个 `seat-avatar*.zip` 都没效果就是这个原因。详见 §8 第 8 条 |
| 修复 | 两份主题副本按 `seats[].avatarId + avatarSkin` 取干员立绘；本人座位去掉 `DOCTOR #xxxx`（随机编号），别人座位保留；大厅账号卡登录态不再写「LOCAL · 本机账号」 |
| 顺手修的 | `tools/make-hotfix.mjs` 排除表补 `data/accounts.json` / `data/art-key.json` / `launcher-config.json`（此前会把账号哈希和资源密钥打进包） |
| 验证 | 本地 CDP 三入口（closure / initial / 网页原版）实测：头像 `180×180` 真解码、只有一个 `#tag`、无控制台异常；远程 4 个文件内容已核对 |
| 上线 | `Stronghold-hotfix-2026-11-15-waitroom-client.zip`（86 KB，4 个文件，只含 `public/**`，**不需要重启**）→ `/admin/api/update` 返回 `changed.public=4`、`needsRestart:false` |

> 复现用的临时账号：`data/accounts.json` 里有一条 QQ `10000086` / 昵称「头像探针」（仅本机，业主说留着无所谓）。

### 2026-11-15 晚：热更锁改成独立密钥（已上线）

| 项 | 内容 |
|---|---|
| 改动 | 以前 `x-update-key` ＝ **当前后台口令**；现在是一把**独立密钥**，存在安装根目录 `admin-update-key.json`（scrypt 密文，无明文） |
| 影响面 | 只影响 `/admin/api/update` 与 `/admin/api/restart` 的二次校验；后台登录、页面、其它接口一律不变 |
| 页面 | 「热更」卡片里的输入框文案改成「热更锁（专用密钥，不是后台口令）」 |
| 打包 | `admin-update-key.json` 已加入 `make-hotfix.mjs` 排除表 + `check-package.mjs` 阻断规则 |
| 验证 | 本地隔离实例：后台口令当锁 → 403、错锁 → 403、专用密钥 → 200；线上重启后同样 403 / 403 / 200 |
| 注意 | 线上 `admin build` 由 `58c1dfe14e25` 变为 `d8949697db2a`；**重启会清掉在线房间**（本次已清空） |

#### 当晚追加的两条口径（业主定的）

1. **热更锁放宽**：`x-update-key` 现在**专用锁 或 当前后台口令**都认（`updateLockOk()`）。想收紧回「只认专用锁」，
   把 `server/admin.js` 里那一行 `|| passwordMatches(lock, secret)` 删掉即可。
2. **整包更新用追加，不重打**：业主明确「不用重打」。做法是 `tools/zip-append.mjs --only-file`，
   0.7 秒替换 13 个代码文件，条目数 66,584 不变。

#### 包里的彩蛋账号（业主 2026-11-15）

整包的 `data/accounts.json` **不是空结构**，而是**只留一条账号当彩蛋**：

| 字段 | 值 |
|---|---|
| QQ / 昵称 / tag | `2331528852` / `Mon3tr` / **`3250`** |
| 身份 | **管理员（`admin: true`）保留** |
| 固定 | **不可修改 / 删除 / 封禁 / 撤销管理员 / 重置密码**（见下）；**登录**默认也锁死，线上那台单独放开 |
| 密码 | 已是**不可用占位哈希**：默认口径下登录在验密码之前就被拒（八个八那把口令已作废） |
| 资料 | `avatarId: char_4179_monstr`、`avatarSkin: __e2`、名片 `card_e6d26fa1` variant 1 |

**固定账号的两层实现**（`server/accounts/protected.js`）：

1. 九个写入口统一过 `assertMutable()` → 命中就 403 `E_PROTECTED`（登录 / 建会话 / token 解析 / 改名 / 改资料 /
   设撤管理员 / 封禁 / 解封 / 重置密码）。后台页面把这条显示成「🔒 固定」，三个危险按钮直接不渲染。
2. 启动时 `ensureProtectedAccount()` 按**规范记录**校正并补回 —— 手工改 `data/accounts.json` 删掉它、
   把 `admin` 改 false、塞封禁、换密码哈希，**重启都会改回去**（这就是「不可删除」的兜底）。

**「允许登录」开关**（业主 2026-11-15：本机与分发包锁死，线上保留自己的登录）：

| 写法 | 作用 |
|---|---|
| 安装根目录有 `protected-allow-login.flag` | 允许该账号登录 / 保持会话 |
| 环境变量 `SP_PROTECTED_ALLOW_LOGIN=1` | 同上 |
| 两者都没有（**默认**） | 连登录都锁死，启动时还会作废它的所有会话 |

> 放开登录时，启动校正**不动 `salt`/`hash`、也不清会话**，否则一重启就把业主自己锁在外面。
> 线上当前是**放开**状态（`protected-allow-login.flag` 已随热更上传到安装根目录）；
> 想改回锁死：删掉那个文件 + 重启。⚠️ 删文件前先确认自己还记得密码。

- 其余 5 个账号（含复现用的探针号、其它玩家的 QQ 与密码哈希）**已从包里清除** —— 这是红线，不能带出去。
- 哈希用项目自己的 `hashPassword`（scrypt N=32768/r=8/p=1/keylen=64）生成，已实测：`88888888` 能登录、错密码被拒。
- **本机 `data/accounts.json` 仍是真实的 6 条**，只有包里那份是彩蛋；不要拿本机文件覆盖回头再打包。
- 彩蛋的 `tag` = **`3250`**：**包内**（zip-append 替换）与**本机账号库**都已是 3250（本机改了 `data/accounts.json` 并重启生效，
  备份在 `data/accounts.json.bak-tagchange`）；**线上那条仍是 `#2668`**，要改得走后台账号接口或改远程文件 + 重启。
- ⚠️ 本机后台口令仍是**默认值**（`server/admin.js` 的 `DEFAULT_ADMIN_PASSWORD`，本机没有 `admin-password.json`）。
  本机热更锁是专用锁（`admin-update-key.json`），两者不同，所以本机正是「口令 ≠ 锁」的活例子，建议顺手把本机口令改掉。
- **本机账号库已清成只剩彩蛋这一条**（业主 2026-11-15）：删掉了另外 5 条（好友A×2 / 好友B / 博士 / 复现用探针号），
  并同步清理了 `account-sessions.json`（6→1）、`saves.json`（3→1）、`social.json`（好友关系清空）里的悬空引用。
  备份留在 `data/*.bak-prune-<时间戳>`（`.bak` 已被出包工具排除）。
- ⚠️ 本机这条的密码是**原来的真实密码**，而包里那份是八个八 —— 两边不一致。要统一就再生成一次哈希。
- 包内 `data/art-key.json` 仍是空密钥（首次启动向主服领取），未受影响。
- ⚠️ **每改一次包，`.sha256` 必须重算**（`Get-FileHash` / `certutil -hashfile`），否则校验对不上。

---

## 0. 一分钟速查
| 项 | 值 |
|---|---|
| **线上服务器** | **http://8.134.50.56:3000** |
| **管理后台** | **http://8.134.50.56:3000/admin** |
| 后台口令 | **不记录在任何文件里**，由业主另行保管 |
| 服务器列表（主） | http://121.4.51.247/ |
| 本机安装目录 | `E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion` |
| 启动方式 | **手动双击 `Stronghold.exe`**（没有守护进程/服务） |
| 发新版 | 重打整包 → 发 `Stronghold-CLIENT-<日期>.zip`（**不做热更**，见 4.2） |
| 更新上线 | 后台「热更」卡片上传 → **填热更锁** → 点「重启服务器」→ 自动就绪 |

> **本文件不含口令，也不写任何密钥 / 解密方式**（业主 2026-11-15 要求）。
> 需要凭据时找业主当面取，口头或私聊，不要落到文件里。
> 注意：本文件与任何交接文档都保持「无凭据」状态；凭据一律不入文件。

---

## 1. 部署形态（重要：决定了运维方式）

服务器是 **Windows 机器 + 手动运行**，不是 Linux 服务，也没有 NSSM / 计划任务之类的守护进程：

- 用户**双击 `Stronghold.exe`**（启动器，146 KB）→ 启动器再拉起 `node\node.exe server/index.js`
- 关掉启动器窗口 ≠ 服务器停止（子进程 `node.exe` 可能残留），需要用任务管理器确认
- **因为手动开，所以不能做「点一下就退出」的重启按钮** —— 退了没人拉起来。改用第 4 节的「自重启」。

> 启动器的控制台日志在 `C:\Users\<用户名>\AppData\Roaming\StrongholdProtocol\client.log`
> 服务器自身的重启日志在安装目录的 `.cache\restart.log`

---

## 2. 目录与环境

| 路径 | 说明 |
|---|---|
| `E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion` | 本机游戏安装目录（开发/打包都在这里） |
| `…\node\node.exe` | 随包自带的 Node 运行时，**不要**用系统 node |
| `…\server\index.js` | 服务器入口 |
| `…\public\` | 前端（页面、脚本、素材） |
| `…\data\` | 游戏数据；`saves.json` / `feedback.json` 等运行数据也在这里 |
| `…\.cache\` | 缓存与临时文件（可删，会自动重建） |
| `…\launcher-config.json` | 启动器配置（列表地址、服务器地址） |

远程服务器的路径（从重启日志看到）：`C:\Users\Administrator\Downloads\Stronghold-Protocol-v0.3.3-Fusion`

---

## 3. 健康检查与状态判读

```powershell
# 最常用：一条命令看全部状态
(Invoke-WebRequest -UseBasicParsing 'http://8.134.50.56:3000/healthz').Content | ConvertFrom-Json |
  Select-Object ok,version,protocol,build,uptimeSec,online,rooms,matches
```

`/healthz` 字段含义（2026-11-14 起）：

| 字段 | 含义 | 正常值 |
|---|---|---|
| `ok` | 服务在线 | `true` |
| `version` | **游戏版本号**（以前这里是协议号，已修） | `0.3.3-Yuan` |
| `protocol` | 协议版本 | `1` |
| `build` | 当前进程所服务前端代码的指纹，**每次热更+重启都会变** | 12 位十六进制 |
| `uptimeSec` | 进程已运行秒数（判断「到底重启了没」） | 变化即重启过 |
| `online` / `rooms` / `matches` | 在线连接 / 房间 / 对局 | 视情况 |

其它接口：

| 接口 | 用途 | 正常返回 |
|---|---|---|
| `GET /api/ping` | 服务器列表探针 | 开服 `200 {"ok":true}`；**关服 `503`** |
| `GET /api/rooms` | 房间目录（列表站读这个） | `200 {"ok":true,"count":N,"rooms":[…]}` |
| `GET /api/announcement` | 公告 | `200` |
| `POST /api/feedback` | 玩家反馈提交 | `200 {"ok":true,"id":"fb_…"}` |

跨域：`/healthz`、`/api/ping`、`/api/rooms`、`/api/feedback` 都带 `Access-Control-Allow-Origin: *`，第三方列表站才能读到。

---

## 4. 热更新完整流程（核心章节）

### 4.1 三种上线入口

| 方式 | 适用 | 是否需要手动去服务器 |
|---|---|---|
| **A. 后台网页**（推荐） | 远程更新，任意机器操作 | 不需要 |
| **B. 启动器「导入热更包」** | 本机/玩家自己更新 | 需要本地服务器先启动 |
| **C. 命令行** | 批量/自动化 | 不需要 |

三种方式都是「把 zip 解压覆盖到安装目录」，区别只在谁执行。

### 4.2 第一步：打热更包（在开发机上）

> **业主 2026-11-15 决定：不做热更，改版直接发完整包。**
>
> 原因是美术资源加密一次改动就是 **1 万个文件 / 1.2 GB**，热更包根本承载不了
> （`make-hotfix` 会在变化文件超过 ~2.8 万个字符时直接拒绝，这是保护机制）。
>
> 所以后续发版的默认做法：
> - **改版** → 重打整包 → 发 `Stronghold-CLIENT-<日期>.zip`（玩家重下）
> - 下面这套热更流程**保留但基本不用**，只在纯 JS/CSS 小修补时才有意义

```powershell
cd E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion
.\node\node.exe tools\make-hotfix.mjs --base '..\Stronghold-Protocol-v0.3.3-Fusion_2026-11-14.zip'
```

- 基线 `--base` **必须是发给玩家的那个整包 zip**，不是上一次的热更包
- 输出：`E:\stronghold\Stronghold-hotfix-<日期>.zip`（通常几十 ~ 一两百 KB）
- 它只打包「变化过的文件」，并自动排除：`.cache`、`merge-shots`、`*.log`、`data/saves.json`、`data/account-sessions.json`、`data/social.json`、`data/feedback.json`、**`data/art-key.json`**、`tools/`、**`Stronghold.exe*`**、**`*.cmd`**
  - exe 不能热更：Windows 上运行中的 exe 无法覆盖，会失败
  - 中文文件名（如 `应用新启动器.cmd`）会让远程把整包判成坏包（远程用 tar 按 GBK 解析文件名）
  - 密钥不进热更：玩家本地已经领过，覆盖会把他打回"没有密钥"的状态

### 4.3 第二步：上传（A. 后台网页）

1. 打开 **http://8.134.50.56:3000/admin**，输入口令
2. 找「**热更 / HOT UPDATE**」卡片
3. 选择 zip → 「上传并应用」
4. 看返回：会显示文件数、分类统计（`public` / `data` / `shared` / `server` / `other`）、新 `build`

分类含义（决定要不要重启）：

| 变化的目录 | 是否立刻生效 |
|---|---|
| `public/**`、`data/**` | **立刻生效**，玩家刷新页面就拿到 |
| `server/**` | **必须重启**才生效（运行中的 Node 不会重新加载） |
| `shared/**` | 浏览器立刻拿到、服务端还是旧的 → **两边可能不一致，尽快重启** |

> **包的顶层目录会被剥掉一层（2026-11-15 踩过）**：`/admin/api/update` 返回里的 `strip:1` 就是这个动作。
>
> - `make-hotfix.mjs` 出的包有 `public/`、`server/`、`data/` 等**多个**顶层目录 → 不会被剥，正常。
> - **只含 `public/**` 一个顶层目录的小包会被当成「包裹目录」剥掉**：文件落到安装根目录（`<安装目录>/js/screens/room.js`），
>   返回里 `changed` 显示成 `{"other":N}`，**线上一点没变**，很容易误判成"上传成功"。
> - 手工打小包时必须包一层 `Stronghold-Protocol-v0.3.3-Fusion/`，剥完正好是 `public/...`。
> - **判据**：上传后先看返回的 `changed` 里是不是 `public`；再 `GET` 一次线上那个文件、核对里面的新代码。
> - 那次剥错在远程安装根目录留下 4 个无用文件（`js/screens/room.js`、`js/ui/accounts.js`、`ui-themes/closure/js/screens/room.js`、
>   `ui-themes/initial/js/screens/room.js`），它们不在 `public/` 下、不会被访问到，**可以删**。

### 4.4 第二步（命令行等价写法）

> **热更锁（业主 2026-11-15，晚间改为独立密钥）**：`/admin/api/update` 和 `/admin/api/restart` 除了后台口令，
> 还必须带 `x-update-key`。不带 / 带错一律 **403 LOCK**。防的是有人趁后台页面开着直接调接口改服务器文件。
>
> | 项 | 值 |
> |---|---|
> | 锁是什么 | **一把独立密钥，与后台口令完全解耦**（改后台口令不会改锁；口令泄露也不等于锁泄露） |
> | 存在哪 | 安装根目录 `admin-update-key.json`，内容是 `scrypt(密钥, salt, 64)` —— **只有 salt + hash，没有明文** |
> | 找不到文件 | `server/admin.js` 里的 `DEFAULT_UPDATE_KEY`（同样是密文）会把它重建出来 —— 删掉不会把锁弄丢 |
> | 换锁 | 改 `admin-update-key.json`（或删掉让它按内置密文重建），**重启后生效**；页面上的「修改口令」不影响它 |
> | 校验顺序 | 先 `x-admin-password`（错 → **401**），再 `x-update-key`（错 → **403**） |
>
> ⚠️ 目前**后台口令和热更锁是同一个字符串**，所以「只有我能用」这一点还没真正兑现：
> 拿到后台口令的人同时也就拿到了锁。建议**把后台口令改成另一个值**（后台页面可以改），锁保持不动，
> 这样两把钥匙才互不牵连。锁的明文只在业主人这里，不进任何文件（本文件同样不记）。
>
> 打包安全：`admin-update-key.json` 与 `admin-password.json` 同级对待 ——
> `make-hotfix.mjs` 已排除、`check-package.mjs` 已列进「阻断」规则。
>
> 手工调用示例（两把钥匙都要带）：
>
> ```powershell
> $H = @{ 'x-admin-password' = $pw; 'x-update-key' = $lock }   # 锁 != 口令时不能两处都填 $pw
> ```

```powershell
$base = 'http://8.134.50.56:3000'
$pw = '<后台口令>'
$H = @{ 'x-admin-password' = $pw; 'x-update-key' = $pw }
Invoke-WebRequest -UseBasicParsing "$base/admin/api/update" -Method POST `
  -Headers $H -ContentType 'application/octet-stream' `
  -InFile 'E:\stronghold\Stronghold-hotfix-2026-11-14.zip' -TimeoutSec 180
```

返回示例：

```json
{"ok":true,"kind":"patch","files":17,"changed":{"public":1,"data":1,"server":10,"other":5},
 "needsRestart":true,"warnings":["server/ 有 10 个文件：…"],"build":null}
```

### 4.5 第三步：重启（关键）

如果包里有 `server/**`，**必须重启**，否则等于没更新。

**推荐：后台「重启服务器」按钮**（自重启，不需要你上服务器）

```powershell
# 命令行等价
Invoke-WebRequest -UseBasicParsing "$base/admin/api/restart" -Method POST `
  -Headers $H -ContentType 'application/json' -Body '{}' -TimeoutSec 120
```

机制（已实测可用）：

1. 先对 `server/`、`shared/` **最近 15 分钟内改过**的文件跑 `node --check` 语法自检
2. **自检不通过就拒绝重启**（返回 409，服务不受影响）—— 避免把服务重启成起不来
3. 通过 → 拉起一个 detached 中继 → 中继等约 1.8 秒（让旧进程放掉 3000）→ spawn 新进程 → 旧进程退出
4. **新进程与启动器无关**：启动器窗口显示「已停止」也不影响服务

**兜底**：万一新进程起不来，用任务管理器结束残留 `node.exe`，再双击 `Stronghold.exe` 即可（文件都在磁盘上）。

> 拒绝重启时返回里会列出语法错误的文件，先修好再重试。

### 4.6 第四步：验证（必做）

```powershell
$j = (Invoke-WebRequest -UseBasicParsing 'http://8.134.50.56:3000/healthz').Content | ConvertFrom-Json
$j | Select-Object version,protocol,build,uptimeSec   # uptimeSec 应该是几秒内 → 证明真重启了
```

三项一起对上才算成功：

1. `uptimeSec` 很小（几秒 ~ 几十秒）= 确实重启了
2. `build` 变了 = 前端代码换了
3. `version` 是 `0.3.3-Yuan`（不是 `1`）

### 4.7 往整包追加文件（不重打 2.5 GB）

出包之后还想把改动塞进**已经存在的整包 zip**，用这个（1 秒完成，不读 2.5 GB 数据）：

```powershell
cd E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion
.\node\node.exe tools\zip-append.mjs --zip <目标.zip> --root '.' --prefix 'Stronghold-Protocol-v0.3.3-Fusion' --only 'a.js,b.css,c.exe'
```

原理：把新文件数据写到「旧中央目录」的位置，再重写一份中央目录 + 结尾记录。已有文件的数据**一个字节都不动**。

- **同名文件会被替换**：旧中央目录里同名的那条被剔除（旧数据成为孤儿，不影响解压，只浪费几十 KB），解压拿到的必然是新版，**不会出现重复条目**
- 支持 Zip64（本项目整包就是）
- 一定要用 `--only` 精确白名单：自动比对模式会被中文名文件（GBK 编码）误判成「新增」，把 120 MB 的 BGM 再塞一遍
- 追加前建议保留原包（复制一份或改个名）
- 实测：2.5 GB / 6.6 万条目的包，追加 25 个文件 **0.7 秒**

---

## 5. 启动器（Stronghold.exe）

### 5.1 现状

- `Stronghold.exe`（146 KB）**已经打过补丁**：内部硬编码的服务器列表地址已从 `https://wei.jiangjiangze.icu/` 换成 `http://121.4.51.247/`
- 备份：`Stronghold.exe.old`（原件）、`Stronghold.exe.bak-list`（打补丁前的副本）
- 确认方式：搜索 exe 里的字符串，应能搜到 `121.4.51.247`、搜不到 `wei.jiangjiangze.icu`

### 5.2 启动器的两个功能（2026-11-14 新增）

| 功能 | 位置 | 说明 |
|---|---|---|
| **问题反馈** | 启动页底部 | 写描述 → 「提交到服务器」直接进后台；也可「复制反馈内容」发群里；自动带版本/build/分辨率 |
| **导入热更包** | 启动页底部 | 选 zip 自动覆盖到安装目录（**需要先启动本地服务器**，解压是本地服务器干的） |

### 5.3 换 exe（只有这一步必须手动）

Windows 上运行中的 exe 无法替换，所以：

1. 关掉启动器（窗口 + 托盘图标）
2. 任务管理器确认没有 `Stronghold.exe` / 残留 `node.exe`
3. 把新的 `Stronghold.exe` 覆盖进去（或运行 `应用新启动器.cmd`）
4. 重新双击

---

## 6. 服务器列表与资源

| 项 | 值 |
|---|---|
| 主列表 | http://121.4.51.247/ （`标题：卫戍协议：盟约 · 服务器列表`） |
| 旧列表 | `https://wei.jiangjiangze.icu/`（**已不再读取**） |
| 列表配置 | 安装目录 `launcher-config.json`：`list` / `listBackup` 都指向 121.4.51.247，`listBackup2` 置空 |

列表站是**跨域**读 `/healthz` 和 `/api/rooms` 的，所以这两个接口必须带 CORS 头（已修）。

若列表仍显示离线，先自查：

```powershell
(Invoke-WebRequest -UseBasicParsing 'http://8.134.50.56:3000/healthz').Headers['Access-Control-Allow-Origin']  # 应为 *
(Invoke-WebRequest -UseBasicParsing 'http://8.134.50.56:3000/api/rooms').Content                                 # 应为 {"ok":true,...}
```

---

## 7. 本次会话改动清单（2026-11-14 ~ 11-15）

> 「已验证」= 在本机或 8.134.50.56 上实际跑过、看过结果。

| # | 改动 | 状态 |
|---|---|---|
| 1 | 结算页头像：每个玩家显示**自己**的账号干员立绘（原服务端不带头像字段，只有本人有） | 已验证 |
| 2 | 结算「同盟」卡尺寸修复（`traitOverlay.css` 的 `.tcard*` 类名撞车，把结算卡压成 232×330） | 已验证 |
| 3 | 右下角水印 `SERVER-1` | 已验证 |
| 4 | 服务端 build 标记可在**不重启**时重算（`resetBuildTag`） | 已验证 |
| 5 | 后台「热更」卡片 + `/admin/api/update` | 已验证（生产用过） |
| 6 | 后台「重启服务器」+ `/admin/api/restart`（语法自检 + 中继自重启） | 已验证（生产用过两次） |
| 7 | `/healthz`：`version` 改为版本号、新增 `protocol`、补 CORS | 已验证 |
| 8 | `/api/ping` 补路由；关服时返回 503；`/healthz` 带 `closed` | 已验证 |
| 9 | 挂载 `publicApi`（原来完全没接线）：`/api/rooms`、`/api/announcement` | 已验证 |
| 10 | 后台：管理员**金色 ★ 昵称 + 置顶**；改口令后不再误提示「未修改」 | 已验证 |
| 11 | 玩家反馈：`POST /api/feedback` → 后台「问题反馈」卡片（可看诊断、可删、限流） | 已验证（生产） |
| 12 | 启动器「问题反馈」「导入热更包」两个面板 | 已验证 |
| 13 | `?server=<地址:端口>`：页面从本地包加载、只把 WebSocket 指向远程（省服务器带宽） | 已验证（7 种写法） |
| 14 | 启动器 exe 内嵌列表地址改为 121.4.51.247 | 已验证 |
| 15 | `tools/make-hotfix.mjs`（增量出包，秒级） | 已验证 |
| 16 | 后台 `adminList()` 补 `admin` 字段（之前不返回 → 界面永远显示「设为管理员」、名字不变金、置顶不生效） | 已验证（线上 Mon3tr 已正确返回 `admin:true`） |
| 17 | 游戏内顶栏账号卡：管理员显示**金色昵称 + 金星标**（`currentAccount()` 补 `admin`） | 待看效果 |
| 18 | **独立模拟（小模式）禁用难度切换**（点击会触发严重 bug） | 待看效果 |
| 19 | 大厅顶栏「N 名博士在线」不再被账号卡压住（原为 flex 收缩 + 文字溢出） | 待看效果 |
| 20 | `tools/zip-append.mjs`：**往整包追加文件不重打**（2.5 GB 包 1 秒完成） | 已验证 |
| 21 | **「补齐房间」按钮**：房间内黄绿色大按钮旁的小黄按钮；点后房间进匹配队列，**人数一多立刻开局**（座位顺序不变），60 秒没人来则取消并弹「补齐失败」；期间「开始模拟」变灰显示倒计时、该按钮变「取消补齐」 | 已验证（探针 12/12：立即开局 / 座位 0→1 不变 / fill-failed） |
| 22 | **「匹配成功 · 确认入场」覆盖层**：仿官方 PUBLIC MATCHMAKING，背景复用素材 `autochess_matching_success.png`，四格座位卡、倒计时 29 秒、确认入场；**确认过的卡片边框变绿**；全员确认后房主自动开局 | 代码已上线，**视觉待确认** |
| 23 | **默认界面改为「可露希尔」**（`ui-theme-gate.js`）：没选过主题的访客自动进 closure；明确选过「网页原版」的不受影响 | 待看效果 |
| 24 | `room.state` 现在会带 `matching: {startedAt, deadlineAt, humansAtStart}`（之前只存服务端内存，前端读不到，倒计时无从显示） | 已验证 |
| 25 | **美术资源加密**（`server/http/artLock.js`）：10,207 个文件 / 1.2 GB 落盘加密成 `SPLOCK1` 密文，服务端透明解密，前端零改动。范围见 8.2 | 已验证（HTTP 200 + 正确 PNG 魔数） |
| 26 | **重打整包**：清掉「追加替换」留下的孤儿数据（3.07 GB → **2.76 GB**），排除 `.cache`/`*.log`/`merge-shots`/备份/运行数据 | 已完成（11.6 分钟） |
| 27 | **注册限流**：单 IP 每小时最多 10 个**成功**注册（原为 3）；失败不占名额；连续失败 5 次锁 1 分钟；尝试上限 60/小时 | 已验证（探针 8/8 + 远程实测） |
| 28 | **资源密钥下发**：分发包不含密钥，首次启动向 8.134.50.56/api/art-key 领取（限流 5 次/IP/小时），失败重试 3 次且不阻断启动 | 已验证（删密钥后自动领回，资源正常） |
| 29 | **拆成两个包**：SERVER（含密钥，只给自己）/ CLIENT（空密钥，给玩家） | 已完成 |
| 30 | **等待室座位卡不加载头像**（根因是主题分叉）：`ui-theme-closure.html` / `ui-theme-initial.html` 的 import map 把 `/js/screens/room.js` 指向 `ui-themes/*/js/screens/room.js`（10-24 的旧副本；那份里头像写的是 `seatAccount?.avatar`，而 `accounts.js` 早已把该字段固定为 `null`）。两份主题副本已改成按 `seats[].avatarId + avatarSkin` 取干员立绘 | 已验证（CDP 三入口实测：180×180 真解码） |
| 31 | **去掉随机编号 tag**：座位名牌原来同时排账号 `#tag` 和 `DOCTOR #xxxx`（`doctorNo(playerId)` ＝ 随机会话 id 的哈希，每次连接都变）。现在本人座位只留账号 tag，别人座位保留 `DOCTOR #`（服务端不下发他人 tag，那是唯一标识） | 已验证 |
| 32 | 大厅账号卡：登录状态下不再显示「LOCAL · 本机账号」，改显示「账号」 | 已验证 |
| 33 | `tools/make-hotfix.mjs` 排除表补上 `data/accounts.json` / `data/art-key.json` / `launcher-config.json`（**此前会把玩家账号哈希和资源密钥打进热更包**） | 已验证 |
| 34 | **热更锁改成独立密钥**（`server/admin.js`）：`/admin/api/update`、`/admin/api/restart` 的 `x-update-key` 不再等于后台口令，而是 `admin-update-key.json` 里的 scrypt 密文（源码只留同一份密文作兜底重建）。改后台口令不再影响锁 | 已验证（本地隔离实测：后台口令当锁 → 403；专用密钥 → 200；线上 403/403/200 三连） |
| 35 | **固定账号**（新增 `server/accounts/protected.js`）：QQ `2331528852` 那条不可修改 / 删除 / 封禁 / 登录 / 撤销管理员 / 重置密码。两层实现：① 9 个写入口统一 `assertMutable()` 抛 403 `E_PROTECTED`；② 启动时 `ensureProtectedAccount()` 按规范记录校正并补回（删掉也会回来），顺带作废它的会话 | 已验证（隔离库 26 项断言全过；本机真实接口：封禁/解封/重置密码/撤销管理员/登录 全 403） |

---

## 8. 已知注意事项 / 坑

1. **热更不要包含 `Stronghold.exe`**：运行中无法覆盖；出包工具已自动排除。
2. **热更不要包含中文文件名**（尤其 `*.cmd`）：远程解析 zip 列表按 GBK 走，会整包判坏 → 400。出包工具已排除 `*.cmd`。
3. **`server/**` 改动不重启 = 没生效**。`build` 变了但 `uptimeSec` 没归零，就是这个情况。
4. **启动器关窗后 `node.exe` 可能残留**，会占着 3000 端口，导致「重启了但没生效」。
5. **后台口令不要用默认 `88888888`**（线上已改）。
6. `data/saves.json`、`data/account-sessions.json` 是运行数据，出包时已排除，**不要覆盖线上**。
7. 语法自检只查「最近 15 分钟改过的文件」+ `server/index.js`，不是全量（全量要 20 多秒）。
8. **改 `public/js/**` 在主题页可能完全不生效**（2026-11-15 踩过，代价是 4 个白发的热更包）：
   `ui-theme-closure.html` 和 `ui-theme-initial.html` 各有一张 import map，把一批模块（`screens/room.js`、`screens/lobby.js`、
   `ui/components.js`、`ui/hud.js` 等 78 条）指到 `public/ui-themes/<theme>/js/**` 的**副本**上。
   默认界面就是「可露希尔」（见 §7 第 23 项），所以只改基线 `public/js/**` 时**玩家侧看不到任何变化**。
   改这些模块时要么**同时改主题副本**，要么先把 import map 里那一条映射删掉（让主题页直接用基线模块）。
   判断方法：浏览器 F12 → Network 里看实际加载的是 `/js/screens/xxx.js` 还是 `/ui-themes/xxx/js/screens/xxx.js`。

### 8.1 打包红线：**导出物必须纯净**（业主 2026-11-15 明确要求）

> **凡是要发出去的压缩包（整包 / 热更包 / 任何 zip），都必须是纯净的：不得包含任何可能泄露个人信息的文件。**

绝不进包的东西（出包工具 `make-hotfix.mjs` 已自动排除，但**整包和手工打包时必须自己确认**）：

| 文件 | 泄露什么 |
|---|---|
| `admin-password.json` | 后台口令（scrypt 哈希） |
| `admin-update-key.json` | **热更锁**（scrypt 哈希）—— 与后台口令同级，泄露等于把热更/重启接口送人 |
| `data/account-sessions.json` | 登录会话 token + 账号 ID |
| `data/saves.json` | 玩家存档、战绩记录 |
| `data/social.json` | 好友关系、拉黑名单 |
| `data/feedback.json` | 玩家反馈正文 + 提交者 IP |
| `HANDOFF-STRONGHOLD.md` 等交接文档 | **含明文口令**，只放 `E:\stronghold\` 根目录 |
| `*.log` / `*.env` / `*password*` / `*secret*` | 日志、环境变量、凭据 |
| `Stronghold.exe*` / `*.cmd` / `*.bak` | 二进制与备份（且会让远程判包失败） |

**出包后必须自查**（一条命令，5 秒）：

```powershell
cd E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion
.\node\node.exe tools\check-package.mjs '..\<你的包>.zip' '<后台口令>'
```

它检查三件事，任何一条不过就 **退出码 1**：

| 检查 | 内容 |
|---|---|
| 文件名 | 凭据 / `.env` / `admin-password.json` / 日志 / `.bak` / 交接文档 / `Stronghold.exe.bak*` |
| 运行数据 | `data/saves.json`、`data/account-sessions.json`、`data/social.json`、`data/feedback.json` 必须是**空结构** |
| 内容 | 把包里所有文本文件解开，搜命令行给的口令字符串，**0 命中**才算过 |

实测输出示例（2026-11-15 整包）：

```
条目 66583 个；文本扫描 17681 个（530.8 MB）
口令检查：suz***
RESULT 不通过，12 处：
  ✗ [文件名] Stronghold.exe.bak2 —— 备份文件
  …
```

> 那次 12 处全是**备份垃圾文件**（旧 exe 副本 + 一个 ui-layout 备份），不含个人信息；
> 口令 0 命中。整包用 `tar` 重打时记得加 `--exclude='*.bak*'`，这些垃圾就不会再进包。
>
> 2026-11-15 还实测过：整包曾带出 `account-sessions.json`（会话哈希）和 `saves.json`（67 KB 玩家存档），
> 已用「追加替换成空结构」清掉（不重打 2.5 GB）。**每次发版前都要重跑这条命令。**

### 8.2 美术资源加密（业主 2026-11-15）

**目的**：让从安装包里直接拷走的立绘/骨架是**打不开的密文**，避免资源被二次分发。不追求绝对防破解。

**机制**（服务端透明解密，前端零改动）：

```
浏览器 → /assets/char/xxx.png
       → serveStatic 先过 artLock.handle()
       → 文件头是 SPLOCK1 ? 解密 : 原样返回
```

| 项 | 说明 |
|---|---|
| 加密格式 | `SPLOCK1`(7) + iv(12) + authTag(16) + 密文，AES-256-GCM |
| 密钥 | `data/art-key.json`（首次加密时自动生成，**随包分发**——本地跑游戏必须有它） |
| 覆盖范围 | `assets/char`、`spine`、`skins`、`namecard`、`ui`、`skill`、`enemy`、`relics`、`band`、`bond`、`item`、`token`、`annihilation-intro`、`ui-art/img`、`ui-art/fonts-ark` |
| **不加密** | `assets/audio`（音频要支持 Range 拖动，加密会破坏字节偏移）、`assets/local`（2.8 万个特效小文件，解密开销大且不是美术资产） |
| 增量 | 已加密的文件（有 SPLOCK1 头）自动跳过，可以反复跑 |
| 回滚 | `tools/encrypt-art.mjs --decrypt` |

**改资源之后的流程**：

```powershell
# 新增/替换了美术资源后，重新加密对应的目录
.\node\node.exe tools/encrypt-art.mjs --dirs char,spine
```

**排查**：图片破图先看响应头有没有 `X-Art-Lock: 1`。
- 有 → 解密成功，问题在别处
- 没有 → 该文件没加密（正常）或路径不在 artLock 的前缀列表里
- 500 + `art decrypt failed` → 密钥和密文不匹配（换过 `data/art-key.json`？）

> 换密钥会让**所有已加密资源永久解不开**，除非先 `--decrypt`。

**密钥下发机制（业主 2026-11-15）**：

分发包里**不含**资源密钥。玩家首次启动时，本地服务端自动向主服务器领取：

```
玩家双击 Stronghold.exe
  → 本地服务端启动
  → data/art-key.json 没有有效 key
  → GET http://8.134.50.56:3000/api/art-key   （限流 5 次/IP/小时）
  → 写入 data/art-key.json，之后不再请求
  → artLock 启用，资源正常解密
```

代码在 `server/artKeyFetch.js`（`ensureArtKey`，启动时调用，失败重试 3 次，间隔递增）。
**领不到不阻断启动**，只会破图；联网后重开一次即可。

**两个包的区别**（只差 `data/art-key.json` 一个文件）：

| 包 | 密钥 | 给谁 |
|---|---|---|
| `Stronghold-CLIENT-2026-11-15.zip`（2.69 GB） | 空（首次启动领取） | **所有人：玩家 + 服务器** |
| `Stronghold-服务器密钥（只有1个文件）.zip`（**312 字节**） | 有 | 只放到**你自己的服务器** |

> **不需要单独的 2.69 GB「服务器包」** —— 那只是 CLIENT 包 + 这 312 字节的密钥文件。
> 部署服务器的顺序：先解压 CLIENT 包，再解压密钥包覆盖，就得到「服务器版」。
>
> 服务器**必须**有密钥：否则它既不能给玩家下发，也解不开自己磁盘上的加密资源（远程玩家会全破图）。
> ⚠️ 密钥包**别发给玩家**；`tools/check-package.mjs` 会对它报警告。

**未获取密钥时玩家看到什么**（业主 2026-11-15）：

前端在 `public/js/ui/artKeyNotice.js`，挂在 buildGuard 的 `onHealth` 上，读 `/healthz.artKey`：

- `missing` → 页面顶部弹一条黄色提示：**「资源密钥未获取，部分图片显示不出来」** + 说明 + 「重试」按钮
- `ok` → 提示自动消失
- 服务端还会**每 30 秒自动重试领取**（最多 20 次 / 10 分钟），网络恢复后不用重启游戏

> 实测：用不可达地址启动 → `artKey=missing` → 浏览器里提示条正确出现（CDP 验证）；改成可达地址重启 → 自动领到 → 提示消失。

**远程服务器现状（2026-11-15）**：

- 代码与密钥（`artLock.js` / `static.js` / `data/art-key.json`）**已同步**，artLock 处于「启用」状态
- 但远程的 1.2 GB 加密资源**还没上传**，所以那些文件仍是明文 → artLock 检测不到 `SPLOCK1` 头 → 走原流程，功能正常
- 要让远程也真正加密，需要分批上传（单次上限 512 MB，1.2 GB 约 3 批）
- 分发包（`_2026-11-15.zip`）**已完整加密**，这是二次分发的主要防线

> 浏览器实测（Edge headless + CDP）：角色立绘 180×180、Spine 贴图 216×216、界面图 432×828 全部正常加载（7–9 ms），`.atlas` 文本与 `.skel` 二进制内容正确，未加密音频照常播放。

### 8.3 账号注册限流（业主 2026-11-15）

`server/accounts/http.js`，三层规则叠加：

| 规则 | 参数 | 常量 |
|---|---|---|
| 单 IP 每小时最多**成功**注册 | 10 个 | `REGISTER_PER_HOUR` |
| 连续失败 | 5 次 → 锁 1 分钟（成功即清零） | `REGISTER_FAILS_BEFORE_LOCK` / `REGISTER_LOCK_MS` |
| 尝试总量兜底（防枚举 QQ） | 60 次/小时 | `REGISTER_ATTEMPTS_PER_HOUR` |

要点：
- **只有注册成功才占名额**（`wouldAllow()` 只检查、成功后 `hit()` 记账）。填错 QQ/密码不会把人锁一小时。
- 第 5 次失败那一下**直接返回 429 `E_LOCKED`**，文案带剩余秒数，而不是再报一次参数错误。
- 锁定状态在内存里（`registerFails` Map），**重启服务器会清空** —— 这是有意的，重启后不该继续惩罚用户。

> 注意：本服注册用 **QQ 号**当用户名（5–12 位数字），不是自定义用户名。

### 8.4 与 AI 协作的约定（业主 2026-11-15 明确要求）

> **重活一律放后台，前端保持空闲，否则 AI 这边收不到消息。**

- **压缩 / 复制 / 全盘校验这类长任务**，要用后台任务跑（`run_in_background`），**不要**堵在前台等它跑完。
- 判据：单次超过十几秒、或会吃满一个核 / 大量磁盘 IO 的操作，都算「重活」。
- 已经踩过的例子：
  - 用 PowerShell 对 6.6 万个 zip 条目做 `Group-Object` 查重 → 跑了 10 分钟没结果，必须杀掉换 Node。
  - 2.5 GB 整包复制 → 前台跑 39 秒，期间无法响应。
- **快速替代**：查 zip 用 Node 直接解析中央目录（毫秒级），不要用 PowerShell 的 `ZipFile` 遍历。
- 后台任务要记 id，结束时用 `job_output` 收结果；中途要给用户中途汇报，不能干等。


---

## 9. 排障对照表

| 现象 | 先查什么 |
|---|---|
| 热更上传 400 | 包里有没有中文文件名 / `Stronghold.exe`；重新用 `make-hotfix.mjs` 出包 |
| 上传成功但功能没变 | `healthz.uptimeSec` 有没有归零；没归零就是没重启 |
| 重启后服务起不来 | `.cache/restart.log`；任务管理器结束残留 `node.exe`；双击 `Stronghold.exe` |
| 重启被拒绝（409） | 返回里列了语法错误的文件，修好再重试 |
| 列表站显示离线 | `/healthz` 和 `/api/rooms` 是否 200 + `ACAO: *`；后台是否处于「关闭服务器」状态 |
| 列表显示版本 `1` | 服务器还是旧代码，没重启 |
| 关服后仍显示在线 | 需要 `/api/ping` 返回 503（本版已实现），列表端要认 503 |
| 启动器还是进 wei 站点 | exe 没换成功，或 WebView2 缓存：删 `%APPDATA%\StrongholdProtocol` 再开 |
| 玩家头像只有首字 | 服务端没带 `avatarId`；确认版本 ≥ 本次热更 |

---

## 10. 交付物清单

**当前有效（2026-11-15 收工时）**：

| 文件 | 大小 | 说明 |
|---|---|---|
| `E:\stronghold\Stronghold-CLIENT-2026-11-15.zip` | **2.692 GB** | **唯一整包**：玩家和服务器都用它。2026-11-15 15:54 用 `zip-append` **追加替换**过 13 个代码文件 + `data/accounts.json`（**没重打**，故留有少量孤儿字节）；校验见同名 `.sha256` |
| `E:\stronghold\Stronghold-服务器密钥（只有1个文件）.zip` | **312 字节** | 只放自己的服务器（先解压 CLIENT 再覆盖它 = 服务器版） |
| `E:\stronghold\Stronghold-补丁-未获取密钥提示.zip` | 36 KB | 只含 4 个文件，给「已经下了旧包」的情况补救 |
| `E:\stronghold\Stronghold-hotfix-2026-11-15-waitroom-client.zip` | **86 KB** | 等待室头像 + 随机 tag 修复，4 个文件（`public/**`，不用重启），**已上线** |
| `E:\stronghold\Stronghold-hotfix-2026-11-15-waitroom.zip` | 136 KB | 同一次的**全量代码**热更（11 个文件，含 `server/**`）；如要把远程的服务端也一并对齐，用这个 + 重启 |
| `E:\stronghold\Stronghold-hotfix-2026-11-15-updatelock.zip` | 99 KB | 热更锁改成独立密钥（`server/admin.js` + `server/admin.html`），需重启，**已上线** |
| `E:\stronghold\Stronghold-hotfix-2026-11-15-locktest-noop.zip` | 0.9 KB | **无作用包**：只往安装根目录写一个说明文本，专用来验证热更锁的 403 / 200 |
| `E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion_2026-11-14.zip` | 2.44 GB | 旧版，回滚用 |
| `E:\stronghold\_art-key-备份.json` | — | **资源密钥备份，务必留着**（丢了加密资源全废） |

**工具（都在 `…\tools\`，不进分发包）**：

| 文件 | 用途 |
|---|---|
| `make-hotfix.mjs` | 出热更包（**现在基本不用**，见 4.2） |
| `zip-append.mjs` | 往已有 zip 追加/替换文件，不重打（支持 `--only-file` 避开命令行长度上限） |
| `check-package.mjs` | 出包后纯净度自查（凭据 / 运行数据 / 口令 / 密钥警告） |
| `encrypt-art.mjs` | 美术资源加密 / 解密（`--decrypt` 回滚） |
| `vault.mjs` | 交接文档加解密（**不随机分发**） |

> ⚠️ 交接文档**不要**打进发给玩家的包（里面有后台口令）。
>
> `pack-update.mjs` 走的是「MANIFEST.json + UPDATE.json」那套官方更新格式。当前安装里的 MANIFEST 是 2026-10-25 的旧版本，基线对不上，**日常请用 `make-hotfix.mjs`**。

---

## 11. 历史文档

- `HANDOFF-STRONGHOLD-2026-11-14.md` —— 上一轮（账号系统、好友、暂离模拟、主题修复等）的详细记录，保留不动。
- `HANDOFF-ARKDAYS-WEB.md` —— 另一个项目，与本项目无关。

---

## 回滚记录：0.4.0 融合尝试已全部撤销（2026-11-15 22:48）

**结论：0.4.0 融合未达标，已完整回滚到 0.3.3-Yuan（Fusion）。本机与线上都回滚完成并验证通过。**

### 回滚原因（实测问题）
1. 规程（三期）对局内**不发牌/商店空**（m.private.shop.slots 为空），有钱用不掉，卡在休整。
2. 对局内**单位头顶血量不显示**。
3. **第二期拓展玩法（湮灭/炸惊）无法进入**——融合时把 70 个冲突文件取了上游 0.4.0，我们写在对局层/界面层的补丁被覆盖。
根因判断：0.4.0 上游对局层（含版本 match host 子进程）与我们 0.3.3-Fusion 的自定义对局层混用，m.public/m.private 字段与行为对不上，属**语义层不兼容**，不是单个文件能补的。

### 回滚已完成
| 位置 | 状态 |
|---|---|
| 本机安装目录 E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion | **原样保留、未改动**（融合是在另一个目录做的），验证 ersion=0.3.3-Yuan、default=act2autochess、rtKey=ok、端点全 200、启动自检通过 |
| 线上 8.134.50.56:3000 | 已用 **485 个旧版文件（58.5MB）反向覆盖 + 重启**，验证同为  .3.3-Yuan、default=act2autochess、首页/资源/后台/room.js 全 200 |
| 本机账号库 | 只剩固定账号 Mon3tr#3250（dmin=true、本机登录锁死 403） |
| 临时验证账号 | 已删除（RollbackTest、博士），会话/云存档同步清理 |
| 0.4.0 融合树 | 已改名归档 E:\stronghold\_ABANDONED-0.4.0-merge（2.7GB），**确认不需要可直接删** |

### 回滚后已验证的功能
- 本机 0.3.3 走查：首屏 → 登录 → 大厅 → 独立模拟 → 房间 → 开局，**每阶段 0 异常 / 0 console.error**；对局内手牌正常（10 张）。
- **拓展模式入口可用**：面板显示「选择拓展玩法」，湮灭模拟 / 炸惊模拟均显示「**可开局**」「玩法包已就位」，0 异常。
- 线上回滚后同样  .3.3-Yuan，资源解密正常（rtKey=ok）。

### 线上仍残留的 0.4.0 文件（无害）
回滚只覆盖了**旧版本来就有的 485 个文件**；0.4.0 新增的约 5760 个文件（新赛季美术、data/versions/act3autochess-v3_1/、部分新 js/协议文件）仍在线上。旧版代码不引用它们（shared/versions.js 已回滚，不认识三期 id），**不影响运行**；要彻底干净只能重打整包覆盖。

### 教训（下次融合 0.4.0 前必读）
- 0.4.0 的**版本对局跑在独立子进程 match host 里**，字段/协议与 0.3.3 对局层不可混用；「部分文件取上游」会得到半套逻辑。
- 正确做法是用 git 三方合并**逐个解决冲突**（141 处冲突 / 70 个文件），或直接以 0.4.0 为底重做 Fusion 补丁，不能图快整批取上游。
- 见 HANDOFF-0.4.0-MERGE.md（融合过程记录，已标废弃）。

---

## 2026-11-18 服务端补充包（已应用，2026-11-21 07:32）

**来源**：业主给的 SERVER-UPDATE-2026-11-18.zip + SERVER-UPDATE.md（从线上那台的 v0.3.3-Yuan 打的补丁包，build 来源  c6682201e37）。

### 应用结果（本机 E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion）
- 应用 **47 个文件**；覆盖前备份了**36 个旧文件** → E:\stronghold\_backup-before-1118\（回滚用）。
- **故意跳过** public/ui-layout.json：本机有自己用 UI 编辑器调过的布局（updatedAt 11-08），文档也写明"目标机自己调过布局就别覆盖"。若标题页页脚仍显拥挤，可再单独合并该文件的 13 条过期布局项。
- 编码已校验：deploy-public.ps1 = UTF-8 **带 BOM**；修复启动器.cmd / 部署公开服务器.cmd = **GBK**（未破坏）。
- 补丁**已包含我 11-15 的全部改动**（固定账号守卫 ssertMutable、独立热更锁 updateLockOk、后台「🔒 固定」标记都在），所以是超集，无需再合并。

### 验证结果（全通过）
| 验收项 | 结果 |
|---|---|
| /healthz | ersions.enabled = [act2autochess]；ersions.blocked = 4 条（act3autochess / act2autochess@V2_1 / act1autochess / act1autochess@V1_1）✓ |
| 版本选择器 | 4 个版本灰显「暂未开放」，点锁定行只弹 toast，切不过去 ✓ |
| 拓展模式 → 炸惊房 | 建房成功（difficulty=ZHAJING、content.vanilla=true），**「开始模拟」可点**（修复前一直灰着并提示"仍有博士未载入插件内容"）✓ |
| 超限模拟 ∞ | 主题大厅入口存在（data-testid=lobby-infinite-entry、oh-fire hub-inf-entry），建房为 solo_infinite + ABYSS ✓ |
| 常规局简报盟约过滤 | 两套主题 + 策略页都改成 officialBonds(...)，常规局不再出现 S.E.E.S / 颂乐人偶（代码级确认）✓ |
| 炸惊「选惊变」 | 两套主题都接入原版 JibianOverlay + 每卡重抽（代码级确认）✓ |
| 结束暂离模拟 | 两套主题恢复**单次**确认，文案「结束并判负」（代码级确认）✓ |
| 后台改名 / 删除账号 | 页面出现 data-acc-rename / data-acc-delete 按钮；两个 API 路由已注册（400 缺参数，非 404）✓ |
| 标题页（closure） | 三个主题 CSS（title / briefing / numfont）已挂载，倒计时数字图已换 32×68 完整格 ✓ |
| 版本局暂停 / 结算 | server/match/host/proxy.js 已补 setPause / inish（修复版本局"暂停失败 TypeError"）✓ |
| 客户端异常 | 全流程 **0 异常 / 0 console.error** ✓ |

代码级检查：21 项标记全部命中（21/21）。

### 线上状态
线上 **已经带着这份补丁**（uild=b199b651041a、enabled=[act2autochess]、locked=4），**无需再推**。

### 当前运行状态
本机服已带补丁重启：ersion=0.3.3-Yuan、rtKey=ok、enabled=[act2autochess]、locked=4、账号库只剩固定账号 Mon3tr#3250（本机登录锁死）。临时验证账号已删除。

---

## 2026-11-20 反馈与可露希尔 UI 处理（2026-11-21 08:0x 落地）

### 玩家反馈原话（线上，同一位玩家 11-20 10:18–10:19 提交）
1. 「反馈不匿名」
2. 「部分设备的可露希尔UI出现显示问题」

> 业主确认：这两条都是他自己发的，**当指令处理**。

### 一、反馈改为「非匿名 + 展示反馈人名字」
| 文件 | 改动 |
|---|---|
| `public/js/ui/settings.js` | 提交时附带 `name`：取本机登录账号的 **昵称#tag**（`store.get().account.nickname/tag`）；文案改为「会带上你的昵称与 #tag」 |
| `server/feedback.js` | `add()` 重新落盘 `name` / `ip`（各限 64 字符），HTTP 层透传 `ip`（同时用于内存限流） |
| `server/admin.html` | 后台「问题反馈」卡片：名字高亮显示，缺失时显示「未署名」，并恢复 IP 展示 |

- 实测：界面提交后服务端记录为 `name="FeedbackTest#1760" ip="127.0.0.1"` ✓（测试数据已删除）
- 已同步线上（3 个文件 → `/admin/api/update` → 重启成功，`uptime` 归零）✓
- 线上已有 2 条旧反馈（提交时客户端还没带名字）显示为「未署名」；**之后的新提交都会带名字**。

### 二、可露希尔（closure）在某些设备上的显示问题
根因 = 11-18 应用补丁时**跳过**的 `public/ui-layout.json`：13 条历史微调（标题底栏 8 条 + 顶栏 5 条）会把版权行 / 版本号 / 感谢名单挤在一起（见 `docs/FIX-2026-11-17-closure-ui.md`）。

- 处理：**按条目剔除**这 13 条，不整文件覆盖，保留其余本地布局；原文件备份 `public/ui-layout.json.bak-2026-11-21`
- 条目数：桌面 11 → 6；手机 32 → 24

**多分辨率精确复验（无头 Edge）**

| 分辨率 | 版权×版本号 | 版权×感谢名单 | 版本号×感谢名单 | closure 皮肤 |
|---|---|---|---|---|
| 1920×1080 | 无重叠 | 无重叠 | 无重叠 | 已挂载 |
| **1920×885（报障机分辨率）** | 无重叠 | 无重叠 | 无重叠 | 已挂载 |
| 1366×768 | 无重叠 | 无重叠 | 无重叠 | 已挂载 |
| 390×844（手机） | 无重叠 | 无重叠 | 无重叠 | 已挂载 |

对局内（`/dev/game-mock-closure.html`）：「重刷本局」条 ×「玩法说明」按钮 —— INFO_CHECK / PREP × 1366 / 1920 **全部无重叠**，`briefing.css` 已挂载，0 JS 异常。

### 备份
- `E:\stronghold\_backup-before-1118\`（11-18 补丁前的 36 个文件）
- `E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion\public\ui-layout.json.bak-2026-11-21`


---

## 2026-11-21 域名 mon3tr.fun 接入（已实现，卡在阿里云备案）

详细说明另见 `docs/DOMAIN-mon3tr.fun.md`。

### 诊断结论
- `mon3tr.fun` / `www` 已正确解析到 `8.134.50.56`（DNS 在阿里云 hichina）。
- 但域名**未 ICP 备案**：阿里云在网络层按 Host 头拦截 → 任何端口（80 / 3000 都一样）访问域名都返回
  `403 Non-compliance ICP Filing`（响应头 `Server: Beaver`）；换成 IP 访问则 200。
- 证据：同一台机器 `Host: mon3tr.fun:3000` 请求发到 IP 也被 403，说明拦截与端口无关。

### 做了什么
1. 新增 `server/http/extraPorts.js`：额外端口（80）**透明反向代理**到主端口 3000，
   HTTP + WebSocket 升级都透传；主端口逻辑零复制、绑不上只告警不影响启动。
2. 新增配置 `data/http-ports.json`（线上已配 `{"extra":[80],"domain":"mon3tr.fun"}`，
   支持 BOM；文件不存在 = 不启用，默认零改动）。
3. `server/index.js` 启动时读取配置、启动额外端口并在 banner 打印域名入口；关闭时一并释放。

### 线上实测（2026-11-21）
| 入口 | 结果 |
|---|---|
| `http://8.134.50.56/`（80，无端口） | 200，首页 6.0KB |
| `http://8.134.50.56/healthz` | 200 `ok:true` `version:0.3.3-Yuan` `artKey:ok` |
| `http://8.134.50.56/data/assets.json` | 200（3.4MB） |
| `ws://8.134.50.56/ws` | **OPEN**（WS 透传正常） |
| `http://8.134.50.56:3000` 及 `ws://…:3000` | 原样可用 |
| `http://mon3tr.fun` / `:3000` | 403（阿里云备案拦截） |

本机另用 8080 做了端到端等价验证：从额外端口进页面 → 登录 → `online` → 大厅，0 异常。

### 要让域名可用
必须做 **ICP 备案**（阿里云 → 备案系统；需要备案服务号 + 主体证件 + 域名实名满 3 天；
初审 1–2 天 + 管局 7–20 天）。备案通过后**无需改代码**，`http://mon3tr.fun` 立刻生效。
⚠️ 游戏类网站备案涉及前置审批，个人主体一般过不了；详见域名文档。

不备案的替代方案（详见文档）：继续用 `http://8.134.50.56`（无端口，已可用）、
Cloudflare Tunnel（需迁 NS 到 Cloudflare 并在服务器跑 cloudflared，可得到 https://mon3tr.fun）、
或搬到香港/海外服务器。


---

## 2026-11-21 域名 mon3tr.fun 接入完成（Cloudflare Tunnel）

### 最终方案
**Cloudflare Tunnel（隧道）** —— 服务器**主动往外连** Cloudflare，绕过阿里云对境外入站流量的拦截。

- 域名 NS 已切到 Cloudflare：`jaziel.ns.cloudflare.com` / `mallory.ns.cloudflare.com`
- 隧道名 `stronghold`，ID **`da2da567-74ba-49f8-a172-7401d701fcbd`**
- DNS：`mon3tr.fun` → CNAME `da2da567-74ba-49f8-a172-7401d701fcbd.cfargotunnel.com`（橙色云；CF 会把它展平显示成 A 记录，正常）
- 配置：`C:\cloudflared\config.yml`（入口 `mon3tr.fun` → `http://localhost:3000`）
- cloudflared：`C:\cloudflared\cloudflared.exe`（v2026.11.1，55,483,112 字节）
- 开机自启：计划任务 **`CloudflareTunnel`**（SYSTEM，开机启动，运行 `C:\cloudflared\run.cmd`，日志 `C:\cloudflared\tunnel.log`）
- 安装脚本（本机留档）：`E:\stronghold\cf-tunnel-cli.ps1`

### 验证结果
| 检查 | 结果 |
|---|---|
| `https://mon3tr.fun/` | 200，标题「卫戍协议：盟约」 |
| `https://mon3tr.fun/healthz` | 200 `ok:true` `version:0.3.3-Yuan` `artKey:ok` |
| `wss://mon3tr.fun/ws` | **OPEN**（联机正常） |
| `http://mon3tr.fun/` | 200 |
| 关掉前台窗口后 | 仍然可用（自启任务接管）✓ |
| 首屏加载 | **34 秒 → 12 秒**（加缓存规则后）|
| `www.mon3tr.fun` | 未配置（可选） |

### 走过的弯路（下次别重复）
| 尝试 | 结果 | 原因 |
|---|---|---|
| Cloudflare Worker 反代到 `http://8.134.50.56:3000` | ❌ 1003 | **CF Worker 禁止 fetch 裸 IP** |
| Worker 反代到 `http://8.134.50.56.nip.io:3000` | ❌ 520 | CF 出口到非标准端口被拒 |
| Worker 反代到 `http://8.134.50.56.nip.io`（80） | ❌ 520 | 阿里云拦境外入站（百度返回 200，说明 CF 出口本身没问题）|
| 直连 `mon3tr.fun`（A → 源站 IP，CF 代理） | ❌ 403 / 521 | 阿里云按 Host 拦未备案域名；源站无 443 |
| **Cloudflare Tunnel（出站）** | ✅ 成功 | 服务器主动连 CF，不需要境外入站 |

**备案结论**：个人主体 + 游戏内容 = 管局不会批（游戏属文化产品，需文网文前置审批，个人无法办理）。所以走隧道方案，不备案。

### 代理上的两个坑（服务器侧）
1. **`one.dash.cloudflare.com` 在国内解析不出** → 给浏览器开安全 DNS（DoH）或用 `https://dash.cloudflare.com/one/` 进入 Zero Trust。
2. **`cloudflared tunnel login` 取证书要访问 `login.cloudflareaccess.org`**（国内解析不出）→ 在服务器 hosts 加：
   ```
   198.41.215.156 login.cloudflareaccess.org
   ```
   然后 `ipconfig /flushdns`，重新 `tunnel login` 即可成功写 `C:\Users\Administrator\.cloudflared\cert.pem`。
3. `tunnel login` **不需要绑卡**（网页版 Zero Trust 控制台才要）。

### 性能优化（已做，服务端 + Cloudflare）
1. **`server/http/files.js`**：新增 `CODE_CACHE = 'public, max-age=60, s-maxage=600, stale-while-revalidate=600'`，
   `.js/.mjs/.css/.json/.map/.wasm/.txt` 不再发 `no-cache` → Cloudflare 可缓存（原来每个请求都回源，隧道回源约 2 秒）。
2. **`server/http/static.js`**：`/data/assets.json`、`local-assets.json`、`local-fx.json` 三个视图同样改为可缓存（3.4 MB 的清单原来每个玩家都要等 10 秒）。
3. **Cloudflare Cache Rule**「缓存数据和界面素材」：`URI 路径 开头为 /data/ **或** /ui-art/` → 缓存资格「符合缓存条件」，**边缘 1 天 + 浏览器 1 小时**。
   （⚠️ 浏览器 TTL 必须短——浏览器缓存 purge 不掉；边缘 TTL 可以长，必要时 Purge 立刻生效。）

### 以后更新游戏必做的一件事
改过 `public/` 里的文件后，去 **Cloudflare → mon3tr.fun → 缓存 → 清除缓存 → Purge Everything**，否则玩家会看到旧版本（最多 1 天自动过期）。

### 常用运维命令（服务器上）
```powershell
# 看隧道状态
C:\cloudflared\cloudflared.exe tunnel info stronghold
# 看日志
Get-Content C:\cloudflared\tunnel.log -Tail 50
# 重启隧道
schtasks /End /TN CloudflareTunnel ; schtasks /Run /TN CloudflareTunnel
# 前台调试
C:\cloudflared\cloudflared.exe --config C:\cloudflared\config.yml tunnel run
```

