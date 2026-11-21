# 2026-11-17 版本封禁（暂未开放）+ 后台删除 / 重命名账号

## 一、版本封禁（只开放第二期下半）

### 口径

- 只有 `act2autochess`（第二期下半）可玩；其余四期在版本选择器里**显示但锁定**，点一下弹「暂未开放」。
- 锁定的版本**不加载**：没有数据目录读取、没有 match host、房间不能开、提案/投票一律拒绝；
  `/healthz` 的 `versions.enabled` 只剩 `act2autochess`，`versions.blocked` 列出被关的四个。

### 配置（改这一个文件，重启生效）

`data/versions-policy.json`：

```json
{
  "disabled": ["act3autochess", "act2autochess@V2_1", "act1autochess", "act1autochess@V1_1"],
  "hint": "暂未开放"
}
```

| 字段 | 说明 |
|---|---|
| `disabled` | 要封禁的版本 id（注册表 `shared/versions.js` 里的 id）。未知 id 会被忽略并 warning；第二期下半封不掉（会 warning）。 |
| `hint` | 选择器上显示的原因，默认「暂未开放」。 |

- 重新开放某一期：把它从 `disabled` 里删掉 → 重启服务器。
- 删掉整个文件 = 全部开放（恢复旧行为）。
- 也可以继续用环境变量 `SP_VERSIONS` 限定开放范围；两者叠加时先按 `SP_VERSIONS` 取集合，再按策略文件摘掉。

### 实现位置

| 文件 | 改动 |
|---|---|
| `server/versionPolicy.js`（新增） | 读策略文件、把 `versionsFrom()` 的结果摘成「加载集合 + 锁定集合」 |
| `server/index.js` | 读策略 → 套用 → 传给 `createVersionSets`（`blocked` / `blockedHint`）；启动日志多打一行「暂未开放: …」 |
| `server/versions.js` | `createVersionSets({ blocked, blockedHint })`；`welcome()` 额外下发锁定条目（`disabled: true` + `reason`，**没有 cs**）；`stats()`/实例多一个 `blocked` |
| `server/http/routes.js` | `/healthz` 多一个 `versions.blocked` |
| `public/js/versions.js` | `sanitizeVersions` 接受锁定条目（cs 记 null）、新增 `isLockedVersion`；`lobbyVersion` 与 `setLobbyVersion` 不选锁定版本（本机偏好存在锁定版本时回落到默认） |
| `public/js/ui/versionPicker.js` | 锁定行灰掉、带「暂未开放」徽标与说明，点击 → `toast(reason)`，不会切换 |
| `public/js/screens/stats.js` | 「统计数据」的版本筛选不再把锁定版本当成"本服提供" |
| `public/css/components.css` | `.verpick__row.is-locked` / `.verpick__badge.is-locked` 样式 |

## 二、后台：删除账号 / 重命名账号

### 接口（都需要后台口令 `x-admin-password`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/admin/api/accounts/rename` | `{ id, nickname }` → 改昵称（不受玩家侧 7 天冷却限制；固定账号 403） |
| POST | `/admin/api/accounts/delete` | `{ id }` → 删账号 + 云存档 + 会话 + 好友/黑名单/邀请关系，并把在线连接踢下线 |

### 实现位置

| 文件 | 改动 |
|---|---|
| `server/accounts/store.js` | `remove(id)`：账号、QQ 号索引、云存档、会话一起删（同一 QQ 可重新注册） |
| `server/accounts/social.js` | `purge(id)`：清自己的四张社交表，并从别人的好友/请求/已发/黑名单里摘掉 |
| `server/accounts/service.js` | `adminRename()` / `remove()`（都走 `assertMutable`，固定账号不可改/不可删） |
| `server/admin.js` | 两条新路由 + 处理分支（删除时调 `social.purge`、`network.dropAccount`，日志留痕） |
| `server/index.js` | 把 `socialStore` 以 getter 形式交给后台（与 `feedback` 同一套写法，社交存储在账号之后才创建） |
| `server/admin.html` | 账号行新增「改名」「删除账号」按钮；删除要**手打该账号 QQ 号二次确认**，成功后提示清理了多少条社交关系 |

## 三、验证（`.cache/probe/check-versions-admin.mjs`，独立实例 3146，不碰生产）

18/18 通过：

- `/healthz`：`enabled=["act2autochess"]`、`default=act2autochess`、`blocked` 4 个
- `welcome.versions`：5 条，其中 4 条 `disabled:true` + `reason:"暂未开放"` + `cs:null`；默认条目正常且带 cs
- 后台：搜到账号 → 重命名成功并落盘 → 删除成功 → 列表消失 → **同一 QQ 可重新注册**
- 固定账号：重命名 403、删除 403
- 不存在的 id → 404；不带口令 → 401

浏览器实测（1366×768，可露希尔入口）：

- 大厅版本胶囊 = 「版本第二期下半」；打开选择器 5 行，4 行灰掉带「暂未开放」+「该版本暂未开放，无法切换」
- 点锁定行 → 顶部冒「⚠ 暂未开放」toast，选择器不关闭、版本不变
- 本机偏好存着 `act1autochess`（已锁定）时，进大厅仍显示第二期下半（不加载锁定版本）

## 四、注意

- 这两项都改到了 `server/**`，**必须重启服务器**才生效；本次已用后台同一套中继机制重启过（`uptimeSec` 归零、`build` 变化）。
- 重启会中断当时进行的对局（独立模拟有 24 小时停放，重连可继续）；以后建议在没人打的时候改。
