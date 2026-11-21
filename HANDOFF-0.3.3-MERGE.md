> 端：PC（Windows 启动器 / 本地服务端）

# 交接文档：0.3.3 五包合并

> 交接时间：2026-10-25
> 工作目录（成品）：**`E:\stronghold\新建文件夹\`**
> 原包目录：`E:\stronghold\` 下各包，**全部只读，一个字节都不要改**

---

## 一、任务（用户原话）

以 `E:\stronghold\Stronghold-Protocol-v0.3.3\` 为主体，把下面这些合进去：

| 来源包 | 要合的东西 | 状态 |
|---|---|---|
| `Stronghold-Protocol-v0.2.6-Windows-x64\` | **背景渲染** | ❌ 未开始 |
| `Stronghold-Protocol-Forge-0.19.1-0.3.1-win-x64\` | **背景渲染** + **Forge 本体** | ❌ 未开始 |
| `卫戍协议-UI与附加功能-delis\` | **UI 与附加功能** | 🟡 部分完成（见 §四） |
| `卫戍协议开场动画-分享包\` | **开场动画** | ❌ 未开始 |
| `卫戍协议-素材包-20261019\` | **特效素材**（`assets/`+`fonts/`） | ❌ 未开始 |

**用户明确指示**：
- **不使用子代理**，由接手的会话自己做
- **不要加我们自己的功能**（`/admin` 后台、`/test` 车道、水印/`SERVER_NAME`、房间一览、局内交流、私密开关等**都不迁**）
- 成品放 `E:\stronghold\新建文件夹\`

---

## 二、当前状态（已核实）

1. **基线与副本**：`E:\stronghold\Stronghold-Protocol-v0.3.3\Stronghold-Protocol\` 已用 robocopy `/E` 全量复制到 `E:\stronghold\新建文件夹\`，**38686 个文件**，关键文件齐（`server/index.js`、`public/index.html`、`shared/constants.js`、`node_modules/ws`、`package.json`、`tools/assets/skel.mjs`）。
2. **0.3.3 是"摊平树"**（不是 Electron 包）：`server/` `public/` `shared/` `data/` `packs/` `plugins/` `schemas/` `scripts/` `node_modules/`。
3. **实测能启动**：
   ```
   node server/index.js        （node 用系统 node 或 E:\test\Stronghold-Protocol-Windows\node\node.exe）
   → [content] vanilla a46a3b5b3f5624f1 (379 code files, 16 data files)
     [versions] enabled: act2autochess(默认) | act2autochess@V2_1 | act1autochess | act1autochess@V1_1
     [http] limits: rooms 1000 (16/network), matches 8/network, sockets 2000 (64/network)
   → 卫戍协议：盟约 · Stronghold Protocol: Alliance v0.3.3
   → GET /healthz = 200, app=0.3.3
   ```
   ⚠️ **启动要十几秒**（建素材索引），前 12 秒探测会"连接被拒"是正常现象，别误判为起不来。
4. **0.3.3 是干净上游版**：`/healthz` 里 **`open` / `serverName` 为空**，**`/admin` 与 `/test` 都 404** —— 我们那套自有功能不在其中（按用户指示**不要再加**）。
5. **已并入 delis 的两个"新增"文件**（安全、目前**未接线**、不影响运行）：
   - `public/js/ui/extImage.js`
   - `server/http/imgProxy.js`

---

## 三、验收基线（每一步都按这个验）

```powershell
# 1) 起服务（后台任务，等 20~60 秒）
Start-Process -FilePath 'E:\test\Stronghold-Protocol-Windows\node\node.exe' `
  -ArgumentList 'server/index.js' -WorkingDirectory 'E:\stronghold\新建文件夹' `
  -RedirectStandardOutput "$env:TEMP\m.out" -RedirectStandardError "$env:TEMP\m.err"
# 2) 等健康检查 200（app 必须是 0.3.3）
curl http://127.0.0.1:3000/healthz
# 3) 浏览器零异常（无头 Edge + CDP，参考 .sp-roomlist 下任意 verify-*.mjs 的写法）
#    断言：document.querySelector('.title-screen') 存在、Runtime.exceptionThrown 为空
# 4) 每步都要存"合入前 / 合入后"截图
```

- 3000 被占用时先 `Get-NetTCPConnection -LocalPort 3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`
- 既有回归套件（`.sp-roomlist\*.mjs`）是**为我们自己的 0.3.0 树写的**，在 0.3.3 上多数不适用，**不要拿它们当验收**；以 `/healthz` + 浏览器零异常 + 截图为准。

---

## 四、delis（UI 与附加功能）交接细节

**包位置**：`E:\stronghold\卫戍协议-UI与附加功能-delis\`（`payload/` + `install.mjs` + `安装说明.md` + `manifest.json`）

**它的性质（重要）**：**覆盖式补丁**，标称引擎 **0.3.1**，`install.mjs` 会整文件覆盖 11 个文件（`node install.mjs <gameRoot> [--dry-run|--verify]`）。
👉 **绝对不要直接跑 install.mjs**（会把 0.3.3 的核心文件退回 0.3.1 版本）。

**dry-run 结果**：
```
新增  public/js/ui/extImage.js            ✅ 已并入
新增  server/http/imgProxy.js             ✅ 已并入
覆盖  public/js/content.js                ❌ 需移植 warmPlugins()
覆盖  public/js/screens/lobby.js           ❌ 需加"挂载时 warmPlugins() + 音乐初始化"
覆盖  public/js/screens/title.js           ❌ 需改「工坊」指向 /studio/
覆盖  public/studio/{studio.css,js/catalog.js,js/main.js}  ❌ 可整文件替换（独立页面）
覆盖  server/http/csp.js                  ❌ 需加 BUILTIN_ALLOW + mergePluginCsp()
覆盖  server/http/routes.js               ❌ 需挂 /img-proxy 路由
覆盖  server/index.js                     ❌ 需接 mergePluginCsp 到站点 CSP
```

**0.3.3 里这些都没有**（已 grep 确认命中 0）：`img-proxy`、`imgProxy`、`warmPlugins`、`BUILTIN_ALLOW` / `mergePluginCsp`。

**要照搬的钩子（来自 payload 实际代码）**：
| 目标 | 钩子 |
|---|---|
| `server/http/routes.js` | `import { handleImgProxy } from './imgProxy.js';` + 路由分派处 `if (await handleImgProxy(req, res, parts.rawPath, parts.query)) return;` |
| `server/http/csp.js` | `BUILTIN_ALLOW` 常量 + `mergePluginCsp(cspDecls)` |
| `server/index.js` | `import { siteCsp, mergePluginCsp } from './http/csp.js';` + `const extraCsp = mergePluginCsp(cspDecls);` 并接进站点 CSP |
| `public/js/content.js` | `export async function warmPlugins()`（预取工坊插件目录与脚本） |
| `public/js/screens/lobby.js` | 挂载时调 `warmPlugins()` + 初始化音乐模块 |
| `public/js/screens/title.js` | 「工坊」按钮 href → `/studio/` |
| `public/studio/**` | 目录页双入口（新 JSON 工坊 / 老 HTML 站，互斥）+ 顶栏「← 返回游戏」+ 样式 |

**做法**：先用 `payload/` 里对应文件与 0.3.3 的文件**逐文件 diff**，只取上述钩子落进 0.3.3 的版本；`public/studio/**` 属独立页面，可整文件替换（先备份）。

---

## 五、剩下四个包：入手点

### 1. 背景渲染（两个来源，**必须择优/合并，不能都装**）
- `Stronghold-Protocol-v0.2.6-Windows-x64\Stronghold-Protocol-Windows\`（Electron 包 → 看 `resources/`）
- `Stronghold-Protocol-Forge-0.19.1-0.3.1-win-x64\...\`（同名目录）
- 先各自找出**渲染实现**（关键词：`background`、`scene`、`renderer`、`shader`、`hub-bg`、`backdrop`、`gl`）与**资源**，判断哪份与本树 0.3.3 结构最接近；**只保留一份实现**，另一份只取资源；冲突处写进 `MERGE-LOG.md`。

### 2. Forge 本体
- 先读其 `AGENTS.md` / `MANIFEST.json` / `install.mjs`（若有）
- **先 `--dry-run`、先备份**；若它会替换 0.3.3 的核心 screen/JS，走"把本地差异移植进它的 payload 再装"的流程，**不要整文件覆盖**

### 3. 开场动画（`卫戍协议开场动画-分享包\卫戍协议开场动画-分享包\`）
- 找出播放入口（多半是 `public/js/screens/title.js` / `public/js/main.js`）与资源；目标：**进游戏播一次、可跳过、不卡住**

### 4. 特效素材（`卫戍协议-素材包-20261019\assets\` + `fonts\`）
- 基本是**纯新增**：按路径并进 `public/assets/**` 与字体目录；**列出新增清单**，同名冲突就改名并记录；并确认被引用（没被引用要说清原因）

---

## 六、纪律与坑（都是这次踩过的）

1. **原包只读**；所有改动只在 `E:\stronghold\新建文件夹\` 里。
2. **一次只合一个包，合完立刻验收**；五包一起装会无法定位问题。
3. **覆盖前必须备份**（建议 `E:\stronghold\新建文件夹-备份\<时间戳>\`）。
4. **不要直接跑任何包的 `install.mjs`**（UI pack 与 delis 都是 0.2.x/0.3.1 时代的覆盖式安装器，曾在 0.3.0 上把页面搞白屏）。
5. **启动慢**：等 20~60 秒再判断"起没起"。
6. **PowerShell 输出中文可能乱码**，核实文件内容请用读文件的工具，不要看控制台。
7. 用户要 A 方案：**只合这五个包，不迁自有功能**（`/admin`、`/test`、水印、房间一览、交流、私密、皮肤接线都不要加）。

## 七、最终交付物

1. `E:\stronghold\新建文件夹\` —— 合并完成、可独立运行
2. `MERGE-LOG.md` —— 每个包：拷了哪些文件、改了哪些既有文件、验证结果、冲突取舍
3. `PACKAGING.md` —— 运行方式、体积、验证记录、已知限制
4. 背景/开场动画/特效的**前后对比截图**
5. （可选）打包 zip
