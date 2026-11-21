# 域名 mon3tr.fun 接入说明（2026-11-21）

## 一、结论先说

| 入口 | 现在能不能用 | 说明 |
|---|---|---|
| `http://8.134.50.56`（**不带端口**） | ✅ 可用 | 新增的 80 端口入口，页面/资源/WebSocket 全部正常 |
| `http://8.134.50.56:3000` | ✅ 可用 | 原来的主端口，行为不变 |
| `http://mon3tr.fun` | ❌ 被阿里云拦截（403 `Non-compliance ICP Filing`） | **域名未做 ICP 备案**，阿里云在网络层按 Host 头拦截 |
| `http://mon3tr.fun:3000` | ❌ 同样 403 | 拦截不看端口，只要 Host 是未备案域名就拦 |

**证据**（2026-11-21 实测）：
- `mon3tr.fun` / `www.mon3tr.fun` 都已经正确解析到 `8.134.50.56`（DNS 在阿里云 hichina）。
- 同一台机器：`http://8.134.50.56/healthz` → **200**；带 `Host: mon3tr.fun:3000` 请求发到 IP → **403**。
- 403 响应头 `Server: Beaver`、页面标题 `Non-compliance ICP Filing`，即阿里云备案拦截页。

> 也就是说：**服务端这边已经全部准备好了**，差的是备案。备案一下来，域名立刻可用，不需要再改任何代码。

## 二、这次做了什么

### 1. 额外端口入口（`server/http/extraPorts.js`，新增）
让游戏服在**额外端口**（本次是 80）上也能访问：对每个额外端口起一个**透明反向代理**，HTTP 与 WebSocket 升级都原样转给主端口（`127.0.0.1:3000`）。

- 主端口逻辑完全不变（同一套 handler / 鉴权 / CSP / 缓存 / 会话）；
- 80 与 3000 天然等价；
- 额外端口绑不上（无权限、被占用）**只告警，绝不影响主端口启动**。

**配置**：`<安装根目录>/data/http-ports.json`
```json
{ "extra": [80], "domain": "mon3tr.fun" }
```
- 文件不存在 / 解析失败 / 端口非法 → 不监听任何额外端口（默认零改动）；
- 支持 BOM（记事本另存的也不会报错）；
- 支持多个端口，如 `"extra": [80, 8080]`；
- 想再加 HTTPS（443）：需要先有证书，再扩展该模块（当前只做 HTTP 透传）。

线上（8.134.50.56）已配好 `{"extra":[80],"domain":"mon3tr.fun"}`，重启后 80 端口生效。

### 2. 验证结果（线上实测）
| 项目 | 结果 |
|---|---|
| `http://8.134.50.56/` | 200（6.0 KB 游戏首页） |
| `/healthz` | 200，`ok:true`、`version:0.3.3-Yuan`、`artKey:ok` |
| `/js/screens/room.js` | 200（93.8 KB） |
| `/data/assets.json` | 200（3.4 MB） |
| `ws://8.134.50.56/ws` | **OPEN**（WebSocket 透传正常） |
| `ws://8.134.50.56:3000/ws` | OPEN（主端口不变） |
| 本机等价验证 | 用 8080 做过端到端：登录 → `online` → 大厅，0 异常 |

## 三、要让 `mon3tr.fun` 真正可用：ICP 备案

域名和服务器都在阿里云，直接在阿里云备案即可：

1. 阿里云控制台 → **ICP 备案**（备案系统）→ 首次备案；
2. 需要：**备案服务号**（从这台包年包月 ECS 申请，每台 5 个）、主体证件（身份证/营业执照）、负责人手机号、域名（万网，需**实名认证满 3 天**）；
3. 阿里云初审（1–2 个工作日）→ 管局审核（7–20 个工作日）；
4. 备案号下来后，`http://mon3tr.fun` 立即能进游戏（不需要重启、不需要改代码）。

### ⚠️ 重要提醒：游戏类网站的前置审批
- 按国内规定，**游戏/网游类网站备案需要前置审批**（文化和旅游部《网络文化经营许可证》等），**个人主体一般无法通过**。
- 现实做法通常有两种：
  1. 用**企业主体**备案，网站名称写「XX 游戏平台/XX 互动娱乐」，按需补前置审批；
  2. 网站名称写「个人技术分享/工具站」之类**不含游戏关键词**的名称先过备案（内容与备案名不符有被抽查注销的风险，自行判断）。
- 备案期间/不做备案时，继续用 `http://8.134.50.56` 或 `http://8.134.50.56:3000` 都能正常玩。

## 四、如果不想备案，其它可选方案

| 方案 | 效果 | 代价 |
|---|---|---|
| 继续用 IP | `http://8.134.50.56` 直连，无端口 | 网址是 IP，不美观 |
| Cloudflare Tunnel（推荐一试） | `https://mon3tr.fun` 可用（无需备案） | 需要把域名 NS 迁到 Cloudflare + 在服务器上跑 `cloudflared`（当前无法远程执行命令，需要你登录这台机器操作；内地直连 CF 边缘速度一般，WebSocket 可用） |
| Cloudflare 301 跳转 | `mon3tr.fun` → 跳到 `http://8.134.50.56:3000` | 地址栏会变成 IP；需要 NS 迁到 Cloudflare |
| 换到香港/海外服务器 | 域名直接可用、无需备案 | 要迁服务器；内地访问延迟略高 |
| 阿里云「URL 转发」 | — | 阿里云同样要求备案，基本走不通 |

Cloudflare Tunnel 的大致步骤（需要你操作）：
1. 域名 NS 改到 Cloudflare（阿里云控制台改 DNS 服务器，Cloudflare 会给两条 NS）；
2. Cloudflare Zero Trust → Tunnels → 新建隧道，安装 `cloudflared` 服务到这台 Windows 服务器；
3. 隧道 Public Hostname 配 `mon3tr.fun` → 服务填 `http://localhost:3000`；
4. 证书由 Cloudflare 自动签发，玩家访问 `https://mon3tr.fun` 即进游戏（WebSocket 走隧道没问题）。

## 五、运维速查

```powershell
# 启动（主端口 3000 + 额外端口 80）
cd C:\Users\Administrator\Downloads\Stronghold-Protocol-v0.3.3-Fusion
node\node.exe server\index.js

# 只想开 80 之外的端口：改 data/http-ports.json 的 extra 数组后重启
# 检查 80 是否在监听
netstat -ano | findstr :80
# 检查域名是否已被阿里云放行（备案后）
curl -s -o NUL -w "%{http_code}" http://mon3tr.fun/healthz
```
