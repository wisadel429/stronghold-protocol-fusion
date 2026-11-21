# PACKAGING — 卫戍协议：盟约 v0.3.3（五包合并成品）

> 目录：`E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion\`
> 合并内容：delis 的 6 处钩子 + 背景渲染（核实）+ Forge 本体（编辑器）+ 开场动画 + 特效素材
> 详细改动与取舍见同目录 `MERGE-LOG.md`；验收截图见 `merge-shots/`。

---

## 一、怎么跑

### 0. 最简单：双击 `Stronghold.exe`

根目录的 **`Stronghold.exe`** 是电脑版启动器：先出现启动页（本地游戏 / 部署公开服务器 / 服务器列表），点「本地游戏」才启动本地服务器，就绪后同一窗口进入游戏；点「部署公开服务器」则只开服、不进游戏画面，就绪后直接打开管理后台 `/admin`（见 [docs/ADMIN.md](docs/ADMIN.md)）。

- 已随包带 `node
ode.exe`，不需要另装 Node.js；
- 关窗口 = 关服务器；
- 服务器退出/无响应会自动回启动页；
- 想用浏览器：`start-game.bat`（需要系统 Node.js 22+）。

### 0.1 浏览器方式：双击 `start-game.bat`

文件夹根目录的 **`start-game.bat`**：双击即可。它会：

- 自动找 Node.js（PATH、`C:\Program Files\nodejs`、本目录 `node\`）；
- 如果 3000 已经在跑，就直接打开浏览器，不会重复开服；
- 没在跑就启动服务器，等 `/healthz` 返回 200 后自动打开 <http://localhost:3000>；
- 关掉那个黑窗口就是关服务器。

找不到 Node.js 时窗口会提示去 <https://nodejs.org/> 安装 22 或更高版本。

### 1. 游戏（手动）

需要 **Node.js ≥ 22**（开发机用的是 `E:\test\Stronghold-Protocol-Windows\node\node.exe`，v22；本机系统 node 是 v24，也能跑）。

```bat
cd /d E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion
node server\index.js
```

启动要等几秒到十几秒（第一次要建素材索引），控制台出现下面这些就算好了：

```
[content] vanilla a46a3b5b3f5624f1 (379 code files, 16 data files)
[http] limits: rooms 1000 (16/network), matches 8/network, sockets 2000 (64/network)
  卫戍协议：盟约 · Stronghold Protocol: Alliance v0.3.3
  Local:   http://localhost:3000
```

然后浏览器打开 <http://localhost:3000>。

- 默认端口 **3000**（`PORT` 环境变量可改），默认监听 `::`（双栈）与局域网。
- `/healthz` 应返回 `{"ok":true,"app":"0.3.3",...}`。
- 工作台：<http://localhost:3000/studio/>（只对本机与局域网开放；带钥匙的地址启动时会打印在控制台 `Studio:` 那一行）。
- 标题页右下角「工坊」按钮就是进 `/studio/` 的入口（不带钥匙，只读；把控制台那行带 `#key=` 的地址粘进工作台即可编辑）。

### 1.1 皮肤（已内置，不再是插件）

**302 款官方时装 / 193 名干员**（头像 + 半身像 + 战斗 Spine）已经**并入游戏本体**：

- 图片：`public/assets/skins/img/`（约 1 208 张 WebP，头像与半身像）
- 战斗模型：`public/assets/skins/model/`（302 套 Spine，前后两面共 302 个骨架）
- 清单：`data/assets.json` 的 `chars[<charId>].skins[<皮肤 id>]` 记录（头像、立绘、`spine` 与动作映射 `anims` 全在里面）

因此服务器启动日志**没有** `[plugins] … (cosmetic, loaded)` 这一行，`/healthz` 也**没有** `content.plugins`；标题页不再显示「本服务器安装了 N 个插件」，设置里也没有外观插件开关——皮肤对所有玩家默认生效，皮肤栏的选择、队友可见、显示其他玩家的皮肤开关都和以前一样。

老整合包里四个 `plugins/official-skins-*` 的进度（浏览器里记住的开关）会被忽略，不影响已选的皮肤。
开启后：干员调配右侧出现「皮肤」区，302 款每款一格；选中后头像 / 半身像 / 名片换装，
**302 款局内小人全部换装**（Skadi 异格两款也补齐了）。

### 2. 工坊编辑器（可选，本机工具）

Forge 0.19.1 的编辑器，已作为独立子树放在 `forge/`：

```bat
start-studio-editor.bat
:: 等价于
cd /d E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion\forge
node tools\workshop-editor.mjs --port 3311
```

- 打开 <http://127.0.0.1:3311>，只绑本机，端口 3311（`--port` 可改）。
- 编辑「工坊包」（`forge/workshop/**`）；它不参与游戏服务器，`forge/` 不在 `public/` 下，网页端拿不到。
- 做好的包可以在游戏 `/studio/` 的「从 Forge 包导入」里导入（0.3.3 自带该功能）。

### 3. 不要把 `forge/` 放进 `public/`

编辑器能写文件，按设计只能本机访问；放 `public/` 会被静态服务发出去。

---

## 二、体积

| 部分 | 大小 |
|---|---|
| `public/assets/`（全部美术 / 音频 / Spine / 特效） | 约 **1.4 GB**（34 003 个文件；其中内置皮肤 `public/assets/skins/` 约占 333 MB / 2 398 个文件） |
| `public/js/`（客户端代码） | 约 4.5 MB |
| `forge/`（编辑器 + 依赖闭包 + 数据表 + 文档） | 约 **51 MB**（566 个文件；其中 `forge/data` 26 MB、`forge/docs` 18 MB） |
| `node_modules/` | 随 0.3.3 原样（`ws`、`three`、`pixi` 等） |
| `merge-shots/` | 约 7 MB（验收截图，交付用，可删） |

素材是最大头。如果要压包，`public/assets` 之外都可以忽略；素材本身不建议再压（游戏在线取的就是这些文件）。

---

## 三、验证记录（2026-10-25）

统一用无头 Edge + CDP：`Runtime.exceptionThrown` 计数、console `error` 计数，再截图。

| 检查 | 结果 |
|---|---|
| `GET /healthz` | **200**，`app=0.3.3`，`content.vanilla=a46a3b5b…`，`versions` 四条在 |
| 标题页（含开场动画点掉后） | 异常 **0** / console error **0** |
| 标题页 → 输代号 → 开始 → 大厅 | 异常 **0** / console error **0** |
| `/studio/` 工作台 | 异常 **0** / console error **0**（无钥匙时只读，符合设计） |
| Forge 编辑器 `127.0.0.1:3311` | 异常 **0** / console error **0**（仅浏览器自动请求的 `/favicon.ico` 404，非脚本错误） |
| 开场动画 | 出现 → 点击进入 → 播放（金字塔 + ALLIANCE + 点击跳过）→ 跳过 → 标题页；无异常 |
| 大厅「夜巡」程序化背景 | 山脊 / 要塞 / 信标 / 探照灯 / 雷达渲染正常；无异常 |
| `/img-proxy` | 坏地址 400、非图片 415、真实图片 200 |
| CSP | 响应头已含 delis 的内置放行源 |
| **整体巡检（最后一轮，无头 Edge 走主流程）** | 开场动画 → 标题 → 设置 → 统计 → 玩法说明 → 大厅 → S.W.E.E.P. / 干员调配 / 成就统计 / 大厅背景与音乐 → 独立模拟 → 选择模拟协议 → 房间 → 简报 → 选择策略 → 对局内；**全程异常 0、console error 0** |
| **内置皮肤** | 清单含 **302 款 / 193 名干员，302 款全部带 spine**；`/healthz` 无 `content.plugins`；皮肤区正常、选中换图；头像 / 立绘 / skel / atlas / 贴图 URL 全部 200 且带内容哈希；局内 `anims.idle="Idle"`；异常 0 |

截图索引（`merge-shots/`）：

- `00-baseline-title.png` — 合入前基线
- `01-delis-title.png` / `01-delis-lobby.png` — delis 钩子接完后（页脚「工坊」、大厅）
- `02-backdrop-scene-night.png` — 大厅程序化背景（夜巡）
- `02-forge-editor.png` / `02-forge-pack.png` / `02-forge-enemy.png` — Forge 编辑器（首页、包管理、怪物编辑器）
- `03-opening-film.png` — 开场动画运行帧
- `05-final-title.png` / `05-final-lobby.png` / `05-final-studio.png` — 全部合完后的最终状态
- `walk-*.png` — 最后一轮整体巡检截图（标题 / 设置 / 统计 / 玩法 / 大厅 / S.W.E.E.P / 干员调配 / 成就 / 背景音乐 / 协议 / 房间 / 简报 / 策略 / 对局）

---

## 四、已知限制 / 说明

1. **开场动画第一次需要点一下**（黑底「点击进入 / TAP TO START」）。这是浏览器自动播放策略决定的：没有用户手势就不允许出声，原包也是这么做的。点一下即可，也可直接点「点击跳过」。
2. **开场动画不进房间/对局**：带 `?room=` 邀请链接进页面、或刷新后恢复在对局里，不播。
3. **标题页「工坊」按钮不带钥匙**：打开的是只读工作台；要编辑就把服务器控制台 `Studio:` 那行带 `#key=` 的地址粘进去（或直接点控制台那行）。这是 0.3.3 工作台自己的安全设计，没有改。
4. **delis 的 `public/studio/**` 没有替换**：它依赖的服务端接口不在包里，替换会让 0.3.3 工作台报错；保留 0.3.3 自己的、更新的工作台。详见 `MERGE-LOG.md` §1.2。
5. **背景渲染没有装 Forge/v0.2.6 那一份**：0.3.3 已有同源且更完整的实现（`hubScene` + `lobbyMedia`），装第二份会类名冲突。两份实现差异与判断见 `MERGE-LOG.md` §2。
6. **特效素材包基本已被 0.3.3 收录**：只补了 2 个音频，这 2 个当前数据表没引用（见 `MERGE-LOG.md` §5.2）。
7. **Forge 编辑器是一个独立的本机工具**，不是游戏的一部分；它写 `forge/workshop/`，并把「是否助战」写进 `forge/data/support.json`，不改游戏服务器。
8. **编辑器的美术预览直接读上一层的 `public/`**（不复制 1.2 GB 素材）。所以 `forge/` 要留在成品根目录里用；单独把 `forge/` 拷走时，`forge/editor/server.mjs` 里 `PREVIEW_PUBLIC` 那三行要改回 `forge/public`。
9. **没有加自有功能**：`/admin`、`/test`、水印、房间一览、局内交流、私密开关都没有迁进来（按交接与用户要求）。
10. **皮肤模型**：302 款全部有战斗小人；Skadi 异格两款（`@boc#4`、`@iteration#2`）在 fexli 里放在 `Spine/` 子目录、是单面模型，已和其它皮肤一起内置在 `public/assets/skins/model/`。
10. **端口冲突**：3000 被占时先结束占用进程，或 `set PORT=3001 && node server\index.js`。
11. **编辑器 favicon 404** 是 Forge 页面本身没带图标，浏览器自动请求导致，只出现在日志里，不影响使用。

---

## 五、目录速览
```
Stronghold-Protocol-v0.3.3-Fusion\
  server\                 游戏服务器（0.3.3 + delis 的 img-proxy / CSP 钩子）
  public\                 网页客户端（含 allianceScene.js / lobbyIntro.js / extImage.js）
  shared\ data\ packs\ plugins\ schemas\ scripts\ tools\ test\ docs\
  node_modules\
  forge\                  Forge 0.19.1 工坊编辑器（独立本机工具）
  merge-shots\            验收截图
  MERGE-LOG.md            每个包改了什么、冲突怎么取舍
  PACKAGING.md            本文件
  start-studio-editor.bat      启动 forge 编辑器（127.0.0.1:3311）
  HANDOFF-0.3.3-MERGE.md   原始交接文档（未改）
```

---

## 六、压缩包

| 项 | 值 |
|---|---|
| 文件 | `E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion.zip` |
| 大小 | 约 1.0 GiB（以同名 `.sha256` 与文件实际大小为准） |
| 内容 | 与目录逐一对齐（0 缺 0 多），含四个皮肤插件与 `.cache/gamedata` 官方六表 |
| 顶层目录 | `Stronghold-Protocol-v0.3.3-Fusion/` |
| 校验 | 同目录 `Stronghold-Protocol-v0.3.3-Fusion.zip.sha256`（`certutil -hashfile <zip> SHA256`） |

- 文件名以 UTF-8 写入（Windows 资源管理器 / 7-Zip / macOS / Linux 解压都不乱码）。
- 打包后做了全量 CRC 校验（0 个坏条目）、条目数与磁盘逐一对齐、抽样 SHA-256 比对。
- `.cache/gamedata/excel/` 里的官方六表（character / skill / range / uniequip / battle_equip / activity，约 50 MB）已随包：这是 `setup` 为「皮肤插件引用了棋池外的干员」按需下载的，带上它首次启动就不用再联网下 50 MB；`.cache/setup-state.json` 记录已推导过的干员。
- 解压后按本文「一、怎么跑」启动即可；`node_modules` 已包含，不需要联网安装。

## 双基座：拓展模式（extension-base/）

大厅左侧的「拓展模式」按钮不是本服的房间模式，而是**第二套完整基座**：`extension-base/` 是一份独立的本作（0.3.3-Yuan 分支，自带服务端、数据与客户端，默认端口 3101），提供「湮灭模拟 / 炸惊模拟」等玩法包。

- 点击按钮时页面先 `GET /ext/status`；已在运行就直接 `http://<页面主机名>:3101/` 打开，否则 `POST /ext/launch` 让本机服务器启动它（只接受本机请求，局域网/公网玩家只会在已启动时被放行）。
- 两个基座**不共享**会话、房间和战绩：拓展模式是另一个游戏进程，不计入官方战绩。
- 打包发布时必须把 `extension-base/` 一起带上（约 2.7 GB / 5.9 万文件），否则按钮会提示找不到基座。
- 环境变量：`SP_EXTENSION=off` 关闭整个入口；`SP_EXTENSION_PORT`（默认 3101）改端口；`SP_EXTENSION_DIR` 指定基座目录。
- 基座随主服启动，主服关闭后它仍会继续运行（玩家可能还在里面），如需彻底停止可关闭 `node server/index.js` 进程。


## 2026-11-08 基座切换说明

本目录已从 0.3.3-Fusion 切换为 **0.3.3-Yuan 基座**（单一基座，不再有 `extension-base/`）：拓展模式大厅（湮灭模拟 / 炸惊模拟）现在就是本服自带玩法。

- 旧 Fusion 核心（server/shared/public/data 等）备份在 `E:\stronghold\fusion-core-backup-2026-11-08\`。
- 上一节「双基座：拓展模式（extension-base/）」的描述已作废，`server/extensionHost.js`、`/ext/*` 路由与大厅「拓展模式」按钮均已移除。
- 待回填的定制：后台改口令（初始 8888）、缺人同盟卡片、公告条、错误报告弹窗、皮肤内置、i18n 补全与非中文换行。

