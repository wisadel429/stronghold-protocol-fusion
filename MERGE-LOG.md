# MERGE-LOG — 0.3.3 五包合并（delis 钩子 + 背景渲染 / Forge / 开场动画 / 特效）

> 工作目录：`E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion\`
> 时间：2026-10-25
> 验收口径（每一步都跑）：`GET /healthz = 200 且 app=0.3.3` + 无头 Edge/CDP 打开页面，`Runtime.exceptionThrown` 与 console error 均为 0 + 截图。
> 原包全部只读，未改动一个字节。

---

## 0. 总览

| 步骤 | 结果 | `/healthz` | 浏览器异常 | 证据 |
|---|---|---|---|---|
| 基线（合入前） | — | 200 · 0.3.3 | 0 | `merge-shots/00-baseline-title.png` |
| delis 6 处钩子 | ✅ 已接 | 200 · 0.3.3 | 0 | `merge-shots/01-delis-title.png`、`01-delis-lobby.png` |
| 背景渲染 | ✅ 已核实（0.3.3 已内建，未装第二份） | 200 · 0.3.3 | 0 | `merge-shots/02-backdrop-scene-night.png` |
| Forge 本体 | ✅ 已并入 `forge/`（独立本机编辑器） | 200 · 0.3.3 | 0 | `merge-shots/02-forge-editor.png` |
| 开场动画 | ✅ 已接（每次打开播一次，可点击/按键跳过） | 200 · 0.3.3 | 0 | `merge-shots/03-opening-film.png` |
| 特效素材 | ✅ 已核（0.3.3 基本是超集，仅补 2 个音频） | 200 · 0.3.3 | 0 | `merge-shots/05-final-*.png` |

最终 `/healthz`（2026-10-25 11:24 实测）：

```json
{"ok":true,"version":1,"app":"0.3.3","build":"ee477bbfbf32",
 "content":{"vanilla":"a46a3b5b3f5624f1534798d042740588db38456905fea10e44c57edf540e5850","sets":0},
 "versions":{"enabled":["act2autochess","act2autochess@V2_1","act1autochess","act1autochess@V1_1"],"default":"act2autochess"}}
```

`versions` 仍然在，说明 0.3.3 的官方版本功能没被 delis 的旧文件覆盖掉。

---

## 1. delis（UI 与附加功能）— 6 处钩子

做法：**没有跑 `install.mjs`**，也没有整文件覆盖。用 `payload/` 与 0.3.3 对应文件逐文件 diff，只取钩子落进 0.3.3 版本。

### 1.1 改动清单（全部已有文件，改动很小）

| # | 文件 | 改了什么 |
|---|---|---|
| 1 | `server/http/routes.js` | `import { handleImgProxy } from './imgProxy.js';`；在 `/healthz` 分发前加 `if (await handleImgProxy(req, res, parts.rawPath, parts.query)) return;` |
| 2 | `server/http/csp.js` | 加 `safeSource()`、`mergePluginCsp()`、`BUILTIN_ALLOW`；`siteCsp(publicDir, extra)` 把插件 `csp` 声明与内置放行源并进 `img-src` / `media-src` / `connect-src`（保留 `blob:`，0.3.3 自选大厅视频/音乐要用） |
| 3 | `server/index.js` | `import { siteCsp, mergePluginCsp }`；启动时读 `packs.plugins()` 的 `manifest.csp` → `extraCsp`，接进站点 CSP；`csp: "off"` 会整站关闭（打 warning） |
| 4 | `public/js/content.js` | 新增 `export async function warmPlugins()`（拉 `/plugins/index.json` + 预取插件 js/css，最多 80 个） |
| 5 | `public/js/screens/lobby.js` | 引入 `warmPlugins`；`LobbyScreen` 挂载时 `useEffect(() => { warmPlugins(); }, [])` |
| 6 | `public/js/screens/title.js` | 页脚加「工坊」按钮（`data-testid=title-studio`，`location.assign('/studio/')`） |
| 6b | `public/css/screens/title.css` | `.title-studio` 的绿色描边样式 |

**额外一处必要接线**：`public/js/main.js` 增加 `installImageProxy()`（`ui/extImage.js`）。该文件在 delis 包里没有任何 import，`/img-proxy` 路由不接它就不会有图片走代理；接在 `installLobbyMedia()` 后面。这是 `routes.js` 钩子的客户端那一半，不算新功能。

### 1.2 已有但未改动

- `public/js/ui/extImage.js`、`server/http/imgProxy.js`：交接时已并入，与 delis payload **逐字节相同**，本次未改。
- `public/studio/**`：**没有替换**。delis 的 `studio/js/main.js`、`catalog.js` 依赖 `GET /studio/key.json`、`POST /studio/api/reload`、`GET /studio/api/workshop`、`POST /studio/api/workshop/install` 这些 0.3.3 里不存在的接口（delis 包没带这些服务端文件），整文件盖上去只会让 0.3.3 工作台一直报错；0.3.3 的 `/studio/` 本身更新、更完整，所以保留 0.3.3 的，只做标题页入口。**这是与交接表第 7 行（studio/** 可整文件替换）的偏差，记录在此。**

### 1.3 验证

- `/healthz` 200，`app=0.3.3`，`versions` 四条仍在。
- CSP 响应头实测已带 delis 的放行源：
  `img-src 'self' data: blob: https://speedcdn.jiangjiangze.icu https://*.music.126.net https://*.126.net https://*.127.net`
  `media-src 'self' blob: https://*.music.126.net https://*.126.net`
  `connect-src 'self' https://api.qijieya.cn https://api.injahow.cn https://www.ffapi.cn`
- `/img-proxy`：坏地址 → 400；非图片 → 415；真实图片 → `200 image/x-icon 1966 bytes`。
- 标题页 / 大厅：`exceptions=0 / consoleErrors=0`；「工坊」按钮可见（截图 `01-delis-title.png`）。
- 大厅挂载后 `warmPlugins()` 无并发请求，`/plugins/index.json` 404 时只 `console.warn`，不抛异常。

---

## 2. 背景渲染（v0.2.6 + Forge 两个来源）

### 2.1 结论：0.3.3 已经内建同一套实现，不装第二份

- 两个来源里的实现都是 `public/js/ui/hubBackdrop.js`（v0.2.6 344 行 / Forge 393 行），同一血脉：固定种子中点位移山脊、要塞剪影、信标、探照灯、雪花/尘埃、昼夜四主题（夜巡 / 霜原 / 烬野 / 静默）。
- 0.3.3 里对应实现是 `public/js/ui/hubScene.js`（141 行，**同样的 `FAR/MID/NEAR` 种子与同一段 SVG**）+ `public/js/ui/lobbyMedia.js`（自选图片 / 视频 / 音乐，IndexedDB，20/60/20 MB 上限，最长边 2560，视频 ≤1080p）+ `public/css/screens/lobby.css`（`[data-hub-theme]` 色板、`hub-bg__*`、`hub-radar`、`bgset` 全都已在）。
- 也就是说：Forge 的 `HubBackdrop` 是这套东西的**前身**，0.3.3 的 `hubScene + lobbyMedia` 是它的超集（多了「默认官方背景」与独立音乐）。硬塞 Forge 版会与 0.3.3 的 `hub-bg__glow/__ship/__own` 类名和 `.hub-bg` 根节点冲突。
- 因此：**只保留 0.3.3 的实现**，Forge / v0.2.6 一份代码都没拷。这不是「没做」，是择优后判定不装。

### 2.2 验证

- 把偏好 `sp.pref.lobby.media = {"scene":"night"}` 注入后进大厅：山脊、要塞、信标、探照灯、雷达全部渲染（`merge-shots/02-backdrop-scene-night.png`），`exceptions=0`。
- 默认（官方 `entry_bkg_01/02`）背景也正常（`merge-shots/05-final-lobby.png`）。

---

## 3. Forge 本体（`Stronghold-Protocol-Forge-0.19.1-0.3.1`）

### 3.1 判断

- 包内没有 `install.mjs`，`MANIFEST.json` 是引擎清单；「Forge 本体」= `app/editor/`（工坊编辑器，`tools/workshop-editor.mjs` 启动，`127.0.0.1:3311`）+ `app/workshop/`（工坊包目录）。它是**只在本机跑的作者工具**，`editor/` 不在 `public/` 下，游戏服务器结构上不会把它发给网页端。
- 它只写 `workshop/**` 与 `data/support.json`，不碰游戏运行时代码，所以合它不会影响 `/healthz` 与页面。

### 3.2 并入方式：独立子树 `forge/`，不散落到游戏根

`Stronghold-Protocol-v0.3.3-Fusion/forge/`（566 个文件，51 MB）：

```
forge/editor/**                 编辑器（43 个文件：server.mjs / playtest.mjs / ui/**）
forge/tools/workshop-editor.mjs 启动器
forge/tools/workshop-pack.mjs   打包 / 校验 / 脚手架
forge/tools/workshop-scaffold.mjs
forge/tools/workshop-validate.mjs
forge/tools/assets/**           解析 skel / atlas / 动画名
forge/workshop/                 工坊包目录（原样，空）
forge/data/**                   编辑器读的官方数据表（26 MB，含 assets.json / chess.json / support 池）
forge/docs/**                   编辑器「帮助（五分钟上手）」等文档（18 MB）
forge/public/**                 只有 6 个模块：editor/server.mjs 在 node 侧 import 的共用校验代码
forge/server/**、forge/shared/**  编辑器静态 import 闭包（含它自己的 server/workshop.js、shared/*Authoring.js 等）
```

改动只有三处，且都在 `forge/` 内部：

1. `forge/editor/server.mjs`、`forge/shared/workshopValidate.mjs` 的
   `import { WORKSHOP_ASSET_TYPES } from '../server/index.js'` → `'../server/http/workshop.js'`。
   原写法会把整棵 0.3.1 游戏服务器（329 个模块）拉进编辑器进程；这个常量实际定义在 `server/http/workshop.js`，改指后编辑器只加载自己需要的模块。
2. `forge/editor/server.mjs` 的预览静态挂载：`/client/`、`/vendor/`、`/assets/` 的根从 `forge/public` 指向 `../public`（即成品自己的 `public/`，含 1.2 GB 素材）。**不复制第二份素材**，编辑器里的立绘 / Spine / 地图预览直接读游戏的那份。
3. 新增根目录 `start-studio-editor.bat`（= `cd forge && node tools\workshop-editor.mjs --port 3311`）与 `package.json` 的 `"editor"` 脚本。

**为什么放 `forge/` 而不是把 `editor/`、`shared/*Authoring.js` 铺到游戏根**：这些文件名在 0.3.3 里全都不存在，铺进去不会撞名，但会把 0.3.1 的 `shared/` 混进 0.3.3 的 `shared/`（同名文件不同内容，以后谁改谁踩坑）。独立子树保住边界，删掉即卸载。

### 3.3 验证

- `node forge/tools/workshop-editor.mjs --port 3311` 启动成功，打印工坊目录并监听；`GET /` = 200。
- 无头 Edge：首页 / `pack.html` / `enemy.html` 均 `exceptions=0 / consoleErrors=0`，页面渲染六个编辑页导航（截图 `merge-shots/02-forge-editor.png`、`02-forge-pack.png`、`02-forge-enemy.png`）。
- 预览素材走成品自己的 `public/`：`GET /assets/ui/entry/entry_bkg_01.png` = `200 image/png`；`/shared/recordDiff.js`、`/docs/START-HERE.md` 均 200。
- 唯一的 log error 是浏览器自动请求 `/favicon.ico` 的 404（不是脚本异常，也不影响功能）。
- 游戏服务器与之互不影响：`/healthz` 200、页面 0 异常（`forge/` 不在 `public/` 下，未被静态服务）。

---

## 4. 开场动画（`卫戍协议开场动画-分享包`）

### 4.1 并入

| 文件 | 处理 |
|---|---|
| `public/js/ui/allianceScene.js` | 新增（757 行，原包 `ingame/js/ui/allianceScene.js`） |
| `public/js/ui/lobbyIntro.js` | 新增（213 行） |
| `public/js/main.js` | 首次 `render()` 之后调 `playLobbyIntro()`（try/catch，失败只 warn） |

为 0.3.3 改的适配（原包是 0.2.4 分支，路径 `/_v024/js/...`）：

1. `allianceScene.js`：import 改相对路径；`resourcesReady()` 直接 `true`（0.3.3 的 `/assets` 由游戏服务器自己发，没有资源 worker / `CDN_VERSION`）；`spriteUrl()` 不再加 `?resources=`。
2. `lobbyIntro.js`：import 改相对路径；`holdBgm()` 增加 `audio.lobbyTrack` 判断（0.3.3 用 `audio.setLobbyTrack`，玩家自选大厅音乐时不去淡出/接管它）；`playLobbyIntro` 的 `allowed()` 增加 `!store.get().ui?.pendingJoin`（带邀请链接进页面时不盖住加入弹窗）。
3. 资源就绪：0.3.3 没有 `session.preloadReady`，图片走 `data.get('assets').ui` 的 URL；9 张素材（`entry/*`、`prepareBkg/*`）在 `data/assets.json` 里都在（逐个确认过）。

**没有并入**原包对 `hubBackdrop.js` / `title.js` / `lobby.js` 的主题替换（把大厅背景换「盟约」昼夜、标题 logo 换金字塔）：0.3.3 的标题与大厅是更新的布局（`hubScene`、版本切换、`lobbyMedia`），原包这几处是 0.2.4 的整文件改写，硬套会丢 0.3.3 的功能。开场动画本身（本包主角）100% 并入。

### 4.2 行为（与包内说明一致）

- 每次打开页面、标题页之前播一次；点击/回车/Esc 跳过。
- 音频未解锁时先出黑底「点击进入 / TAP TO START」，点一下同时解锁声音（浏览器自动播放策略）。
- 房间 / 对局 / 邀请链接不播（`selectRoute` + `pendingJoin`）；手机等横屏。
- 资源加载失败/超时不会卡住：`preloadSprites` 与 `whenResourcesReady` 都有超时，失败走 `finish(false)` 清掉整层。

### 4.3 验证

- `merge-shots/03-opening-film.png` 是运行中的一帧（金字塔 logo + STRONGHOLD PROTOCOL / ALLIANCE + 右下「点击跳过」），与包内 `standalone/index.html?t=2.6` 的参考帧构图一致。
- 无头 CDP 点击「点击进入」后动画开始，点击跳过 → 弹层移除 → 标题页出现；`exceptions=0 / consoleErrors=0`。
- 大厅流程（标题 → 输代号 → 开始 → 大厅）同样 `exceptions=0`。

---

## 5. 特效素材（`卫戍协议-素材包-20261019`）

### 5.1 核对结果：0.3.3 已是超集

| 项 | 素材包 | 0.3.3 现状 |
|---|---|---|
| `assets/` 文件数 | 31 028 | 31 599 |
| `assets/` 体积 | 1060.4 MB | 1081.5 MB |
| 仅包内有 | **2 个** | — |
| 仅 0.3.3 有 | — | 573 个 |
| 同名但大小不同 | 85 个（多为 `local/spine/{enemy,token}` 的 `.atlas`+`.png` 成对差几十字节，以及 `local/fx/index.json`、`textures.json`） | 0.3.3 的 `fx` 索引更大 |
| `fonts/` 7 个文件 | — | **sha256 全部相同** |

结论：这个素材包基本已经被 0.3.3 收进去了；**同名文件一律不覆盖**（覆盖会把 `fx/index.json` 与 Spine 图集退回更小的旧版，反而丢特效）。

### 5.2 实际并入

只新增两个 0.3.3 里没有的音频（其余 0 个新增）：

```
public/assets/audio/sfx/player/p_atk/p_atk_asndgrbm.mp3          (11 565 B)
public/assets/audio/sfx/player/p_atk/p_atk_sndshotgun_sreload.mp3 (2 157 B)
```

它们目前**没有被 `data/assets.json` 或代码按名引用**（grep 确认），属于「补档」：官方音效表若按名字取会命中，只是现在的数据不取。按交接要求「没被引用要说清原因」，原因即此。

### 5.3 验证

- 新增文件不影响启动与页面：`/healthz` 200、标题/大厅 0 异常（`merge-shots/05-final-*.png`）。
- 特效渲染路径未改动：`local/fx/index.json`、`textures.json` 保持 0.3.3 版本（更大、更新的那份）。

---

## 6. 冲突与取舍汇总

1. **delis 的 `server/index.js` / `routes.js`** 是 0.3.1 版，直接覆盖会删掉 0.3.3 的 versions / eventLoop / roomPool / llmGate。→ 只移植 6 处钩子。
2. **delis 的 `public/studio/**`** 依赖未随包提供的服务端接口。→ 不替换，保留 0.3.3 工作台，只加标题入口。
3. **背景渲染两来源**（v0.2.6 与 Forge）实现同源、且都被 0.3.3 的 `hubScene + lobbyMedia` 超过。→ 一份都不装，只验证 0.3.3 的实现可用。
4. **Forge 的 `editor`** 与 0.3.3 无文件重叠，但它的 `shared/*Authoring.js`、`server/workshop.js` 与 0.3.3 的 `shared/` 同名不同内容。→ 放独立 `forge/` 子树，改一处 import 避免拉起整棵 0.3.1 服务器。
5. **开场动画**原包是 0.2.4 分支，标题/大厅/背景三处是整文件改写。→ 只并 `allianceScene.js` + `lobbyIntro.js` + 启动调用。
6. **素材包**同名文件大小不同（85 个）→ 一律不覆盖，只补 2 个纯新增。

## 7. 回退办法

- 代码：`E:\stronghold\_merge-work\baseline-code\`（`public/js`、`public/css`、`public/studio`、`server`、`shared` 的合入前完整副本）；单文件级回退直接拷回即可。
- Forge：删掉 `E:\stronghold\Stronghold-Protocol-v0.3.3-Fusion\forge\` 与 `start-studio-editor.bat`，`package.json` 去掉 `editor` 脚本。
- 开场动画：删 `public/js/ui/allianceScene.js`、`public/js/ui/lobbyIntro.js`，去掉 `main.js` 的两行（import + 调用）。
- 素材：删上面两个 mp3。

---

## 8. 整体巡检（2026-10-25，最后一轮）

用无头 Edge 走了一遍主流程（`E:/stronghold/_merge-work/walk/report.json`，每步截图在 `merge-shots/walk-*.png`）：

| 界面 / 阶段 | 结果 |
|---|---|
| 开场动画（点击进入 → 播放 → 跳过） | ✅ |
| 标题页 | ✅ |
| 设置弹窗（语言 / BGM / 语音 / 音效 / 开关） | ✅ |
| 统计数据 | ✅ |
| 玩法说明 | ✅ |
| 输代号 → 大厅 | ✅ |
| S.W.E.E.P.报告 | ✅ |
| 干员调配（技能 / 模组 / 潜能 / 立绘全在） | ✅ |
| 成就统计 | ✅ |
| 大厅背景与音乐（5 个场景 + 自选图片/视频/音乐） | ✅ |
| 独立模拟 → 选择模拟协议（四档难度卡片） | ✅ |
| 创建房间（P1 位、干员立绘、开始模拟） | ✅ |
| 作战简报 1/2（敌方首领 / 核心盟约 / 准备就绪） | ✅ |
| 选择策略 2/2（12 张策略卡 → 确认选择） | ✅ |
| 对局内（战场、HUD、商店、BGM/资金/回合/准备就绪） | ✅ |
| 全程 `Runtime.exceptionThrown` | **0** |
| 全程 console error | **0** |

说明：这轮只走到第 1 回合的休整期（没有继续部署干员打满 9 回合），目的是确认对局界面与渲染管线正常；没有发现会挡人的问题。

---

## 9. 皮肤包（302 款官方时装 + 战斗模型）

### 9.1 来源与判断

- 皮肤数据有两部分：
  - v0.2.6 随包的 273 款（`data/skins.json` + `public/assets/char/` 的头像/半身像）；
  - 官方 `skin_table.json` 里比它新的 29 款（干员在 0.3.3 的 229 名里才可用），图片从 `yuanyan3060/ArknightsGameResource` 补。
- 0.3.3 没有 `data/skins.json`：皮肤来自**外观插件的 overlay**（`docs/SKINS.md`：`chars[charId].skins[skinKey]`，不读 `data/`），所以做成插件。
- 战斗 Spine 模型：v0.2.6 只带 174 款，缺的从 `fexli/ArknightsResource` 的 `spine/<charId>/<stem>/{Front,Back}/` 全量补；该仓库没有的（2 款 Skadi 异格）保持无模型。

### 9.2 并入方式：三个 personal 外观插件

```
plugins/official-skins-273/          607 个文件，10.9 MiB
  assets.json                        overlay：302 款皮肤的 name/group/avatar/portrait
  skins/<stem>.webp                  302 张头像（180×180）
  skins/p_<stem>.webp                302 张半身像（180×360）
  plugin.lock.json                   pack 生成的文件哈希（无模型）

plugins/official-skins-models-1/     579 个文件，175.6 MiB（192 个骨架）
plugins/official-skins-models-2/     1215 个文件，146.4 MiB（404 个骨架）
plugins/official-skins-models-3/     8 个文件，2.2 MiB（2 个骨架：Skadi 异格两款）
  assets.json                        overlay：同一批皮肤的 spine.front / spine.back
  plugin.lock.json                   动作映射（idle/deploy/attack/skill/die…，从骨架解析）
  spine/<stem>/{Front,Back}/*.skel|.atlas|.png
```

- Skadi 两款（`char_1012_skadi2@boc#4`、`@iteration#2`）在 fexli 里多套了一层 `Spine/`、且是单面模型（没有 Front/Back 目录）；单独抓进 `official-skins-models-3`，overlay 只写 `spine.front`。
- 为什么拆四个：0.3.3 单插件上限 **200 MB**；302 套模型约 320 MB，不拆装不下。图与模型分开、模型按体积分成 175.6 + 146.4 + 2.2 MiB，各自 `check: ok`。
- 用 `assets.json` 而不是把 overlay 内联进 `plugin.json`：`shared/plugins/manifest.js` 的 `inlineAssetFiles()` 会把**任何以「点 + 字母」结尾的字符串**当成素材路径，皮肤名 `日晒 SS.SP`、系列名 `i.t` 会被误判成文件路径，整个插件被判 `skipped`。外置 overlay 走 `visual.js` 的字段类型，正常。**这是 0.3.3 上游的启发式误伤，不是我们改坏的。**
- 图片从 PNG 转 **WebP q86**（302 款 × 头像+半身像），给模型腾额度。
- **默认开启四个**（只对「本机还没存过外观插件选择」的第一次生效）：`DEFAULT_PERSONAL = ['official-skins-273', 'official-skins-models-1', 'official-skins-models-2', 'official-skins-models-3']`；玩家在 设置 → 外观插件 里关掉后按玩家选择走，想回上游行为把该常量改回 `[]`。
- **老浏览器迁移**：只存过 `['official-skins-273']` 的，第一次加载会一次性补上三个模型插件并写 `sp.pref.cosmetics.models` 标记；之后玩家关掉不会再被加回来。实测：旧偏好 → 加载后四个 id 全在，清单 `withSpine = 302`。

### 9.3 验证（2026-10-25）

| 项 | 结果 |
|---|---|
| 服务器加载 | `official-skins-273 2.0.0 … models-1/2/3 1.0.0 … (cosmetic, loaded)`；`/healthz` → `content.plugins: 4` |
| 合成清单 | **302 款皮肤 / 193 名干员，302 款全部带 spine**（Skadi 异格两款也已补齐） |
| 局内模型 | `spineEntry` 抽查：老皮肤 `char_1014_nearl2@epoque#17`、新皮肤 `char_2025_shu@nlc#1`、原本没模型的 `char_230_savage@sale#17`、Skadi `@boc#4` / `@iteration#2` → 全部 `anims.idle="Idle"`、`skel` HEAD **200** |
| 图片 | 新皮肤头像/半身像全部 WebP、走 `/p/official-skins-273/…` |
| 界面 | 干员调配 → 隐现：皮肤区 3 格「默认 / 甜品大奖 / 悠然假日 HDm25」，每格图不同 |
| 异常 | 全程 `Runtime.exceptionThrown = 0`、console error = 0 |

截图：`merge-shots/skins-01.png`（皮肤区）、`merge-shots/skins-02.png`（选中后）。

> 补充：`pack` 对每个模型报一条 `anims is not a field a cosmetic plugin changes (ignored)` 属正常——动作来自 `plugin.lock.json`，不是 overlay。

### 9.4 回退

删 `plugins/official-skins-273/` 与 `official-skins-models-1/2/3` 即可；玩家的皮肤选择存在本机 localStorage，删插件后自动回退默认。若要连「默认开」也退掉：`DEFAULT_PERSONAL` 改回 `[]`。
