# SERVER-UPDATE（服务端 + 界面补丁清单）

- 打包日期：**2026-11-23（第三批，含 11-18 / 11-22 两批）**
- 来源：本机 `C:\Users\Administrator\Downloads\Stronghold-Protocol-v0.3.3-Fusion`（v0.3.3-Yuan，build `b4da1f42b0b7`）
- 包名：`SERVER-UPDATE-2026-11-23.zip`（与本文档同目录；旧的 11-18 / 11-22 包可删）
- 包内**只含**下列「改过的文件」，不含 `data/accounts.json`、`data/saves.json`、`data/social.json`、`data/account-sessions.json`、`launcher-config.json`、`.cache/`、`node_modules/`。

> **11-22 第二批新增的三件事**（详见 §1.10 / §2.18 / §2.19）：
> 1. 后台「弹窗公告」新增 **＋ 新建公告**（独立条目，不覆盖/不追加已有公告）+ **公告列表**（逐条 启用/停用/删除）；
> 2. **服务器关闭**时标题页开始键：变红、不可点、文字改成「服务器关闭」（后台「关闭服务器」后 2 秒内生效）；
> 3. **服务器关闭时把所有人踢到标题页**：关服帧到达即断线、不自动重连、清掉房间/对局并回到标题页，恢复开服后点「开始」即可重连。

> ⚠️ 目标机如果是 `E:\stronghold\merge-040`（0.4.0 合并树）：这份补丁是在 **0.3.3-Yuan** 上做的。
> 凡是 0.4.0 里已经改过的同名文件（`versions.js`、`admin.js`、`lobby.js`、`game.js`、`briefing.js`、`bandDraft.js`、`extensionEntry.js`、`title.css`、`components.css`、`deploy-public.ps1`、`proxy.js`），
> **请先 diff 再合并，不要整文件覆盖**；纯新增文件可以直接放（见文末「包内清单」标记 `新增`）。

---

## 0. 一分钟应用步骤

1. 备份目标机的 `data/` 与 `public/ui-layout.json`（可选）。
2. 把 zip 解压到仓库根目录，按同名路径覆盖。
3. **服务端**改动（`server/**`、`data/versions-policy.json`）→ 重启 `node server/index.js`。
   **客户端**改动（`public/**`）→ 玩家浏览器刷新即可（数字图已带 `?v=2`，不吃旧缓存）。
4. 按第 6 节「验证清单」逐条点一遍。

---

## 1. 服务端（重启后生效）

### 1.1 `server/versionPolicy.js` —— 新增

- **作用**：从数据目录读 `versions-policy.json`，在启动时把「暂未开放」的版本从配置里摘掉。
- **接口**：
  - `readVersionPolicy(dataDir)` → `{ disabled: string[], hint: string }`（文件不存在/坏掉时返回空策略，不抛错）。
  - `applyVersionPolicy(cfg, policy)` → 原地把 `cfg.versions.list` 里 `disabled` 的版本剔除；`act2autochess` 是默认版本，**不允许**禁（会被忽略）。
- **怎么接**：见 1.4。

### 1.2 `data/versions-policy.json` —— 新增

```json
{
  "disabled": ["act3autochess", "act2autochess@V2_1", "act1autochess", "act1autochess@V1_1"],
  "hint": "暂未开放"
}
```

- 只留「第二期下半」（默认版）可玩；其余 4 个版本在 UI 上灰显。
- 想放开某个版本：从 `disabled` 里删掉它的 id，重启即可；**删掉整个文件 = 全部放开**。

### 1.3 `server/versions.js` —— 修改

- `createVersionSets({ ..., blocked, blockedHint })`：多收两个参数（被禁版本 id 列表 + 提示文案）。
- `welcome()`：被禁版本**仍然下发**，但条目变成锁定形态：
  `{ id, family, label, roomModes, disabled: true, reason: '<hint>' }`，且**不带 `cs`**（没有内容集，客户端不可能切过去）。
- `stats()`：多返回 `blocked`，给 `/healthz` 用。

### 1.4 `server/index.js` —— 修改

- 新增导入：`readVersionPolicy` / `applyVersionPolicy`。
- 启动早期：读策略 → 应用到 `cfg`，再把 `blocked` / `blockedHint` 传给 `createVersionSets`。
- 启动日志多一段：`[versions] enabled: … · 暂未开放: act3autochess, act2autochess@V2_1, …`
- 管理后台构造处补 `social: () => socialStore`（删除账号时要用它清社交数据）。

### 1.5 `server/http/routes.js` —— 修改

- `/healthz` 的 `versions` 里新增 `blocked: [...]`（排障/自动化验证用）。

### 1.6 账号管理：`server/accounts/store.js`、`social.js`、`service.js` —— 修改

- `store.js` 新增 `remove(id)`：从 accounts、用户名索引、saves、sessions 里整体删掉。
- `social.js` 新增 `purge(id)`：清自己的 4 张表（friends / requests / 已发送 / 屏蔽），并把 id 从**别人**的这些列表里剔除。
- `service.js` 新增：
  - `adminRename(accountId, nickname)`：管理端改名，跳过玩家改名冷却（仍然走 `assertMutable` 校验）。
  - `remove(accountId)`：删除账号（含存档/会话/社交）。

### 1.7 `server/admin.js` —— 修改

- `API_ROUTES` 增加两条：
  - `POST /api/accounts/rename` `{ accountId, nickname }`
  - `POST /api/accounts/delete` `{ accountId }`
- 删除分支：先 `social()` 拿到 `socialStore` → `purge(id)`，再 `network.dropAccount(id)` 踢下线。

### 1.8 `server/admin.html` —— 修改

- 账号列表每行多两个按钮：**改名**（`data-acc-rename`，`prompt` 输入新昵称）、**删除账号**（`data-acc-delete`，二次确认 + 要求输入该账号 QQ 号）。
- 事件用委托绑定，行重渲染后仍然有效。

### 1.9 `server/match/host/proxy.js` —— 修改（重要 BUG 修复）

版本局 / 插件局的 `room.match` 是 `HostProxy`，之前**没有** `setPause` / `finish`：

- 新增 `setPause(playerOrSession, on)`：把 `g.pause { on }` 转发给 worker（暂停是**对局级**的，第一个参数只用来取 playerId；session / playerState / id 三种写法都接受）。失败只记 debug 日志，不抛。
- 新增 `finish(summary)`：转发 `g.leave`（`defeat: summary.victory === false`），让「结束暂离的模拟」在版本局/插件局也能走正常结算。

**修的线上症状**：日志里的 `[lobby] 暂停失败 TypeError: room.match.setPause is not a function`；
暂离后对局时钟照走 → 玩家不在也超时判负；结束暂离拿不到结算帧。

### 1.10 `server/admin.js` —— 修改（公告：新建 / 启用停用 / 删除）

`POST /admin/api/announcement` 的请求体新增两种形态（旧调用完全不受影响）：

1. **新建一条独立公告**

```json
{ "mode": "new", "title": "可选", "text": "正文", "level": "info|warning|urgent", "hours": 24, "permanent": false }
```

- 生成唯一 id `admin-<YYYYMMDD>-<4 位随机>`，`startAt = 现在 - 60s`，追加到 `announcements[]`（保留已有条目，最多 100 条，超出丢最旧的）。
- `hours: 0` 或 `permanent: true` → `durationSeconds: 0`（永久，`endAt = null`）。
- 返回 `{ ok, mode:'new', id, note, doc }`；正文为空 → 400。
- 与原有 `mode:'append'`（默认，同一天追加到第一条）/ `mode:'replace'`（覆盖第一条）的区别：**new 不碰任何已有条目**。注意「追加/覆盖」现在也会**保留其余条目**（以前会整表重写成 1 条）。

2. **单条操作**

```json
{ "action": "enable|disable|delete", "id": "admin-20261122-abcd" }
```

- 找不到 id → 404；删除后条目从 `announcements[]` 移除。
- 所有写入仍然先 `parseAnnouncements()` 校验，再 `写 tmp → rename` 原子替换，坏内容不会落盘。

### 1.11 `server/admin.html` —— 修改（公告面板）

- 「弹窗公告」里新增两颗/两块：
  - **＋ 新建公告**（`#btn-ap-new`）：用当前表单里的标题/正文/级别/持续，发 `mode:'new'`，另起一条；
  - **公告列表**（`#ap-list`，刷新按钮 `#btn-ap-list`）：逐条显示 状态（生效中 / 未开始 / 已过期 / 已停用）、级别、起止时间、id，并带 **停用/启用** 与 **删除**。
- 「保存弹窗公告」成功后同时刷新表单与列表；`撤下` 仍然清空全部（保持原语义）。

### 1.14 `server/admin.js` —— 修改（后台「直接登录他人账号」接口）

- 新增 `POST /admin/api/accounts/login-as`（需要 `x-admin-password`）：
  - 入参 `{ id }` 或 `{ qq }`（同一个 QQ 命中多个账号时 409，要求改用 id）；
  - 校验账号存在（404）、未封禁（400）；
  - `accounts.createSession(acc.id)` 签发会话 → `Set-Cookie: sp_acc=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=30天`
    （与 `server/accounts/http.js` 的登录 cookie 同一口径）；
  - 返回 `{ ok:true, account:{ id, nickname, tag, qq } }`，并记 `[admin] 直接登录账号 …` 日志。
- **不会**踢掉玩家自己的会话——后台只是给这个浏览器加了另一个客户端。
### 1.15 `server/lobby.js` —— 修改（进入账号后自动回到原来的房间）

业主 2026-11-24「进入账号后仍要保留房间」：新增 `Lobby.adoptAccountRoom(session)`，在 **hello（新会话）** 时调用
（`onHello` 的 `!resumed && !repeat` 分支）：

- 只处理**独立模拟**的两种保留形态：`kind:'away'`（座位还在、对局/房间原样，直接走 `unparkSoloRun` 接管座位）
  与 `kind:'parked'`（备战阶段离开、房间被停放、座位已清空，找空位重新坐下并接管房主）；
- 前置条件：会话已绑定账号、当前不在任何房间、`parkedSoloOf(accountId)` 能找回；
  `away` 形态要求 `seat.connected === false`，所以**不会抢在线玩家的座位**；
- 接回后 `broadcastState` + `sendState`，客户端收到 `room.state` 直接落到房间（不用再点「继续游戏」）。

**实测**（测试实例 3162）：账号 A 建独立模拟 `2596` 并开局 → 关闭 socket、清掉本标签的重连 token → 重新加载页面
（= 新会话）→ 点「开始」→ `store.room.code === '2596'`、路由回到 `game`；服务端日志：
`[lobby] 2596 独立模拟已回到对局`。
### 1.12 `server/http/routes.js` —— 修改（关服时 `/healthz` 只回版本号 + status:'closing'）

业主 2026-11-23：后台「关闭服务器」后 `/healthz` **不再**返回在线人数 / 房间 / 版本列表等细节，只回：

```json
{ "version": "0.3.3-Yuan", "status": "closing" }
```

- 仍然是 HTTP **200**（进程活着），只是 body 变成最小形态；
- `/api/ping` 保持不变（关服仍 503 `{ok:false, closed:true, ...}`，服务器列表站用它判离线）；
- 标题页、构建守卫（buildGuard）都按 `status === 'closing'` 或「读不到 build」处理关闭态，不会误报。

### 1.13 `server/feedback.js` —— 修改（新增 `GET /api/feedback/mine`）

- 玩家在设置里看「我的历史反馈」用：按当前登录账号（cookie → accountId）过滤自己的反馈，新的在前。
- 返回 `{ ok:true, items:[{ id, at, text, status:'open'|'resolved', reply, repliedAt }] }`；
  没登录 → `401 { ok:false, error:'AUTH_REQUIRED' }`；非 GET → 405。
- `POST /api/feedback` 的提交行为不变（限流、诊断信息、昵称#tag 都照旧）。

---

## 2. 客户端（刷新页面生效）

### 2.1 `public/js/versions.js` —— 修改

- `sanitizeVersions`：接受服务端下发的锁定条目（`disabled: true`、`cs: null`）。
- 新增 `isLockedVersion(v)`。
- `lobbyVersion()` / `setLobbyVersion()`：自动跳过锁定版本（不会把大厅记忆版本切到锁着的）。
- 新增 `isPlaySetRoom(room)` + **重写 `needsContent(room)`**：

```js
const PLAY_SET_DIFFICULTIES = new Set(['ZHAJING', 'ANNIHILATION']);
export const isPlaySetRoom = (room) => !!room && (PLAY_SET_DIFFICULTIES.has(room.difficulty)
  || /_zhajing$|_annihilation$/i.test(String(room.modeId || '')));
export const needsContent = (room) => !!room && !isPlaySetRoom(room)
  && ((!!room.content && room.content.vanilla === false) || typeof room.version === 'string');
```

**修的症状**：炸惊/湮灭房「开始模拟」一直灰着、提示「仍有博士未载入房间的插件内容」——
玩法包房为了锁版本会带 `version` 字段，旧逻辑把它当成"要等版本内容"。

### 2.2 `public/js/ui/versionPicker.js` —— 修改

- 锁定行：加 `is-locked`、灰显、徽标「暂未开放」、说明「该版本暂未开放，无法切换」。
- 点击锁定行：不切换，只 `toast(v.reason || '暂未开放', 'warn')`。

### 2.3 `public/css/components.css` —— 修改

- 新增 `.verpick__row.is-locked`（灰度 + `cursor: not-allowed`）与 `.verpick__badge.is-locked`（琥珀色）。

### 2.4 `public/js/screens/stats.js` —— 修改

- `versionOffered` 统计排除锁定版本（成就统计里不再出现被禁版本）。

### 2.5 `public/js/ui/extensionEntry.js` —— 修改（新增「超限模拟」入口）

- 主题大厅（可露希尔 / 终端）里，在「拓展模式」左边再插一颗 **「超限模拟 ∞」**：
  类名 `oh-fire hub-inf-entry`，`data-testid="lobby-infinite-entry"`。
- 点击按本仓口径建房：`net.request('room.create', { mode: 'solo_infinite' | 'coop_infinite', difficulty: 'ABYSS' })`；
  单人/同盟看 `localStorage['sp.pref.lobby.simulation']`（`solo` → `solo_infinite`，否则 `coop_infinite`）。
- `ensureEntry()` 现在分别补两颗入口，互不阻塞；大厅重渲染被删掉会自动补回。

### 2.6 `public/css/ui-theme-bridge.css` —— 修改

- 隐藏分享包「无限火力」的规则改成：

```css
html[data-ui-theme] .lobby-hub .oh-fire:not(.hub-ext-entry):not(.hub-inf-entry) { display: none; }
```

- 新增 `.hub-inf-entry` 定位（`right: calc(var(--p,1px) * 470)`，摆在拓展模式左侧）与紫色配色（`#a855f7`）。

### 2.7 `public/css/screens/title.css` —— 修改（标题页页脚）

- `.title-foot`：`bottom: calc(max(5px, .05rem) + .22rem)`，改为列向 flex；
  `--legal` 不换行、`> span { margin-left: auto }`；
  `.title-thanks` 高度钳制 `max(1.15em, 18px)` + `overflow: hidden`；
  `.title-foot__meta` 不换行。
- `.title-tag` 上边距 `.12rem → .18rem`。
- `@media (max-width: 760px)` 隐藏左上角装饰 `.title-corner--tl`。

**修的症状**：页脚「版权/项目仓库/版本号/SERVER-1」几行字叠在一起。

### 2.8 `public/ui-layout.json` —— 修改（可选）

- 删掉 13 条过期布局项（8 条标题页页脚/致谢 + 5 条顶栏）。
- 它们是历史编辑留下的 `translate: -0.26rem 0.655rem` 之类，会把页脚文字压到同一行。
- ⚠️ 这个文件带**你的本地布局**：目标机如果自己调过布局，请不要整文件覆盖，只按需删除同名 entry。

### 2.9 `public/ui-themes/closure/css/screens/title.css` —— 新增

可露希尔标题页的 AC 终端皮肤：青色 `#59F3FE`、面板 `#08121a`、角标括号、青色主按钮。
全部规则限定在 `html[data-ui-theme="closure"]` 下，只改颜色不改布局。
（`.cross` 用渐变而不是纯色，保持 "+" 形状。）

### 2.10 `public/ui-themes/closure/css/screens/briefing.css` —— 新增

1. `.brief-reroll`（重刷本局条）挪到标题栏槽位：`top: .18rem; left: 38%; right: 18%`；`≤1100px` 时回到底部居中。
2. 盟约区字体：`.brief-bonds .num`、`.brief-bond__ban`、`.bond__count`、`.bond__name` → `ArkWide` / `ArkCN`。
3. 青色点缀：`.stephead__title .num`、`.brief-ready__txt > b.num`。

### 2.11 `public/ui-themes/closure/css/screens/numfont.css` —— 新增

- 10 条 `.numfont__d--N::after` 的 mask 指向 `/ui-art/img/official/hub/ac/battle/numfont/digit_N.png?v=2`，`mask-size: 100% 100%`。

### 2.12 `public/ui-art/img/official/hub/ac/battle/numfont/digit_0..9.png` —— 替换

- 换成 **32×68** 的完整数字格（原来是被裁过的 29×31 / 14×31 碎片，放大后倒计时数字糊成一团）。

### 2.13 `public/ui-theme-closure.html` / `public/dev/game-mock-closure.html` —— 修改

- `<head>` 里追加 3 个主题 CSS：`title.css`、`briefing.css`、`numfont.css`。

### 2.14 主题 `screens/briefing.js`（two themes）—— 修改

`closure` 与 `initial` 各一份，原来直接 `bonds: gd.list('bonds')`（全量，含炸惊专属），改为：

```js
import { officialBonds } from '/js/ui/zjView.js';
const info = matchInfoModel(pub, { bonds: officialBonds(gd.list('bonds'), pub?.modeId ?? pub?.difficulty), ... });
```

**修的症状**：常规局「确认本局信息」出现 S.E.E.S、颂乐人偶（它们带 `zjOnly: true`，只该出现在炸惊）。

### 2.15 主题 `screens/bandDraft.js`（two themes）—— 修改

- 选策略页「本局信息」弹窗的 `matchInfoModel` 同样包一层 `officialBonds(...)`。

### 2.16 主题 `screens/game.js`（two themes）—— 修改（惊变页用原版 UI）

- 新增导入：

```js
import { JibianOverlay, ensureJibianCss } from '/js/ui/jibian.js';
import { isJibianDraft } from '/js/ui/gameLogic/phases.js';
ensureJibianCss();   // 自动挂 /css/screens/jibian.css
```

- 组件内：

```js
const [jibianRerollBusy, setJibianRerollBusy] = useState(null);
const jibianDraft = sp && isJibianDraft(pub) ? sp : null;
const jibianOwn = !spectator && priv && priv.jibian ? priv.jibian : null;
```

- 渲染 `SP_DRAFT` 时分流：惊变草稿 → 原版 `JibianOverlay`（`rerollsLeft` / `onReroll` 走 `actions.cardRefresh` → `g.cardRefresh`，**每张卡一次重抽**）；其它玩法仍用主题自己的 `ChoiceOverlay`。

**修的症状**：可露希尔/终端主题里炸惊「选择惊变」没有重抽（分享包那版根本不认识惊变）。

### 2.17 主题 `screens/lobby.js`（two themes）—— 修改（结束模拟确认）

- `endParked()` 恢复为**单次**确认，文案改成破坏性动作：
  标题「结束模拟（判负）」、正文「…结果记为失败，房间会被关闭且无法恢复…」、按钮「结束并判负」。

**修的症状**：上一版加的第二道确认看起来像「又出现一次结束模拟」。

### 2.18 `public/js/screens/title.js` + `public/css/screens/title.css` —— 修改（服务器关闭 → 开始键变红）

- `TitleScreen` 新增 `serverDown` 状态：`useEffect` 里循环探 `GET /healthz`（`cache: 'no-store'`，3 秒超时；
  正常 5 秒一次、失败 2 秒一次），判定规则两条：
  1. `fetch` 抛错 / 非 2xx —— 进程没起或端口不通；
  2. 2xx 但 body 里 `closed === true` —— 后台点了「关闭服务器」（`server/http/routes.js` 在 gate 关闭时这么写，HTTP 仍是 200）。
- 关闭时：
  - 已登录的「开始」键（`.tentry__start`）加 `is-down` 类、`disabled`、文字换成 **服务器关闭**，右侧箭头收起；
  - 未登录/无账号系统的「开始」Button 换成 `variant="danger"`、同样禁用、文字 **服务器关闭**；
  - 状态行文案改成「服务器已关闭」，圆点转红。
- CSS：`.tentry__start.is-down` = 红底 `#c0393f`、白字、`opacity: 1`（覆盖 `:disabled` 的 .45 灰）、`cursor: not-allowed`、hover 不再提亮。
- 服务恢复后下一次探活成功即自动变回「开始」/绿色，**不需要刷新页面**。

**实测**（测试实例 3148）：开服时按钮 `开始` / `rgb(80,224,176)`；`POST /admin/api/gate {open:false}` 后 9 秒内变成
`服务器关闭` / `class="tentry__start tapx is-down"` / `rgb(192,57,63)` / `disabled=true`；`{open:true}` 后恢复。

**11-23 追加（业主：重开服后不刷新也要能点进去）**：

- 关服时客户端被 `net.close()` 主动断开且**不再自动重连**（见 2.19），只把按钮复原的话 `!online` 会让「开始」永远是灰的，
  只能刷新——所以：
  1. 探活循环记住上一次结果，**一旦从「关闭」翻回「开启」就 `net.connect()`** 主动重连（`_manualClose` 由 connect 清掉）；
  2. 「开始」的 `disabled` 只跟 `serverClosed` 走（服务开着就能点），不再要求 socket 已经 online；
  3. `start()` 第一行 `net.connect()`：即使探活还没跑回来，点一下也会立刻重新握手 + `enterSession`。
- 实测（测试实例 3155，账号模式）：进入大厅 → 关服被踢（`route=title / conn=closed`，按钮「服务器关闭」灰）→
  **不刷新**重开服 → 9 秒内 `conn=online`、按钮「开始」可点 → 点击 → `route=lobby / entered=true`；游客模式（3154）同样通过。

### 2.19 `public/js/main.js` + `public/js/net.js` —— 修改（关服把所有人踢到标题页）

- `net.js` 新增 `CLOSE_SERVER_CLOSED = 4004`（服务端 `server/admin-live.js` 关服时逐条关闭 socket 用的码）。
  `_onClose` 里命中 4004 时：**不自动重连**（`_manualClose = true`、状态 `closed`），并补发一次
  `server.closed { open:false }` —— 这样即使关服帧没赶上（刚连上就被踢），客户端也走同一套处理。
- `main.js` 的 `server.closed` 处理器（`open === false`）现在会：
  1. `net.close()` —— 断线且不重连；
  2. `backToLobby()` —— 清 `room` / `match` / 聊天 / 弹窗；
  3. `session.entered = false` —— `selectRoute()` 因此返回 `title`，**对局中的玩家也直接回标题页**；
  4. toast「服务器已关闭：<原因>」。
- 同一轮关服会先后触发两次（帧 + 4004 补发），按 3 秒时间戳去重，只处理一次、只弹一个 toast。
- 恢复开服后：标题页探活变绿 → 点「开始」→ `net.connect()` 会清掉 `_manualClose` 重新握手；
  之前被暂离的独立模拟仍在，按大厅「继续游戏」即可回去。

**实测**（测试实例 3149，`SP_ACCOUNTS=off`，从大厅关服）：关服前 `route=lobby / conn=online`；
`{open:false}` 后 5 秒内 `route=title / conn=closed / 1 个 toast「服务器已关闭：维护中」`；
`{open:true}` 后标题页「开始」恢复可点。

### 2.20 `public/css/screens/title.css` + `public/js/screens/title.js` —— 修改（关服时的闪烁红光）

业主 2026-11-23「关服时标题页边框有闪烁的红光，中间的登录框的边界也一样」：

- 根节点在关闭时加 `is-server-closed` 类（`title.js` 里 `${serverClosed ? ' is-server-closed' : ''}`）。
- CSS 两组 1.8s 呼吸动画：
  - **整页边框**：`.title-screen.is-server-closed::after` —— 固定层 inset 红光（2px 边框 + 80px 内辉光），`sp-closed-glow` 透明度 0.3↔1；
  - **中间登录卡**：`.title-login`（未登录）/ `.tentry__acct` + `.tentry__start`（已登录）—— `sp-closed-frame` 同步闪边框色 + 外发光，`.title-login::before` 的顶部亮条也变红并闪。
- `prefers-reduced-motion: reduce` 时保持静态红光、不闪（无障碍）。

**实测**（测试实例 3151，关服后把 reduced-motion 规则临时去掉）：根节点 `screen title-screen is-server-closed`，
登录卡 `animationName=sp-closed-frame / 1.8s`，整页 `::after` `animationName=sp-closed-glow`，
`box-shadow` 为 `rgba(226,72,72,.85) 0 0 0 2px inset, … 80px inset`。

### 2.21 `public/js/ui/settings.js` —— 修改（设置里的「我的历史反馈」）

- 「问题反馈」卡片下方新增可折叠块 **我的历史反馈 / MY FEEDBACK**（`data-testid="feedback-history"`）。
- 展开时 `GET /api/feedback/mine`：逐条显示 提交时间、状态（待处理 / 已解决）、「管理员已回复 / 暂无回复」、
  正文（保留换行），有回复时下面跟一块绿边「管理员回复」；没登录 → 「登录后才能查看自己的反馈记录。」
- 失败/空列表都有对应提示；加载状态会显示「加载中…」。

### 2.26 `public/js/ui/cloudSave.js` + `title.js` + `main.js` —— 修改（换号后成就统计读到的是本地数据）

业主 2026-11-24「登录其他账号时没有正常加载他的成就统计，反而读的是本地的」：

- 根因：`installCloudSave` 在登录时**无条件** `mergeSave(本地)`，把浏览器里上一个账号的
  stats/loadout/skins/namecards/settings 合并进新账号，再把合并结果写回本地 —— 于是新账号看到的是「本地+自己的并集」。
- 修法：给云存档记一个**归属** `localStorage['sp.saveOwner']`（不参与云同步），登录时按 `accountId` 判断：
  - 归属为空（老玩家首次迁移）或**就是本账号** → 保持原来的合并逻辑（本地战绩不丢）；
  - 归属是**别的账号** → **绝不合并**：清空受管本地字段 → 拉该账号云端存档 → `applySnapshot` 覆盖本地 →
    记下新归属；并回调 `onAccountSwitched()`（`title.js` / `main.js` 里让它**刷一次页面**，把内存里的统计/调配换掉）。
- 两处调用都传了 `accountId`：`title.js` 登录成功、`main.js` 启动时已登录。

**实测**（测试实例 3163）：

1. 账号 A：本地写 `stats.probe=A` → 登录 A（首次迁移）→ A 的云端 `stats.probe=A`，`saveOwner=A`；
2. 切到账号 B（同一浏览器）→ `saveOwner=B`、本地 `sp.pref.stats` **被清空**、B 的云端字段为空
   （A 的统计**没有**被并进 B）；
3. 再用后台 `login-as` 切回 A → 本地 `sp.pref.stats` 恢复为 `{"probe":"A"}`、`saveOwner=A`。
### 2.25 后台「快捷操作」+ 客户端观战深链（业主 2026-11-24）

**后台**（`server/admin.html`）新增一张「快捷操作 QUICK」卡片，放在「服务器」卡片下面：

- **观战该房间**：输入房间码 → `window.open('/?room=<CODE>&spectate=1')`（新标签页；弹窗被拦则当前页跳转）；
- 房间列表每一行的操作列也加了「观战」按钮（`data-spec`），不必手输房间码；
- **以该账号登录**：输入 QQ 或点账号行新加的「登录」按钮 → `POST /admin/api/accounts/login-as` → 换 cookie →
  0.7 秒后 `location.href = '/'`，游戏页就是该账号身份；两处都有二次确认。

**客户端**（`public/js/main.js` + `screens/lobby.js`）：

- `screens/lobby.js` 新增 `parseSpectateParam(search)`：认 `spectate=1` / `spectate` / `type=spectate` / `type=room.spectate`；
- `main.js` 启动时读它 → `ui.pendingSpectate`；深链进房时 `joinKnown(spectate ? 'room.spectate' : 'room.join', code)`
  （与大厅「观战」按钮同一条协议，观战名额/测试房确认都由 `joinKnown` 处理）。

**2026-11-24 修复（线上「游戏脚本加载失败」）**：第一版把 `parseSpectateParam` 从 `./screens/lobby.js` 导入 `main.js`，
而主题入口（可露希尔 / 终端）的 import map 会把 `/js/screens/lobby.js` 换成分享包那份**没有这个导出**的 lobby.js，
整张模块图因此解析失败、页面停在「加载时间较长…」。现已把该函数**内置进 `main.js`**（不再跨模块导入）；
三套入口实测均正常启动、无异常。

**实测**

- 测试实例 3160：注册账号 → `POST /admin/api/accounts/login-as {id}` → 200 + 拿到 `sp_acc` cookie →  `GET /api/account/me` 用该 cookie 返回的就是目标账号；改用 `{qq}` 同样 200；
- 解析器：`?room=ABCDE&spectate=1|spectate|type=spectate` → true，`?room=ABCDE` → false；
- 线上：`/admin` 已含快捷卡片与「登录」按钮；`login-as` 无口令 401、未知 id 404（证明路由已挂载）。
### 2.24 主题 `screens/loadout.js`（two themes）+ `ac-theme-closure.css` —— 修改（干员皮肤选择恢复）

业主 2026-11-23「切换皮肤功能不见了……是干员皮肤选择」：

- 根因：两个主题的 `loadout.js` 都写成 `<${SkinSection} chess=${chess} />`，而共享组件
  `public/js/ui/skinPicker.js` 的签名是 `SkinSection({ charId })` —— 传 `chess` 让 `charId` 为空，
  组件直接 `return null`，于是可露希尔 / 终端两套界面里**皮肤区整块不渲染**（网页原版一直是 `charId=${chess.charId}`，正常）。
- 改动：两个主题各一行 —— `<${SkinSection} charId=${chess.charId} />`
  （`public/ui-themes/closure/js/screens/loadout.js`、`public/ui-themes/initial/js/screens/loadout.js`）。
- 配套样式（另一个会话已补，随包一起带）：`public/ui-themes/closure/css/screens/ac-theme-closure.css`
  新增 `.lo-sec--skin .lo-skins { grid-template-columns: repeat(3, minmax(0,1fr)); gap: .28rem; }` 与
  `.lo-skin__name` 两行截断；窄屏降到 2 列。

**实测**（测试实例 3156，两套主题各一遍）：进入大厅 → 物资调配处 → 点任意干员 →
`[data-testid=skin-section]` 出现，`.lo-skin` 3 块（默认 / 甜品大奖 / 悠然假日），闭包主题为 3 列（129.56px×3）；
点第 2 块后 `localStorage['sp.pref.skins'] === {"char_498_inside":"char_498_inside@kitchen#2"}` 且该块 `is-on`。
### 2.23 `public/css/ui-theme-bridge.css` —— 修改（主题大厅恢复「界面」切换按钮）

业主 2026-11-23「切换皮肤功能不见了，把它弄回来」：主题大厅原本有一条

```css
html[data-ui-theme] .lobby-hub .ui-theme-friend-stack .title-ui-theme { display: none; }
```

把「界面 · 可露希尔」那颗按钮藏掉了（2026-11-14 为了不挤 topbar 加的）。现在改为**不再隐藏**：

```css
html[data-ui-theme] .lobby-hub .ui-theme-friend-stack { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: calc(var(--p, 1px) * 6); }
html[data-ui-theme] .lobby-hub .ui-theme-friend-stack > * { flex: 0 0 auto; }
html[data-ui-theme] .lobby-hub .ui-theme-friend-stack .title-ui-theme { display: inline-flex; }
```

- 右上角那一簇恢复成「好友 | 界面 · 可露希尔 | 版本 | 在线人数」，挤不下时换行，不再压扁按钮；
- 点「界面 · 可露希尔」会打开「界面主题」（网页原版 / 卫戍协议终端 / 可露希尔 / 乌萨斯），切换后整页重载。

**实测**（测试实例 3156，可露希尔大厅 1366×768）：`.ui-theme-friend-stack` 可见（180×26），
里面的 `.title-ui-theme` 可见（114×26，文字「界面 · 可露希尔」）；点击后「界面主题」选择页正常弹出（四个主题卡）。
### 2.22 `public/js/screens/auth.js` —— 修改（注册昵称留空）

- `useState('博士')` → `useState('')`：注册表单的「昵称」一栏**不再预填**；
  占位提示从「默认「博士」」改为「输入昵称（2–12 字）」。空着提交仍按服务端默认「博士」处理（行为不变）。

**实测**：打开注册页，昵称输入框 `value === ''`、`placeholder === '输入昵称（2–12 字）'`。

---

## 3. 启动/部署脚本（可选，按需拷）

### 3.1 `部署公开服务器.cmd` —— 新增（**GBK / 936 编码**）

- 双击即调 `deploy-public.ps1`；带 `--no-open` 则不自动开浏览器。
- 结束会打印后台地址与公网地址。

### 3.2 `deploy-public.ps1` —— 新增（**UTF-8 with BOM**，缺 BOM 会解析失败）

- 先探 `http://127.0.0.1:3000/healthz`；已在跑就直接报告。
- 没跑：用 WMI `Win32_Process.Create` 以 `cmd.exe /c ""<node>" server\index.js >> "<log>" 2>> "<err>""` **分离**启动（不挂管道，父进程退出不影响服务）。
- 最多等 90 秒，日志写 `.cache/deploy.log`。

### 3.3 `修复启动器.cmd` —— 新增（**GBK / 936 编码**）

- 结束 `Stronghold*` 与 `msedgewebview2` 进程，把 `%LOCALAPPDATA%\StrongholdProtocol\WebView2` 改名成 `.bak-<时间戳>`。
- 用于启动器报 `COMException 0x800700AA 请求的资源在使用中`（WebView2 用户数据目录被占）。

---

## 4. 文档（可选）

- `docs/FIX-2026-11-17-closure-ui.md` —— 可露希尔 UI 故障复盘（主题皮肤、页脚、重刷本局、盟约字体、倒计时数字）。
- `docs/VERSIONS-AND-ADMIN-2026-11-17.md` —— 版本封禁策略 + 管理后台改名/删号。
- `docs/DEPLOY-PUBLIC-SERVER.md` —— 公网部署 / 开机自启 / 防火墙与端口映射。

---

## 5. 包内清单（相对仓库根）

```
SERVER-UPDATE.md                              ← 本文档
data/versions-policy.json                     新增
deploy-public.ps1                             新增（UTF-8 BOM）
部署公开服务器.cmd                             新增（GBK）
修复启动器.cmd                                 新增（GBK）
docs/DEPLOY-PUBLIC-SERVER.md                  新增
docs/FIX-2026-11-17-closure-ui.md             新增
docs/VERSIONS-AND-ADMIN-2026-11-17.md         新增
server/versionPolicy.js                       新增
server/versions.js                            修改
server/index.js                               修改
server/http/routes.js                         修改
server/accounts/store.js                      修改
server/accounts/social.js                     修改
server/accounts/service.js                    修改
server/admin.js                               修改（11-22：公告新建/启用停用/删除）
server/admin.html                             修改（11-22：＋新建公告 + 公告列表）
server/match/host/proxy.js                    修改
public/js/versions.js                         修改
public/js/screens/title.js                    修改（11-22/23：服务器关闭 → 开始键变红「服务器关闭」+ 闪烁红光）
public/js/screens/auth.js                     修改（11-23：注册昵称留空）
public/js/ui/settings.js                      修改（11-23：我的历史反馈）
server/feedback.js                             修改（11-23：GET /api/feedback/mine）
public/js/main.js                             修改（11-22：关服 → 踢回标题页）
public/js/net.js                              修改（11-22：4004 关服码不自动重连）
public/js/ui/versionPicker.js                 修改
public/js/ui/extensionEntry.js                修改
public/js/screens/stats.js                    修改
public/css/components.css                     修改
public/css/screens/title.css                  修改
public/css/ui-theme-bridge.css                修改
public/ui-layout.json                         修改（可选，见 2.8）
public/ui-theme-closure.html                  修改
public/dev/game-mock-closure.html             修改
public/ui-themes/closure/css/screens/title.css       新增
public/ui-themes/closure/css/screens/briefing.css    新增
public/ui-themes/closure/css/screens/numfont.css     新增
public/ui-themes/closure/js/screens/briefing.js      修改
public/ui-themes/closure/js/screens/bandDraft.js     修改
public/ui-themes/closure/js/screens/game.js          修改
public/ui-themes/closure/js/screens/lobby.js         修改
public/ui-themes/initial/js/screens/briefing.js      修改
public/ui-themes/initial/js/screens/bandDraft.js     修改
public/ui-themes/initial/js/screens/game.js          修改
public/ui-themes/initial/js/screens/lobby.js         修改
public/ui-art/img/official/hub/ac/battle/numfont/digit_0.png … digit_9.png   替换
```

---

## 6. 验证清单（按顺序点）

1. `GET /healthz`
   - `versions.enabled` 只剩 `["act2autochess"]`
   - `versions.blocked` 是 4 条（act3autochess / act2autochess@V2_1 / act1autochess / act1autochess@V1_1）
2. 大厅 → 版本选择器：4 条灰显「暂未开放」，点击弹 toast，切不回。
3. 拓展模式 → **炸惊模拟**建房：房间页「开始模拟」**可点**（不再灰）；开局进「确认本局信息」。
4. 主题大厅：**「超限模拟 ∞」** 可建房，进去是 `solo_infinite` / `coop_infinite` + `ABYSS`。
5. 常规局（绝境/终极）「确认本局信息」：核心/附加盟约里**没有 S.E.E.S、颂乐人偶**；
   炸惊局：**有**（这是炸惊专属，正常）。
6. 炸惊打到选惊变：页面是**原版惊变 UI**，每张卡右上角有「重抽」小按钮（每张一次）。
7. 对局中点「返回」→「暂离模拟」：房间保留；大厅出现「继续游戏 / 结束模拟」，
   点「结束模拟」**只弹一次**确认（按钮「结束并判负」）。
8. 管理后台（`/admin`）：账号行有「改名 / 删除账号」；删除需二次确认并输入该账号 QQ。
9. 标题页（closure）页脚几行不再重叠；倒计时数字清晰（7 段数字格）。
10. 管理后台 →「弹窗公告」：点 **＋ 新建公告** 后，`data/announcement.json` 里多出一条**独立**公告（id 形如
    `admin-20261122-abcd`），原公告**不被覆盖**；下方「公告列表」出现该条，可 **停用 / 启用 / 删除**。
    玩家端：2 秒内按「级别 → 起始时间」取到新的那条弹窗。
11. 管理后台 →「关闭服务器」→ 已登录的玩家标题页：开始键在 ~2 秒内变成**红色「服务器关闭」且不可点**；
    点「开启服务器」后自动变回绿色「开始」（不用刷新）。
12. 管理后台 →「关闭服务器」→ **正在大厅/房间里/对局中的玩家全部被踢回标题页**：屏幕上只剩标题页，
    弹一个「服务器已关闭：<原因>」的 toast，socket 状态 `closed` 且不会自己重连；
    点「开启服务器」后玩家点「开始」即可重新进大厅（之前的暂离对局仍能在「继续游戏」里找回）。
13. 关服时 `GET /healthz` **只剩** `{"version":"0.3.3-Yuan","status":"closing"}`（200）；
    开服后恢复完整 body（`ok / versions / sockets / …`）。`GET /api/ping` 关服仍是 503。
14. 关服时标题页：**整页边框**与**中间登录卡边框**同步闪红光（1.8s 呼吸）；登录卡、已登录的账号卡 + 开始键都会闪。
    系统开启「减少动态效果」时改为静态红光不闪。
15. 注册页：昵称输入框**为空**（不再预填「博士」），占位提示「输入昵称（2–12 字）」。
16. 设置 →「问题反馈」下面展开 **我的历史反馈**：能看到自己提交过的反馈、待处理/已解决状态、
    管理员回复（含回复时间）；未登录时提示「登录后才能查看自己的反馈记录。」。
17. 关服 → **不刷新**重开服：约 5–9 秒内标题页连接自动恢复（状态行变回「已连接」），「开始」变回绿色可点；
    点一下直接进大厅（不用刷新页面）。正在对局的玩家被踢回标题页后同样适用。
18. 可露希尔 / 终端大厅右上角：「好友 | **界面 · 可露希尔** | 版本 | 在线人数」——点「界面」能打开主题选择页，
    可切回「网页原版」（切换后整页重载）。
19. 两套主题里：大厅 → 物资调配处 → 点干员 → 详情里出现 **皮肤 SKIN** 区（默认 + 各套外观），
    点一块皮肤会选中并写入 sp.pref.skins；网页原版同样有这块。
20. 后台「快捷操作」：输入房间码点「观战该房间」→ 新标签页以**观战**身份进入该房（房间列表行也有「观战」）；
    输入 QQ 或点账号行「登录」→ 确认后本浏览器切到该账号并打开游戏页（玩家自己的会话不受影响）。
21. **进入账号后仍要保留房间**：某账号的独立模拟还在（暂离/停放）时，用新会话登录该账号（后台「以该账号登录」、
    换设备、清 token 重进）→ 进入游戏后**直接回到那个房间/对局**，不需要再点「继续游戏」。
22. **换号后成就统计是对方账号的**：A 登录过（本地有 A 的战绩）→ 切到 B → 成就统计里**看不到 A 的战绩**；
    再切回 A → A 的战绩完整回来（本地数据按 sp.saveOwner 判定归属，跨账号不再合并）。

---

## 6.1 本次（11-22 / 11-23）改的 10 个文件

```
server/admin.js                （公告：mode:'new' + action:enable/disable/delete，追加/覆盖也会保留其它条目）
server/admin.html              （＋ 新建公告按钮、公告列表、状态/停用/删除；保存后同时刷新列表）
server/http/routes.js          （关服时 /healthz 只回 { version, status:'closing' }）
server/feedback.js             （GET /api/feedback/mine：我的历史反馈 + 管理员回复）
public/js/screens/title.js     （/healthz 探活：status:'closing' 或失败 → serverClosed；按钮 is-down/「服务器关闭」+ 闪烁红光）
public/css/screens/title.css   （.tentry__start.is-down 红底白字；关服时整页/登录卡的 1.8s 红光动画）
public/js/net.js               （4004 = 关服：不重连，补发 server.closed）
public/js/main.js              （关服：断线 + 清房间/对局 + session.entered=false → 回标题页，toast 去重）
public/js/ui/settings.js       （设置里「我的历史反馈」折叠列表）
public/js/screens/auth.js      （注册昵称留空）
```

服务端两个文件需要重启 node 才生效；前端四个文件刷新页面即可（玩家被踢时会自动拿到新逻辑，但**已在页面里的旧代码**要刷新一次才会用新行为）。

---

## 7. 注意事项

- **重启窗口**：服务端改动要重启 `node server/index.js`；重启会丢弃内存里的「暂离房间」，建议没人在线时做。
- **编码**：
  - `.ps1` 必须 **UTF-8 with BOM**（否则 PowerShell 解析报 `}` 处语法错误）。
  - `.cmd` 必须 **GBK(936)**，不要用 UTF-8（会乱码/解析失败）。
- **缓存**：主题 CSS/JS 没有版本号，改完让玩家 Ctrl+F5；数字图已带 `?v=2`。
- **0.4.0 合并树**：见文首警告。逐文件 diff 优先，整包覆盖只适用于纯新增文件。
- **数据文件**：本包**不含** `data/accounts.json`、`data/account-sessions.json`、`data/saves.json`、`data/social.json`、`launcher-config.json`，覆盖会丢账号/存档。
