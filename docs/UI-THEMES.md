# 界面主题（分享包 · 逐屏接入：对局内 + 网页原版）

> 2026-11-14 第三版：**逐屏接入**。当前接入的是**对局内**那一屏；大厅 / 房间 / 标题页仍是本仓自己的实现
> （它们跟对局屏共用 `ui/components.js`，所以组件视觉会一起变，但大厅的**结构/逻辑**没有被替换）。

| 入口 | 界面 |
| --- | --- |
| `/` | 网页原版（`public/index.html` 除一行门控脚本外没动） |
| `/ui-theme-initial.html` | 卫戍协议终端：对局内 UI 用分享包 `initial` |
| `/ui-theme-closure.html` | “全能的”可露希尔：对局内 UI 用分享包 `closure`（含 AC 终端皮肤） |
| `/ui-theme.html` | 局外选择页（标题页右上角「界面」按钮进入；存 `sp.ui-theme.v1`） |

## 遮盖与立绘的修补（2026-11-14 第三批）

**① SWEEP 遮盖**：分享包的 `.sw`（S.W.E.E.P.报告根节点）自身**不写** `position/inset/z-index` ——
它靠作者 App 那层整页包裹撑开；本仓的屏是路由组件，没有那层，于是它按普通文档流排在大厅里，
看起来就是「半透明玻璃浮在大厅上」。补丁在 [ui-theme-bridge.css](../public/css/ui-theme-bridge.css)：
`html[data-ui-theme] .sw { position: fixed; inset: 0; z-index: 300; background: #050807; overflow: hidden; }`，
再给 `.sw__bg` / `.sw-body` / `.sw-top` 分层。实测：矩形 1600×900 铺满、`position:fixed`、`z-index:300`、底色不透明。
（层级约定沿用本仓：内容 < 200，主题整页屏 300，弹层 9999+，提示条 100001+，所以「干员调配 / 玩法说明」仍能开在它上面。）

**② 模拟准备页立绘**：主题房间把名片数据打包成 `{ pool, byChar, m, myId, myCard }` 传给 `seatPortrait()`；
上一版这里是空桩（返回 null），座位卡只剩一块被拉高的底板。现在
[ui-compat/js/ui/seatArt.js](../public/ui-compat/js/ui/seatArt.js) 接通了本仓完整链路：
`seatOperator(seat, {byChar,pool}, {myId,myCard})` → `seatCardSkin()` → `chessPortraitUrl(m, chess, {skin})` → `seatArtSrc()`。
实测：座位卡出现真实立绘 `<img>` 180×360（`/assets/char/portrait/…webp`），「更换立绘 / 创建者」按钮正常浮在立绘上。

顺带核对：`干员调配` 浮层本身是整页不透明、层级正确（截图 `.cache/shots/lo-probe.png`），不需要补丁。

## 第四批：观感 + 立绘按钮 + 开场动画（2026-11-14）

1. **大厅"幽灵标题"**：标题是几张图叠的 —— `season_logo.png`（三角）+ `.oh-logo__l1`（实心 STRONGHOLD PROTOCOL）
   + `.oh-logo__l2`（同一条 EN 的淡影，压住下一行）+ 中文行。逐个隐藏截图确认（`.cache/shots/layers-hide-*.png`）：
   只有隐藏 `.oh-logo__l2` 会让淡影消失而实心 EN / ALLIANCE / 中文都保留 → 补丁里隐藏它。
2. **大厅右上角不再挤**：本仓在大厅里多塞的那颗「界面 · 可露希尔」按钮（`.ui-theme-friend-stack`）与主题的
   `.oh-topbar` 挤在同一行 —— 主题下隐藏它（**标题页仍有同一入口**，不影响切换），并给 `.oh-topbar` 加一点间距。
3. **「更换立绘」挪到卡片最上方**：补丁样式把 `.rseat__pick` 改成贴在座位卡顶部居中
   （`position:absolute; top: p*6; left:50%; translateX(-50%)`）。实测按钮矩形 y=161 落在卡片（y=109）顶部区域。
4. **开场动画（第三轮）**：分享包那版 `allianceScene.js` 把「资源就绪」绑在作者分支的 `store.session.preloadReady` 上，
   本仓从不设它 → 画面不挂载、跳过不武装。安装器现在会对这个文件做一处**定点修补**
   （`patchAllianceScene`：把那一行改成 `() => true`，改不到会报警），并新增 `intro` 分组。
   实测：开场画面挂载、铺满 1366×768、点一下即跳过。

## 第五批：大厅入口与切换按钮（2026-11-14）

- **去掉大厅「无限火力 1.1」**：它是主题大厅自己的 `button.oh-fire`（作者分支的第三个模式入口，本仓的无限火力走各自模式卡）。
  补丁样式里 `html[data-ui-theme] .lobby-hub .oh-fire { display: none }`，实测 `display:none`、宽度 0。
- **「切换界面」按钮高亮 + 放大**：在 [title.css](../public/css/screens/title.css) 里给 `.title-corner__tools .title-ui-theme.btn`
  加薄荷渐变实底、深色粗字、外发光，并把高度/内边距/字号放大（12.5px → 15.8px，30px → 38px 高）。
  选择器压过主题 `components.css` 的 `.btn.btn--ghost`，所以**三套界面下观感一致**。

## 第六批：主题大厅的「拓展模式」入口（2026-11-14）

业主：「给我的拓展玩法加个入口，类似他的无限火力」。分享包的 lobby 只认它自己那四个入口（独立/联盟/无限火力/模拟邀约），
没有本仓的拓展玩法（湮灭模拟 / 炸惊模拟）。做法**不改分享包 JS**：

- 新模块 [js/ui/extensionEntry.js](../public/js/ui/extensionEntry.js)（只在主题入口 `<script type="module">` 里加载）：
  1. 在主题大厅 `.oh-fire`（原来那颗无限火力 pill，补丁样式已隐藏）旁边插一颗**同款外观**的 `拓展模式` pill（带可选玩法数徽标）；
  2. 点开后在 body 挂一层自己的浮层（`.sp-ext-entry-layer`，z-index 400），里面**直接渲染本仓的 `ExtensionHall`**
     （screens/extensionModes.js，原版大厅用的就是它）；
  3. 「进入 / 开始」时按本仓大厅同一口径建房：`net.request('room.create', { mode, difficulty, erosion? })`
     （蚀流档位只对声明了 `erosionTiers` 的玩法包发送，与 lobby.js 的 `createExtension` 一致），成功即关闭浮层。
- 补丁样式：`.oh-fire:not(.hub-ext-entry)` 才隐藏（我们自己的那颗复用同款外观类）；浮层与遮罩样式也在 bridge.css。
- 端到端实测：大厅「拓展模式 2」→ 湮灭模拟 → 进入 → 开始 → **真的建出房间**（"湮灭模拟 · 共 14 回合…"），无报错。

## 分组与进度

接入按分组叠加（`--screens inmatch,sweep,lobbybg,…`，取并集）：

| 分组 | 内容 | 状态 |
| --- | --- | --- |
| `inmatch` | 对局内 5 屏 + 20 个 UI 模块 + `render14-r3` 三件套 + closure 的 `acClosure*` | ✅ 已接（截图见 `.cache/shots/inmatch-*.png`） |
| `lobbybg` | 大厅难度选择后面那个场景组件 `ui/protocolScene.js` | ✅ 已接（组件同签名，盒模型一致；观感差异很小） |
| `sweep` | S.W.E.E.P.报告 `screens/sweep.js` | ⚠️ 试过：模块能加载、无报错无 404，但它是**整页**屏、版式依赖分享包自己的大厅外壳，单接会在本仓大厅上叠出一层半透明面板 → 挪到「大厅」那一轮一起做 |
| `lobby` / `room` | 大厅 / 房间 / 成就面板 / SWEEP 报告（共用分享包的大厅外壳，必须一起接） | ✅ 第二轮已接：大厅渲染成「物资调配处 / 模拟邀约 / 独立·同盟·联合模拟 / 搜寻队友」，房间与 SWEEP 都能打开；无 JS 异常、无溢出。**已知瑕疵**：① 大厅背景素材自带一层幽灵「STRONGHOLD PROTOCOL」字与标题叠（素材本身）；② 右上角「版本/娱乐小游戏/在线数/账号胶囊」挤在一起；③ 左上返回按钮是空底板；④ SWEEP 是半透明玻璃层压在大厅上，不像原版那样压暗背景；⑤ 房间座位卡底板被拉得偏高、底部状态条与「开始模拟」轻微重叠 |
| `intro` | 开场动画 `ui/allianceScene.js` | ✅ 第三轮已接：安装时把它读 `store.session.preloadReady` 的那行改成 `true`（本仓没有那个门控，宿主版就是 `() => true`）；实测画面挂载、铺满视口、可点击跳过 |

## 接了什么 / 没接什么

**接了**（主题文件覆盖本仓同名模块，只在主题入口生效）：

- 屏：`js/screens/game.js`、`bandDraft.js`、`briefing.js`、`loadout.js`、`settle.js`
- UI：`components.js`、`hud.js`、`shopBar.js`、`bossPlates.js`、`matchPopups.js`、`choiceOverlay.js`、
  `turnPopup.js`、`turnBanner.js`、`bondStrip.js`、`downedPlate.js`、`matchInfo.js`、`goalBanner.js`、
  `protocolBoot.js`、`shopUpFigure.js`、`stagePreview.js`、`gameLogic/panel.js`
- 渲染：`render14-r3/{units,textures,fx/arrivals}.js`（其余 `render14-r3/*` 前缀映射到本仓 `js/render/`）
- closure 专属：`js/ui/acClosure*.js`、`acTheme*.js`、`acTerminalTheme.js`
- CSS：`game / match-popups / boss-plates / draft / settle`（+ closure 的 `ac-*`）+ `fonts-ark`

**没接**（继续用本仓，避免上次那三类问题的来源）：

- `js/screens/lobby.js`、`room.js`、`sweep.js`、`title.js`、`js/ui/allianceScene.js`、`protocolScene.js`、
  `communityChat.js`、`matchFlow.js`、`achievements.js`、`officialHub.js`
  → 大厅/房间/标题/开场动画仍是我们自己的，所以**入场动画、整体比例、遮挡层都正常**。
- `achievements.js` 等分享包专用屏（本仓没有对应入口）。

**兼容层**（`public/ui-compat/`，只在 `/ui-themes/` 这个 import map scope 里生效）：

- 补导出：`accounts.PlayerName`、`gameLogic.{arenaStageRect,pendingDraftPlayers}`、`skins.portraitSkinFor`、
  `seatArt.seatPortrait`、`transitions.{LEAVE_MS,afterLeave}`、`loadoutModel.mergeSkins`、
  `constants.{difficultyName,difficultyTheme}`、`randomMode.variantRounds`、`damagePanel.RoomDamageRanking`、
  `observe.isGuichengUnite`。
- 降级桩（本仓无该功能，组件 `null` / 判定中性）：`bandSkill`、`crisisTags`、`demoMenu`、`panelDismiss`、
  `rosterScroll`、`bondBuildHints`、`bondHighlightPrefs`、`bondTracker`、`blacklist`、`screens/diySelection`、
  `shared/regions`。

## 素材

分享包 JS 里大量**动态拼路径**（`icon_' + id + '.png'`），静态扫不到。所以用
`tools/collect-theme-art.mjs`：真开页面跑几轮，把 404 的 `/ui-art/...` 从包里补进来（当前 134 个文件 / 4 MB）。
装了新版主题后重跑一次即可收敛：

```sh
node tools/install-ui-themes.mjs --pack <解包目录> --screens inmatch
node tools/collect-theme-art.mjs --pack <解包目录> --rounds 3
node tools/check-ui-themes.mjs --shots .cache/shots
```

## 验证结果（2026-11-14，`tools/check-ui-themes.mjs`）

- 三个入口：入场动画都出现、铺满视口并可点击跳过；根字号 `71.11`、标题矩形一致、溢出 `0/0`；
  记忆跳转 `/ → /ui-theme-closure.html` 正常。
- 对局内（`dev/game-mock-*.html` 三份对照截图）：主题 CSS 12/6 张生效，**无 JS 异常、无 404、无溢出**；
  closure 呈现 AC 终端皮肤（蓝色霓虹卡面、终端框、可露希尔立绘），initial 呈现原版终端样式。
- 已知小瑕疵（不影响使用，待调）：`initial` 左下「升级」卡片里等级数字与「确认升级」有轻微重叠；
  closure 顶部盟约条有个别空槽（对应盟约缺图）。

## 回退到「只皮肤」或更保守

```sh
# 只留字体 + 大厅 CSS（不接任何 JS）
node tools/install-ui-themes.mjs --pack <解包目录> --screens skin
```

## 回退到原状

删掉 `public/ui-themes`、`public/ui-art`、`public/ui-compat`、`ui-theme*.html/js`、`public/dev/game-mock-*.html`、
`public/css/ui-theme-picker.css`，并去掉 `index.html` 里 `<script src="/ui-theme-gate.js">` 与
`title.js` 里的 `<${UiThemeButton} />`。
