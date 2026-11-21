# 账号系统（第二期进行中）

> 2026-11-14 落地。口径由业主逐项确认：**登录凭据 = QQ 号（不公开）**、用户名密码式登录、开放注册、
> 昵称不唯一靠 `#tag`、单设备登录、零依赖 `data/*.json`、云存档（战绩/调配/皮肤/名片/成就/设置）、
> 首次登录自动合并本地数据、管理员重置密码、用户协议 + 隐私政策两页。
> **头像用干员立绘**（业主 2026-11-14 追加），**不做头像框**。

## 关键口径：QQ 号不公开

- 登录名就是 QQ 号（5–12 位数字，`/^[1-9][0-9]{4,11}$/`），复制时带的空格/连字符会被清掉。
- QQ 号**只出现在两处**：① 本人的 `/api/account/me` 响应（`self: true`）；② 管理员后台的账号列表。
  任何给其他玩家看的数据里都没有它（公开身份只有「昵称#tag」）。
- 昵称默认「博士」，注册时自填；绝不拿 QQ 号当昵称。

## 结构

```
server/accounts/
  store.js       账号 / 云存档 / 会话的 JSON 持久化（原子写、损坏自愈、120ms 合并落盘）
  passwords.js   scrypt 哈希（N=2^15,r=8,p=1）+ 定时安全比较
  service.js     注册 / 登录 / 单设备会话 / 改名（7 天冷却）/ 立绘头像 / 云存档合并 / 管理操作（列表·封禁·重置密码）
  http.js        /api/account/*（HttpOnly cookie `sp_acc`，注册 3 次/小时/IP、登录 10 次/分钟/IP 限速）
server/admin.js + server/admin.html   管理员账号页（列表/搜索/封禁/解封/重置密码），走已有的管理员口令鉴权
public/js/
  accountApi.js  HTTP 客户端（credentials: include）
  screens/auth.js  登录/注册表单（标题页内嵌 AuthCard）+ 标题页账号按钮（立绘头像 / 改名 / 退出）+ 立绘选择弹窗
  ui/cloudSave.js  云存档：首次合并 + 之后 3 秒节流回写
  ui/accounts.js   身份视图：有登录账号时优先用账号的昵称与 #tag（聊天/座位的 #tag 因此全服一致）
public/legal/terms.html, privacy.html   用户协议 / 隐私政策
tools/check-accounts.mjs                 服务端冒烟（9 项，自起服务器、账号数据写临时目录）
```

## 接入点（对既有代码只加钩子）

- `server/net.js`：`Connection.accountId`（WS 升级时从 cookie 解析）→ hello 时绑定 `session.accountId`；
  `requireAccount` 为真时**未登录直接拒绝握手**（`AUTH_REQUIRED`）；`network.dropAccount()` 用于单设备踢旧 / 封禁踢下线。
- `server/http/routes.js`：`/api/account/*` 挂在方法门之前（登录/注册是 POST）。
- `server/index.js`：组装 store/service/api；`accountStore.close()` 进优雅退出；管理员后台注入 `accountService`。
- `public/js/main.js`：boot 先 `loadAccount()` 查登录态（**不再整屏拦截**）；未登录时**不连 WebSocket**
  （服务端 `requireAccount` 会拒绝未登录握手，`AUTH_REQUIRED`），登录成功后由标题页触发连接；
  `helloError` 收到 `AUTH_REQUIRED` / `AUTH_EXPIRED` 时清掉账号态、断开 socket、回标题页的登录卡（不再整页刷新，
  避免「cookie 还在但会话已失效」时刷新循环）。

## 登录界面：长在标题页上（业主 2026-11-14 二次口径）

登录**不再是整屏挡板**，而是嵌在标题页原有的「开始」卡里（`screens/title.js` 的 `.title-login`）：

- 未登录：卡片里是登录 / 注册表单（`screens/auth.js` 的 `AuthCard`），右上角账号/好友按钮不出现，
  连接状态行显示「登录后自动连接服务器」；此时 boot 不建 WebSocket。
- 登录 / 注册成功：账号进 store → 装云存档 + 好友邀请浮层 → `net.connect()` → **直接用账号昵称进入游戏**
  （业主 2026-11-14：不再让玩家重复输一次「博士代号」；`screens/title.js` 的 `signedIn` 调 `enterSession(acc.nickname)`）。
  代号输入框那条老路只留给没挂账号 API 的服务器（`SP_ACCOUNTS=off`）。
- 样式在 `css/screens/title.css` 的 `.title-auth*`：登录卡宽 6.2rem（注册页两列表单）、
  距标题下方留出余量（`margin-top: .45rem`），跟着标题页 rem 网格缩放，字号/控件高度带地板值
  （`max(<px>, calc(k * var(--t)))`）；窄屏/矮屏（≤620px 宽、≤560px 高）才收起徽记与大标题。
  三入口（`/`、`/ui-theme-initial.html`、`/ui-theme-closure.html`）共用同一套，均已验证。
- 登录卡在 UI 布局编辑器里的固定宽高条目（`public/ui-layout.json` 的 `.title-login`）已移除：
  它把高度锁在 2.9946rem，接入表单一后会把卡片压扁。移动端那批标题页子元素的硬编码平移也一并清掉。

## 全局水印

右下角常驻服务器编号（业主 2026-11-14：`SERVER 1`），任何界面都可见：

- 文本在 `public/js/main.js` 的 `SERVER_WATERMARK`；多服部署时在 `index.html` 里先设
  `window.__SP_SERVER_NAME__ = 'SERVER 2'` 即可覆盖，不必改代码。
- 样式 `public/css/theme.css` 的 `.server-watermark`：`position: fixed` 右下角、
  `pointer-events: none`（不拦点击）、`user-select: none`、不进阅读顺序（`aria-hidden`）。

## 数据

`data/accounts.json`、`data/saves.json`、`data/account-sessions.json`（会话只存 token 的 sha256）。
`SP_ACCOUNTS_DIR` 可把账号数据指到别处（测试隔离 / 单独备份盘）；`SP_ACCOUNTS=off` 关闭账号系统（本地开发用）。

## 安全

- 密码 `scrypt` + 每账号随机盐；登录失败对「QQ 号不存在」与「密码错误」返回同一错误，避免枚举。
- 会话 30 天不活跃过期；服务端只存 token 哈希；cookie `HttpOnly; SameSite=Lax`（HTTPS 下加 `Secure`）。
- 注册同 IP 每小时 3 个、登录同 IP 每分钟 10 次（内存滑动窗口）。
- 云存档字段白名单（stats/loadout/skins/namecards/achievements/settings）+ 512KB 上限。
- 管理员页的账号昵称是玩家输入，表格渲染前做 HTML 转义（`escapeHtml`）。

## 验证（可复跑）

```sh
node tools/check-accounts.mjs     # 9/9
```

覆盖：未登录握手被拒、注册（QQ 号 + 昵称）、登录、`me`、云存档读写、合并规则、单设备踢旧（4001）、改名冷却、错误不泄露。

浏览器端到端（无头 Edge，11/11）：登录页是「QQ 号（不公开）」→ 注册 → 标题页显示「昵称#tag」→ 账号面板显示 QQ 号与「更换头像立绘」→ 立绘选择器 112 个干员 / 图片真的加载 → 选完头像按钮出现立绘图 → 管理员按 QQ 号搜索 / 重置密码 / 封禁 → 封禁后登录被拒且提示原因。

## 第二期进度

| 项 | 状态 |
| --- | --- |
| 管理员后台账号页（列表 / 搜索 / 封禁 / 解封 / 重置密码） | ✅ |
| 身份显示统一（`ui/accounts.js` 优先用账号昵称与 #tag） | ✅ |
| 头像 = 干员立绘（无头像框） | ✅ |
| 好友：添加（QQ 号或「昵称#tag」查找）/ 同意 / 拒绝 / 列表 / 删除 | ✅ |
| 黑名单：拉黑（自动解除好友 + 拒收请求）/ 解除 | ✅ |
| 邀请好友进房（在线推送 → 任意界面弹「加入/忽略」→ 点加入直接进房） | ✅ |
| 在线状态（好友列表绿点，`network.conns` 现算） | ✅ |
| 全服排行榜（胜场 / 最高层数 / 首杀） | ⏳ 下一批 |
| 注销账号入口（协议里已承诺） | ⏳ 下一批 |
| 黑名单作用到「大厅房间列表可见性」 | ⏳ `SocialService.canSeeRoom()` 已就绪，还差 lobby 房间列表接线 |
| 封禁申诉走管理员后台记录 | ⏳ 后台已有封禁原因字段 |

### 社交（第二期）实现要点

- 服务端：`server/accounts/social.js`（SocialStore/SocialService）+ `socialHttp.js`（`/api/social/*`）；
  存储 `data/social.json`；在线状态由 `Network.conns` 现算（不落盘）；
  推送通过 `Network.sendToAccount(accountId, msg)`（好友请求 `social.request`、同意 `social.accepted`、邀请 `social.invite`）。
- 好友关系**双向**存储；拉黑会同时解除好友、清掉双方未处理请求，并让被拉黑方无法再发请求。
- 客户端：`public/js/screens/social.js` —— 标题页右上角「好友」按钮 + 其他界面右上角悬浮入口
  （`main.js` 的 `.social-dock`，只在非标题页且已登录时出现，房间里自动带「邀请进房」）；
  邀请浮层由 `installSocialInvites()` 用原生 DOM 渲染，任何界面都能弹。
- 加好友输入框接受 **QQ 号** 或 **昵称#1234**（QQ 号不公开，但你知道对方 QQ 时最方便）；返回给请求方的只有公开身份。
- 验证：`node tools/check-social.mjs` → **18/18**（含在线状态、邀请推送、非好友不能邀请、拉黑链路）；
  浏览器端两个**独立浏览器实例**（cookie 不串）→ **6/6**（面板列好友+绿点、按 QQ 搜索加好友、邀请浮层含房间号）。


