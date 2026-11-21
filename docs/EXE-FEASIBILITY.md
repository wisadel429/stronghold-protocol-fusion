> 端：PC（Windows 打包与启动器）

# 把《卫戍协议：盟约》打包成 .exe 的可行性报告

- 日期：2026-10-31
- 对象：`Stronghold-Protocol-v0.3.3-Fusion`（Node 服务器 + 浏览器客户端）
- 结论先行：**可行，但“单个 exe 装下整个游戏”不现实**。推荐 **`Stronghold.exe` 启动器 + 游戏数据目录**（便携版），再套一层 **Inno Setup 安装包** 变成 `Setup.exe`。启动器原型已经跑通，游戏代码零改动。

---

## 1. 现状盘点（实测）

| 目录 | 大小 | 文件数 |
|---|---:|---:|
| `public/assets` | 1,081.5 MB | 31,601 |
| `plugins`（皮肤/模型） | 335.1 MB | 2,430 |
| `data` | 32.9 MB | 72 |
| `forge`（工坊编辑器） | 48.9 MB | 566 |
| `node_modules` | 68.9 MB | 6,000 |
| **整个游戏目录** | **1,660.7 MB** | **41,710** |

- 运行时：系统 Node **v24.19.0**，随包 Node **v22.23.3**；`engines: node >= 22`。
- 依赖：`ws`、`pixi.js`、`pixi-spine`、`three`、`preact`、`htm`、`acorn`、`ses`，**没有原生扩展（.node）**，所以不需要编译工具链。
- 代码形态：纯 ESM，服务器 + 浏览器前端分目录；已有 `scripts/launch.mjs`（准备资源 → 启动 → 等 `/healthz` → 开浏览器，支持 `--port/--host/--test-mode/--room-code`），根目录还有 `start-game.bat`。
- 资源必须留在磁盘：`public/assets` 由资源索引扫描，`plugins` 会在启动时扫描并热更新，`packs`/`versions` 也读目录。

---

## 2. 五条路线对比

| 路线 | 产物 | 体积 | 游戏代码改动 | 风险 | 工期 |
|---|---|---|---|---|---|
| **A. 启动器 exe + 便携目录** | `Stronghold.exe` + `node\` + 游戏文件 | ≈1.75 GB（未压缩） | **0** | 低（杀软/SmartScreen） | **0.5–1 天**（原型已做） |
| **B. Inno Setup 安装包** | `Setup.exe` | 压缩后约 **1.0–1.2 GB** | 0 | 低 | A + 0.5–1 天 |
| C. Electron 壳 | `Stronghold.exe`（窗口内嵌 Chromium） | +150–200 MB | 中（主进程启动服务器、asar 外置） | 中（`Worker`/`fork`/asar 路径） | 3–5 天 |
| D. Tauri + Node sidecar | `Stronghold.exe` + sidecar | +10 MB + WebView2 依赖 | 中 | 中（Rust 工具链、sidecar 管理） | 4–7 天 |
| E. Node SEA 单文件 | 一个 exe 装下服务器代码 | 83 MB + 资源外置 | **大（重构）** | **高** | 3–4 周，不建议 |

---

## 3. 为什么“单文件 SEA”走不通（有实测）

### 3.1 Node 24 的 SEA 仍只支持 CJS 入口

实测（Node v24.19.0 + `postject` 注入）：

```
Warning: Failed to load the ES module: index.mjs. ...
SyntaxError: Cannot use import statement outside a module
    at embedderRunCjs (node:internal/main/embedding:63:7)
```

即 SEA 把入口当 CommonJS 跑。要单文件，必须先把整个服务器（几百个 ESM 文件、动态 `import()`）打成 CJS bundle，等于重做构建链。

### 3.2 代码里有多个“磁盘文件 + 同一 node 可执行文件”的子进程

| 位置 | 用法 |
|---|---|
| `server/match/host/index.js:137` | `fork(ENTRY)` / `new Worker(ENTRY)`（对局主机进程/线程） |
| `server/workers/pool.js:125` | `new Worker(this.workerUrl)`（模拟 worker） |
| `server/plugins/scriptPreflight.js:30` | `spawnSync(process.execPath, [scriptProbe.js])` |
| `server/plugins/trustedRuntime.js:12` | `fork(trustedEntry.js)`（插件脚本沙箱） |

这些在 SEA 单 exe 下都会变成“exe 再跑自己”，而不是跑 worker 文件；必须改成“运行时把 JS 释放到临时目录再 fork”，改动面大且容易出隐蔽 bug。

### 3.3 资源体量决定了必须外置

1.66 GB / 4.17 万文件。任何 exe 方案都只能装**代码/运行时**，`public/assets`、`plugins`、`data` 仍然要放目录（或安装包解压出来）。

**结论：E 路线不适合这个项目。**

---

## 4. 启动器原型（已跑通）

产物在 `_merge-work\exe-poc\`：

- `StrongholdLauncher.exe`（**9 KB**，C# WinForms 编译）
- `Launcher.cs`（源码）
- `node\node.exe`（83 MB，随包运行时）

它做四件事：

1. 定位自身目录作为游戏根目录（支持 `--root`），找 `node\node.exe`，找不到退回 PATH 的 node；
2. 拉起 `server/index.js`（`PORT` 环境变量指定端口），日志写入 `launcher.log`；
3. 轮询 `http://127.0.0.1:<port>/healthz`，200 后打开默认浏览器；
4. 托盘菜单「打开游戏 / 停止并退出」，退出时 `taskkill /T` 杀进程树。

实测（端口 3010，避开正在运行的 3000）：

```
07:43:24  Local: http://localhost:3010
07:43:26 ready: http://localhost:3010/
07:43:26 test mode: stopping node
exit=0    port 3010 free
```

即：**exe 启动 → 服务器就绪 → 可访问 → 退出后端口释放**，全链路成立。

> 正式版建议把启动器里的 `server\index.js` 换成 `scripts\launch.mjs --no-open --port N`：这样首次启动的资源准备、`UPDATE.json` 更新收尾、单实例判断、地址打印都直接复用现有逻辑。

---

## 5. 推荐落地方案

### A. 便携版（先做这个）

```
Stronghold-Protocol-v0.3.3-Fusion\
  Stronghold.exe          ← 启动器（9 KB ~ 1 MB）
  node\node.exe           ← 83 MB
  server\ public\ data\ plugins\ shared\ scripts\ ...  ← 原样
  start-game.bat             ← 保留，给不想用 exe 的人
```

- 双击 exe 即可；二次双击检测到已在运行就只开浏览器。
- 端口被占时从 3000 递增找空位（`--port` 已支持）。
- 体积 ≈1.75 GB；用 7z 自解压或 zip 分发。

### B. 安装包（Setup.exe）

用 Inno Setup 打 A：

- 默认装到 `%LOCALAPPDATA%\StrongholdProtocol`（免管理员）或 `Program Files`；
- 开始菜单/桌面快捷方式指向 `Stronghold.exe`；
- 卸载器删除安装目录（保留 `backup-*` 可选）；
- 压缩后预计 **1.0–1.2 GB**（参考现有全量 zip 1.09 GB）；
- 可选：安装时加防火墙入站规则，方便联机。

### C. Electron（只有“想要独立窗口”时才做）

- 主进程内 `import('./server/index.js')` 起服务器，`BrowserWindow` 载 `http://127.0.0.1:PORT`；
- 游戏文件放 `extraResources`（不要进 asar），否则 `Worker`/`fork` 读不到真实路径；
- 体积 +150–200 MB，工期 3–5 天；体验提升主要是“没有浏览器地址栏/标签页”。

---

## 6. 风险清单

| 风险 | 说明 | 缓解 |
|---|---|---|
| SmartScreen / 杀软误报 | 未签名 exe，首次运行可能被拦 | 代码签名证书；或先发 zip 让用户“仍要运行” |
| 端口占用 / 多实例 | 3000 被占或重复双击 | 启动器单实例锁 + 端口递增 |
| 浏览器依赖 | 需要默认浏览器；极简系统可能没有 | 检测并提示装 Edge/Chrome；或用 Electron/Tauri |
| 中文/空格路径 | Node 与资源索引本身支持 | 安装器默认英文路径，允许自定义 |
| 首次启动慢 | 资源索引/`tools/setup.mjs` 要十几秒 | 启动器显示“正在启动…”；进度窗口 |
| 自动更新 | 现有 `UPDATE.json` 机制 | 启动器先跑 `scripts/launch.mjs`，沿用更新逻辑 |
| 插件脚本信任 | `SP_PLUGIN_SCRIPTS` 沙箱模式 | 安装包默认 `sandbox`，文档说明 |
| 联机/防火墙 | 局域网/公网需要放行端口 | 安装时可选添加防火墙规则；文档写清 |

---

## 7. 验收清单（做 A/B 时逐项过）

1. 双击 `Stronghold.exe` → 浏览器自动打开，`/healthz` 200，`plugins: 4`。
2. 服务器窗口/托盘可见，日志有 `Local/LAN` 地址。
3. 再次双击 exe：不重复开服，只开浏览器。
4. 托盘「停止并退出」→ node 进程消失，端口释放。
5. 3000 被占时自动换端口，浏览器打开新端口。
6. 断网启动：本地资源可用（`.cache` 已带），不卡在下载。
7. 卸载后目录清理干净（保留用户 `backup-*` 可选）。

---

## 8. 工期估算

| 阶段 | 工作 | 工期 |
|---|---|---|
| A 便携版 | 启动器正式化（单实例/端口/托盘/启动画面）+ 目录整理 | 0.5–1 天 |
| B 安装包 | Inno Setup 脚本、图标、快捷方式、卸载、防火墙 | +0.5–1 天 |
| C Electron | 主进程集成、asar 外置、窗口/菜单/更新 | 3–5 天 |
| E SEA | 全量 CJS 化 + 子进程重构 + 资源释放 | 3–4 周（不建议） |

---

## 9. 建议的下一步

1. 先做 **A + B**：这是投入最小、风险最低、当天能出成品的路线；
2. 想要“像客户端”的窗口体验，再评估 **C**；
3. **不要**投入 SEA 单文件，除非愿意重写服务器构建与子进程模型。

> 备注：本报告只做可行性验证与原型，没有改动游戏代码；`start-game.bat` 仍然可用。
