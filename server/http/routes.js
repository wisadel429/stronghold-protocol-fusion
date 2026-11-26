// server/http/routes.js — the node:http request listener. Every response gets the security headers (common.js), then:
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//   * a URL longer than 4096 characters → 414; one that does not parse → 400;
//   * /studio and /studio/… → the plugin studio (server/studio/index.js: for this machine and the local network only — any
//     other client gets the 404 page; its API also takes POST / PUT / DELETE), when the server has one;
//   * any method but GET / HEAD → 405 with `Allow: GET, HEAD`;
//   * GET /healthz → JSON status (protocol `version`, release `app`, uptime, the served `build`, the vanilla content
//     hash `content.vanilla`, the modded content sets in use `content.sets` and — only when there are some — how many
//     unofficial plugins the server has, `content.plugins` (the title screen's count before any hello) — DESIGN §32 —,
//     sockets, sessions,
//     rooms, matches; `versions: { enabled, default, hosts }` only when the server enables another official version than
//     第二期下半 — DESIGN §35.23), never cached; `?traffic=1` adds the traffic counters (traffic.js: bytes by category since the
//     start, WebSocket wire and payload bytes) for a loopback or private-network client only — the maintainer's
//     decision of 2026-10-12: the figures are the host's, so any other client, also one a tunnel or proxy on this
//     machine forwards, gets the plain report (net.js clientAddress, honouring TRUST_PROXY like the WebSocket limits);
//   * everything else → the static files (static.js).
// Every response's body bytes count in the traffic counters (traffic.js meter). A route that throws is logged and
// answers 500.

import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/constants.js';
import { buildTag } from './buildTag.js';
import { setSecurityHeaders, sendError, sendJson, splitUrl } from './common.js';
import { clientAddress, isLocalIp } from '../net.js';

const MAX_URL_LENGTH = 4096;

/** `{ plugins: n }` when the server has n > 0 unofficial plugins (the lobby's visual sets count them), else nothing. */
function pluginCount(lobby) {
  let n;
  try { n = Number(lobby?.plugins?.unofficial?.()) || 0; } catch { n = 0; }
  let notices = false;
  try { notices = lobby?.plugins?.hasNotices?.() === true; } catch { /* optional catalogue hint */ }
  return { ...(n > 0 ? { plugins: n } : {}), ...(notices ? { notices: true } : {}) };
}

/** The content sets with gameplay plugins rooms hold now (DESIGN §32.6; 0 without any). */
function contentSets(lobby) {
  try { return Number(lobby?.plugins?.contentInUse?.()) || 0; } catch { return 0; }
}

/**
 * The GET /healthz body (`withTraffic`: plus the traffic counters and the asset index's state, `?traffic=1`).
 * @param {{ startedAt: number, network: import('../net.js').Network, registry: import('../net.js').SessionRegistry,
 *           lobby: import('../lobby.js').Lobby, content?: { cs: string } | null,
 *           traffic?: ReturnType<typeof import('./traffic.js').createTrafficCounter>,
 *           assetIndex?: ReturnType<typeof import('./assetIndex.js').createAssetIndex> | null,
 *           views?: ReturnType<typeof import('./assetViews.js').createManifestViews> | null, trusted?: any,
 *           versions?: ReturnType<typeof import('../versions.js').createVersionSets> | null,
 *           versionHosts?: { stats: () => object } | null }} health
 *   content: the server's vanilla content (server/plugins/identity.js); versions / versionHosts: the official versions
 *   and their match hosts (DESIGN §35.23)
 * @param {boolean} [withTraffic]
 */
export function healthReport({ startedAt, network, registry, lobby, content = null, traffic, assetIndex, views, trusted, versions = null, versionHosts = null, artKey = null, autostart = null }, withTraffic = false) {
  const report = {
    // 业主 2026-11-14「version 应该展示版本号」：`version` 改成真正的版本号（0.3.3-Yuan），
    // 协议版本单独放 `protocol`（服务器列表、启动器都按 `version` 显示版本，以前读到的是 1）。
    ok: true, version: APP_VERSION, protocol: PROTOCOL_VERSION, app: APP_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    // 美术资源密钥状态（业主 2026-11-15）：'ok' = 有；'missing' = 没领到，加密资源会破图，
    // 前端据此弹提示。null = 这台服务器没启用资源加密。可以是函数（每次求值，领到后立刻变 ok）。
    artKey: typeof artKey === 'function' ? artKey() : artKey,
    // 开机自启（业主 2026-11-22，待办 T-06）：'ok' 任务已就位 / 'denied' 缺管理员权限 / 'error' 注册失败 /
    // 'disabled' 配置关掉了 / 'unsupported' 非 Windows / 'unknown' 还没自检完。维护时一眼看出「重启后会 502 吗」。
    ...(autostart ? { autostart: typeof autostart === 'function' ? autostart() : autostart } : {}),
    // the runtime the server is serving right now (public/js/ui/buildGuard.js): a page whose own build is
    // older than this reloads itself, so a deploy reaches clients that never reload
    build: buildTag(),
    // what its rooms play (DESIGN §32): the vanilla content hash, and how many content sets with gameplay plugins rooms
    // hold now (P1c, §32.6 — a room's cosmetic plugins leave its cs the vanilla one, §32.3); how many unofficial plugins
    // it has, when it has some (a page's title screen says so; P1a)
    ...(content ? { content: { vanilla: content.cs, sets: contentSets(lobby), ...pluginCount(lobby) } } : {}),
    // online: 真实在线人数（有会话且连接存活的 WS 数，业主 2026-11-14 要求）；
    // humans 来自 lobby.stats()，是正在房间里的人类玩家数（不含大厅挂着的）
    sockets: network.connectionCount, sessions: registry.size, online: network.onlineCount, ...lobby.stats(),
  };
  if (trusted && Object.keys(trusted).length) report.plugins = trusted;
  // the official versions (DESIGN §35.23): when another one than 第二期下半 is enabled, or when some are switched off
  // but still listed to the page (server/versionPolicy.js「暂未开放」)
  if (versions && (versions.nonDefault.length || (Array.isArray(versions.blocked) && versions.blocked.length))) {
    report.versions = { enabled: [...versions.ids], default: versions.defaultId,
      ...(Array.isArray(versions.blocked) && versions.blocked.length ? { blocked: [...versions.blocked] } : {}),
      hosts: versionHosts ? versionHosts.stats() : { workers: 0, matches: 0, transport: 'process' } };
  }
  if (withTraffic && traffic) report.traffic = traffic.snapshot();
  // content-hashed asset URLs (assetIndex.js / assetViews.js): off, building, or ready with how many files and URLs
  if (withTraffic) report.assetHashes = assetIndex ? { ...assetIndex.stats(), views: views ? views.stats() : null } : null;
  return report;
}

/** Does the query ask for the traffic counters (`traffic`, `traffic=1`, `traffic=true`)? */
const wantsTraffic = (query) => /(?:^|&)traffic(?:=(?:1|true|yes))?(?:&|$)/i.test(query || '');

/**
 * The request listener for `http.createServer`.
 * @param {{ serveStatic: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
 *             rawPath: string, query: string) => Promise<void>,
 *           health: Parameters<typeof healthReport>[0], log: object, trustProxy?: 'auto' | boolean,
 *           csp?: string | null,
 *           studio?: { handles: (rawPath: string) => boolean, handle: (req: any, res: any, rawPath: string, query: string) => Promise<void> } | null }} deps
 *   trustProxy: whose forwarding headers name the client (net.js clientAddress; the server's TRUST_PROXY); studio: the
 *   plugin studio (server/studio/index.js), or none
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestHandler({ serveStatic, health, log, trustProxy = 'auto', studio = null, csp = null, trustedRuntime = null, modApi = null, publicApi = null, appApi = null, admin = null, adminCsp = null, recruitApi = null, accountApi = null, socialApi = null, updateApi = null, feedbackApi = null }) {
  async function handleRequest(req, res) {
    const url = req.url || '/';
    if (url.length > MAX_URL_LENGTH) { sendError(req, res, 414, '请求地址过长 · URI too long'); return; }
    const parts = splitUrl(url);
    if (!parts) { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    if (trustedRuntime && parts.rawPath.startsWith('/x/') && await trustedRuntime.route(req,res,parts.rawPath)) return;
    // 后台 (server/admin.js): the page is a single file with an inline <script>, so it gets its own CSP; it must run
    // BEFORE the method check below, because its API is POST (otherwise every call would answer 405).
    if (admin && admin.handles(parts.rawPath)) {
      if (adminCsp) res.setHeader('Content-Security-Policy', adminCsp);
      await admin.handle(req, res);
      return;
    }
    if (studio && studio.handles(parts.rawPath)) { await studio.handle(req, res, parts.rawPath, parts.query); return; }
    // 模组管理 API (server/http/modApi.js)：POST 的那几条（热重载 / 从远程同步）必须在这里回答 —— 下面那道方法门
    // 只放 GET/HEAD 过，晚一步就是 405。
    if (modApi && modApi.handles(parts.rawPath)) { await modApi.handle(req, res, parts.rawPath, parts.query); return; }
    // 公开只读 API (server/publicApi.js: /api/rooms · /api/create_room · /api/ping · /api/announcement)：它们自己
    // 判方法（含 POST/OPTIONS 与 405），所以也要在这一道方法门之前。
    if (publicApi && await publicApi(req, res, parts.rawPath)) return;
    // 账号系统（server/accounts/http.js）：/api/account/* 的登录/注册/改名/云存档都是 POST/PUT，必须在这道方法门之前。
    if (accountApi && accountApi.handles(parts.rawPath)) { await accountApi.handle(req, res, parts.rawPath); return; }
    // 社交（server/accounts/socialHttp.js）：好友 / 黑名单 / 邀请，同样需要 POST。
    if (socialApi && socialApi.handles(parts.rawPath)) { await socialApi.handle(req, res, parts.rawPath, parts.query); return; }
    // 问题反馈（server/feedback.js）：POST，客户端/启动器提交，后台列表查看。要在这道方法门之前。
    if (feedbackApi && feedbackApi.handles(parts.rawPath)) { await feedbackApi.handle(req, res, parts.rawPath, parts.query); return; }
    // 导入热更包（server/updateApi.js）：启动器「导入热更包」按键调它，POST 原始 zip 字节。只接受本机回环请求，
    // 所以必须在那道方法门之前（它会自己答 405 / 403）。
    if (updateApi && updateApi.handles(parts.rawPath)) { await updateApi.handle(req, res, parts.rawPath); return; }
    // 启动器 / Android 宿主用的只读端点 (server/http/appApi.js)：版本与热更补丁、局域网房间探针。它们只走 GET/HEAD，
    // 非 GET/HEAD 交回下面那道方法门统一答 405（不在两处各写一遍 Allow）。
    if (appApi && appApi(req, res, parts.rawPath)) return;
    // 服务器列表（wei.jiangjiangze.icu 这类第三方页面）是**跨域**探测 /healthz 的：
    // 没有 Access-Control-Allow-Origin，浏览器会拦掉响应体，列表就只能显示「— 房间 / — 对局」。
    // 这条只读、无凭据、无敏感字段（在线数/房间数本来就是要公开的），所以放开任意来源；
    // 带自定义头的实现会先发 OPTIONS 预检，这里一并答掉。
    if (parts.rawPath === '/healthz' && req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
      return;
    }
    if (parts.rawPath === '/healthz') {
      const withTraffic = wantsTraffic(parts.query) && isLocalIp(clientAddress(req, trustProxy).ip);
      const report = healthReport(health, withTraffic);
      // 关服（后台「关闭服务器」）时进程仍在跑：**只回版本号 + status:'closing'**（业主 2026-11-23），
      // 不暴露在线人数 / 房间 / 版本列表等细节；标题页、服务器列表都按 `status === 'closing'` 判关闭。
      const gate = health && health.lobby ? health.lobby.gate : null;
      if (gate && gate.open === false) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        sendJson(req, res, 200, { version: report.version, status: 'closing' });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      sendJson(req, res, 200, report);
      return;
    }
    // 服务器列表的轻量探针：进程活着但已关服 → 503，列表据此显示离线
    if (parts.rawPath === '/api/ping') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      const gate = health && health.lobby ? health.lobby.gate : null;
      if (gate && gate.open === false) sendJson(req, res, 503, { ok: false, closed: true, reason: 'server_closed', text: gate.text || '' });
      else sendJson(req, res, 200, { ok: true });
      return;
    }
    // 缺人同盟: GET /api/recruit — public co-op rooms still waiting for players (the card polls it)
    if (recruitApi && await recruitApi(req, res, parts.rawPath)) return;
    await serveStatic(req, res, parts.rawPath, parts.query);
  }

  return (req, res) => {
    setSecurityHeaders(res);
    if (csp) res.setHeader('Content-Security-Policy', csp);
    if (health.traffic) health.traffic.meter(res, splitUrl(req.url || '/')?.rawPath || '/');
    handleRequest(req, res).catch((e) => {
      log.error('[http] request failed', e);
      sendError(req, res, 500, '服务器内部错误 · Internal error');
    });
  };
}
