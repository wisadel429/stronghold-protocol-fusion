# SERVER-UPDATE（服务端 + 界面补丁清单）

- 打包日期：**2026-11-18**
- 来源：本机 `C:\Users\Administrator\Downloads\Stronghold-Protocol-v0.3.3-Fusion`（v0.3.3-Yuan，build `0c6682201e37`）
- 包名：`SERVER-UPDATE-2026-11-18.zip`（与本文档同目录）
- 包内**只含**下列「改过的文件」，不含 `data/accounts.json`、`data/saves.json`、`data/social.json`、`data/account-sessions.json`、`launcher-config.json`、`.cache/`、`node_modules/`。

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
server/admin.js                               修改
server/admin.html                             修改
server/match/host/proxy.js                    修改
public/js/versions.js                         修改
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

---

## 7. 注意事项

- **重启窗口**：服务端改动要重启 `node server/index.js`；重启会丢弃内存里的「暂离房间」，建议没人在线时做。
- **编码**：
  - `.ps1` 必须 **UTF-8 with BOM**（否则 PowerShell 解析报 `}` 处语法错误）。
  - `.cmd` 必须 **GBK(936)**，不要用 UTF-8（会乱码/解析失败）。
- **缓存**：主题 CSS/JS 没有版本号，改完让玩家 Ctrl+F5；数字图已带 `?v=2`。
- **0.4.0 合并树**：见文首警告。逐文件 diff 优先，整包覆盖只适用于纯新增文件。
- **数据文件**：本包**不含** `data/accounts.json`、`data/account-sessions.json`、`data/saves.json`、`data/social.json`、`launcher-config.json`，覆盖会丢账号/存档。
