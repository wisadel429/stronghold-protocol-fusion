// server/admin.js — 后台 (admin backend), mounted on the game's own port at /admin (an extra listener is optional).
//
// The portable half of ADMIN-DESIGN.md: it owns the HTTP server, the password gate, the visit counters, the JSON API
// and the single-file page, and it reaches the game ONLY through the adapter it is handed (`live`, see
// server/admin-live.js and ADMIN-DESIGN.md §3). Nothing in here imports server/lobby.js or server/net.js — that is what
// makes the file reusable for another game (swap the adapter, keep this).
//
// 0.3.3 note: this tree ships no /test lane and no onlineSummary(), so the adapter computes those figures itself; the
// page is unchanged apart from the 资源检测 card (server/admin-monitor.js).
//
// API (ADMIN-DESIGN.md §5):
//   GET  /api/state      → the §4 snapshot + stats (the page's 2 s poll)
//   POST /api/notice     { text, ttlMin? }         → 滚动公告 (empty text clears it)
//   POST /api/gate       { open, text? }           → 开 / 关服务器
//   POST /api/warn       { seconds, text?, closeOnExpire? } → 闪断更新预警 (seconds 0 = cancel)
//   POST /api/kick       { playerId }              → 踢人
//   POST /api/close-room { code }                  → 解散房间
//   GET  /healthz        → this backend's own op score, NO password (ADMIN-DESIGN.md §10)
//
// Auth: one password (ADMIN_PASSWORD env, the `password` option, or DEFAULT_ADMIN_PASSWORD), sent as the
// `x-admin-password` header — `?password=` is accepted too so curl works. Every /api/* call without it answers 401;
// failed attempts are throttled per client address (12/min → 429 for a minute). GET / (the page) is public: it shows
// nothing but a password field until one is accepted. Every GET / counts a 后台访问次数 (`stats.visits`).
//
// Any failure in here costs the backend only: server/index.js wraps startAdminServer in try/catch and warns.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, timingSafeEqual, randomBytes, scryptSync } from 'node:crypto';
import { importZip, readRawBody, tempZipPath } from './updateImport.js';
import { syntaxCheck, scheduleRestart } from './restart.js';

/** The owner's password, used when neither the env nor the option sets one (八个八 — the admin page reminds the owner
 *  to change it after login; ADMIN_PASSWORD overrides this). */
export const DEFAULT_ADMIN_PASSWORD = '88888888';

/** The backend's own version (shown in /healthz and in the page header). */
export const ADMIN_VERSION = '1.1.0';

/**
 * CSP for the admin page (routes.js overrides the site policy for `/admin*`). The page is a single self-contained
 * file with an inline <script> and inline styles — exactly what `script-src 'self'` would block (the handoff's §五.5
 * "页面能开、登录转圈"). Nothing external is loaded, so this stays tight apart from 'unsafe-inline'.
 */
export const ADMIN_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'";


export const ADMIN_DEFAULTS = Object.freeze({
  // DEFAULT 0 = no listener of its own: the backend rides on the game port at /admin. Set ADMIN_PORT=5000 only when
  // a firewall rule, a tunnel or a bookmarked http://host:5000/ still needs the old standalone port.
  port: 0,
  // Reachable from anywhere (the owner asked for it) — the password is the only gate, so keep it long.
  host: '0.0.0.0',
  password: DEFAULT_ADMIN_PASSWORD,
  attemptsPerMin: 12,   // failed logins per client address per minute before it is locked out briefly
  bodyMaxBytes: 8 << 10,
});

/** Announcement text cap server-side (the adapter caps too; this one keeps a bad body out of the loop). */
const NOTICE_MAX = 2000;
/** 公告正文放宽到 4000 字后，请求体上限也得跟着放（4000 汉字约 12 KB，原来那 8 KB 会直接把连接掐掉）。 */
const ANNOUNCEMENT_BODY_MAX = 96 << 10;

/** 两个时间是否是**同一个本地自然日**（业主 2026-11-22：同一天的公告只维护一条）。
 *  2026-11-26 起这段判断搬进了 `server/announcementPlan.js`（纯函数、可单测），这里只留注释指路。 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, 'admin.html');
/** 安装根目录（热更解压的落点）；server/index.js 传进来，默认 server/ 的上一层。 */
const DEFAULT_ROOT = path.join(HERE, '..');
/** Where a password changed in the page is kept (root of the installation, next to the launcher's own files). */
export const PASSWORD_FILE = path.join(HERE, '..', 'admin-password.json');

/**
 * The password kept on disk by 修改口令: `{ v: 1, salt, hash, updatedAt }`, hash = scrypt(next, salt, 64). Never the
 * plain text. A missing / unreadable file is "no password chosen yet" (the env / DEFAULT_ADMIN_PASSWORD still work).
 * @returns {{ salt: string, hash: string, updatedAt?: string }|null}
 */
function readStoredPassword() {
  try {
    const raw = JSON.parse(fs.readFileSync(PASSWORD_FILE, 'utf8'));
    if (raw && raw.v === 1 && /^[0-9a-f]{16,128}$/.test(raw.salt) && /^[0-9a-f]{16,256}$/.test(raw.hash)) {
      return { salt: raw.salt, hash: raw.hash, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined };
    }
  } catch { /* absent or broken: the default path applies */ }
  return null;
}

/** Write the new password's scrypt record atomically (temp file + rename), owner-readable only where that is honoured. */
function writeStoredPassword(next) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(next, salt, 64).toString('hex');
  const record = { v: 1, salt, hash, updatedAt: new Date().toISOString() };
  const tmp = `${PASSWORD_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, PASSWORD_FILE);
  return record;
}

// ---- 热更锁 (owner, 2026-11-15) ------------------------------------------------------------------------------------
//
// `/api/update` 和 `/api/restart` 除了后台口令，还要一份**独立**的热更锁。以前锁的值就是「当前后台口令」——
// 改口令等于改锁，口令一旦被谁拿到，锁也一起失守，而且和口令的用途缠在一起。
// 现在锁是单独一个密钥，**与后台口令完全解耦**：改后台口令不影响它，它自己也只有一个来源（下面这个文件）。
//
// 存在安装根目录的 admin-update-key.json 里，内容是 scrypt(密钥, salt, 64) —— 密文，永不落明文
// （和 admin-password.json 同一套做法，同样住在安装根目录、同样不进任何分发包 / 热更包）。

/** 热更锁的密文文件（安装根目录，与 admin-password.json 并排）。 */
export const UPDATE_KEY_FILE = path.join(HERE, '..', 'admin-update-key.json');

/**
 * 内置的热更锁记录（业主 2026-11-15 锁死的那一份）。**源码里只有 scrypt 密文，没有明文密钥。**
 * 文件在就用文件；文件被删掉 / 读不出来，就用这份记录把文件重建出来 —— 所以它同时是恢复用的备份。
 * 换锁：改 admin-update-key.json（或删掉它、再用 tools/ 里的办法生成新记录替换这里的 salt/hash），下次启动生效。
 */
export const DEFAULT_UPDATE_KEY = Object.freeze({
  v: 1,
  salt: '72b547ad5d4c7788d7dc249a84f9a3ed',
  hash: '9d1a704e4025e0d35e3d06a5faf05ad93427ef730929b2dd3e1d09a6cdcf7ce5b593fdd05ee87295343a7f6b325f1d20252184d3a134bb151d75be43bdfef8fe',
});

/** @returns {{ v: 1, salt: string, hash: string }|null} 磁盘上的热更锁记录，坏 / 不存在 = null。 */
function readStoredUpdateKey() {
  try {
    const raw = JSON.parse(fs.readFileSync(UPDATE_KEY_FILE, 'utf8'));
    if (raw && raw.v === 1 && /^[0-9a-f]{16,128}$/.test(raw.salt) && /^[0-9a-f]{16,256}$/.test(raw.hash)) {
      return { v: 1, salt: raw.salt, hash: raw.hash };
    }
  } catch { /* absent or broken: the built-in record applies */ }
  return null;
}

/**
 * 读出热更锁记录；文件不存在 / 坏了就用 DEFAULT_UPDATE_KEY 重建它。
 * 写盘失败只记日志（此时仍用内置密文校验，锁照样能用）。
 * @param {{ warn?: Function }} log
 */
function ensureStoredUpdateKey(log) {
  const found = readStoredUpdateKey();
  if (found) return found;
  const record = { ...DEFAULT_UPDATE_KEY, updatedAt: new Date().toISOString() };
  try {
    const tmp = `${UPDATE_KEY_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, UPDATE_KEY_FILE);
  } catch (e) { log?.warn?.('[admin] 写入 admin-update-key.json 失败（本次用内置密文校验）', e); }
  return { v: 1, salt: record.salt, hash: record.hash };
}

/**
 * The build tag of the backend + page: a hash of the two files, so the page header can prove "改了有没有生效"
 * (ADMIN-DESIGN.md §10 `build`). Computed once at boot; a missing page yields a stable placeholder.
 */
export function computeAdminBuild() {
  try {
    const h = createHash('sha256');
    h.update(fs.readFileSync(fileURLToPath(import.meta.url)));
    try { h.update(fs.readFileSync(PAGE)); } catch { /* the page is optional for the tag */ }
    return h.digest('hex').slice(0, 12);
  } catch { return 'unknown'; }
}

/** The API surface: path → the method it answers. Anything else is 404, a wrong method on these is 405. */
const API_ROUTES = Object.freeze({
  '/api/state': 'GET',
  '/api/notice': 'POST',
  '/api/announcement': 'GET,POST',
  // 历史公告（业主 2026-11-22）：GET 列表 / POST 删除一条（{id}）或清空（{all:true}）
  '/api/announcement/history': 'GET,POST',
  '/api/kick': 'POST',
  '/api/close-room': 'POST',
  '/api/gate': 'POST',
  '/api/warn': 'POST',
  '/api/password': 'POST',
  // 账号管理（账号系统第二期）：列表与搜索 / 封禁 / 解封 / 重置密码 / 管理员
  // + 业主 2026-11-17：重命名账号、删除账号
  '/api/accounts': 'GET',
  '/api/accounts/ban': 'POST',
  '/api/accounts/unban': 'POST',
  '/api/accounts/reset': 'POST',
  '/api/accounts/setAdmin': 'POST',
  '/api/accounts/rename': 'POST',
  '/api/accounts/delete': 'POST',
  // 业主 2026-11-24：后台「直接登录他人账号」——签发一个该账号的会话，把 sp_acc cookie 种到后台浏览器
  '/api/accounts/login-as': 'POST',
  // 热更（业主 2026-11-14）：上传 zip 覆盖到安装目录，不重启服务器；客户端靠 buildGuard 察觉 build 变化后提示刷新
  '/api/update': 'POST',
  // 远程自重启（业主 2026-11-14）：上传完 server/** 后用它，先语法自检再拉起新进程
  '/api/restart': 'POST',
  // 问题反馈（server/feedback.js）：玩家提交的内容在这里看 / 删
  '/api/feedback': 'GET',
  '/api/feedback/update': 'POST',
  '/api/feedback/delete': 'POST',
});

/** Constant-time password comparison (hashes first, so differing lengths are fine). `expected` is a plain password or a
 *  scrypt record written by 修改口令. */
function passwordMatches(given, expected) {
  if (typeof given !== 'string' || given.length === 0 || given.length > 256) return false;
  if (expected && typeof expected === 'object' && typeof expected.salt === 'string' && typeof expected.hash === 'string') {
    try {
      const a = scryptSync(given, expected.salt, 64);
      const b = Buffer.from(expected.hash, 'hex');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch { return false; }
  }
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(String(expected), 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** The client address of a request (loopback stays readable; a proxy's X-Forwarded-For is deliberately NOT trusted). */
const addressOf = (req) => String(req.socket?.remoteAddress || '?').replace(/^::ffff:/, '');

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

/** Read a JSON request body (capped). Resolves {} for an empty body, rejects on bad JSON / too large. */
function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      // 超限时不再缓冲，但把流读完 —— 否则直接 destroy 会让客户端收到「空响应」，
      // 调用方也就没法回一个明确的 413。
      if (size > maxBytes) { tooBig = true; return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) { reject(Object.assign(new Error('body too large'), { code: 'ETOOLARGE' })); return; }
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) { resolve({}); return; }
      try { resolve(JSON.parse(text)); } catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

/** `YYYY-MM-DD` in local time — the key of the per-day visit counters. */
const dayKey = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Build (but do not start) the admin HTTP server.
 * @param {{
 *   live: ReturnType<import('./admin-live.js').createAdminLive>,
 *   lobby: import('./lobby.js').Lobby,
 *   registry?: import('./net.js').SessionRegistry,
 *   network?: import('./net.js').Network,
 *   log?: { info: Function, warn: Function, error: Function, debug?: Function },
 *   password?: string, port?: number, host?: string, startedAt?: number,
 *   serverName?: string, build?: string,
 *   options?: Partial<typeof ADMIN_DEFAULTS>,
 * }} opts
 *   live: the adapter (ADMIN-DESIGN.md §3) — the only way this file touches the game;
 *   lobby/registry/network: only read here for the counters of /healthz and of the page's top card, never to act.
 */
export function createAdminServer({
  live, lobby, registry = null, network = null, log = console, password, port, host,
  startedAt = Date.now(), serverName = 'server1', build = null, options = {},
  mountPath = '/admin', publicPort = null, monitor = null, passwordFromEnv = false, accounts = null,
  root = DEFAULT_ROOT, onFilesUpdated = null, feedback = null, social = null, messages = null,
  announcements = null,
}) {
  if (!live) throw new TypeError('createAdminServer needs the live adapter (server/admin-live.js)');
  const opts = { ...ADMIN_DEFAULTS, ...options };
  // 口令来源的优先级：环境变量 / 显式传入 > 修改口令写下的 admin-password.json > DEFAULT_ADMIN_PASSWORD。
  // 环境变量显式设置时，页面里改的口令只对本次运行有效（/api/state 的 passwordFromEnv 告诉页面这一点）。
  const stored = readStoredPassword();
  const fallback = typeof password === 'string' && password.length ? password : opts.password;
  let secret = passwordFromEnv || !stored ? fallback : stored;
  // 热更锁：独立密钥，与后台口令解耦（见上面对 UPDATE_KEY_FILE 的说明）。缺失时按内置密文重建。
  const updateKey = ensureStoredUpdateKey(log);
  /** 是否仍是初始口令（页面据此显示登录页提示与登录后提醒）。 */
  const usingDefaultPassword = () => !passwordFromEnv && typeof secret === 'string' && secret === DEFAULT_ADMIN_PASSWORD;
  const adminBuild = build || computeAdminBuild();
  /** @type {Map<string, { n: number, until: number }>} failed logins per address */
  const failures = new Map();
  /**
   * 后台访问次数: how often the page itself was opened in this process, plus a per-day breakdown so a long-running
   * server still shows today's number. `pageViews` counts every GET /, `apiHits` every authorized /api/* call.
   */
  const visits = { pageViews: 0, apiHits: 0, since: startedAt, byDay: new Map() };

  function noteVisit(kind, at = Date.now()) {
    if (kind === 'page') visits.pageViews++;
    else visits.apiHits++;
    const key = dayKey(at);
    const day = visits.byDay.get(key) || { pageViews: 0, apiHits: 0 };
    if (kind === 'page') day.pageViews++;
    else day.apiHits++;
    visits.byDay.set(key, day);
  }

  /** Today's counters (the page shows them next to the totals). */
  function visitsOf() {
    const today = visits.byDay.get(dayKey(Date.now())) || { pageViews: 0, apiHits: 0 };
    return {
      pageViews: visits.pageViews,
      apiHits: visits.apiHits,
      since: visits.since,
      todayPageViews: today.pageViews,
      todayApiHits: today.apiHits,
      days: visits.byDay.size,
    };
  }

  function lockedOut(addr) {
    const f = failures.get(addr);
    if (!f) return false;
    if (f.until <= Date.now()) { failures.delete(addr); return false; }
    return f.n >= opts.attemptsPerMin;
  }

  function noteFailure(addr) {
    const now = Date.now();
    const f = failures.get(addr);
    if (!f || f.until <= now) failures.set(addr, { n: 1, until: now + 60_000 });
    else f.n += 1;
  }

  /** null when the request may proceed, otherwise the refusal to send. */
  function authorize(req, url) {
    const addr = addressOf(req);
    if (lockedOut(addr)) return { status: 429, body: { error: '尝试次数过多，请一分钟后再试' } };
    const given = req.headers['x-admin-password'] || url.searchParams.get('password') || '';
    if (passwordMatches(given, secret)) { failures.delete(addr); return null; }
    if (given) noteFailure(addr);
    return { status: 401, body: { error: '口令不正确' } };
  }

  /**
   * 热更锁校验（业主 2026-11-15 晚间「先开放口令为热更密码」）：
   *   ① 专用热更锁（admin-update-key.json，与后台口令解耦、可单独更换）—— 一直有效；
   *   ② **当前后台口令** —— 放到这里当等价的钥匙，省得记两把。
   * 想收紧（只认专用锁）：把 `|| passwordMatches(lock, secret)` 这一行删掉即可，其余代码不用动。
   */
  function updateLockOk(lock) {
    return passwordMatches(lock, updateKey) || passwordMatches(lock, secret);
  }

  /** The counters the page's top card shows (ADMIN-DESIGN.md §4 `stats`). */
  const statsOf = () => {
    // 在线数字只有一个来源: `live.stats()` when the adapter offers it (0.3.3 has no lobby.onlineSummary),
    // otherwise the same figures are derived right here. `/healthz`、这张卡 and the 在线玩家 table never disagree.
    const base = typeof live.stats === 'function' ? (live.stats() || {})
      : (typeof lobby.stats === 'function' ? lobby.stats() : {});
    let onlineNames = Array.isArray(base.onlineNames) ? base.onlineNames : null;
    let playersOnline = Number.isFinite(base.playersOnline) ? base.playersOnline : null;
    if (playersOnline === null) {
      // ★ only connected sessions — a dropped player inside its reconnect window is NOT online (§8.5)
      let n = 0;
      const names = [];
      for (const s of registry ? registry.all() : []) {
        if (!s.connected) continue;
        n++;
        if (names.length < 40) names.push(s.name);
      }
      playersOnline = n;
      onlineNames = names;
    }
    return {
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      sockets: network ? network.connectionCount : null,
      sessions: registry ? registry.size : null,
      ...base,   // rooms (online) / roomsTotal / matches / humans / bots / spectators / site
      visits: visitsOf(),
      playersOnline,
      onlineNames,
      serverName,
    };
  };

  let server = null;

  async function handleRequest(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const full = url.pathname.replace(/\/+$/, '') || '/';
    // Mounted at `mountPath` on the game's own port (`/admin`, `/admin/api/state`) or serving its own port (`/`,
    // `/api/state`) — one implementation, both entry points (ADMIN-DESIGN.md §5/§10).
    const route = full === mountPath ? '/'
      : full.startsWith(`${mountPath}/`) ? full.slice(mountPath.length)
        : full;

    // ---- /healthz: this backend's own liveness, NO password, no sensitive fields (ADMIN-DESIGN.md §10) ----
    if ((req.method === 'GET' || req.method === 'HEAD') && route === '/healthz') {
      const s = statsOf();
      sendJson(res, 200, {
        ok: true,
        admin: true,
        port: actualPort ?? publicPort ?? (port ?? opts.port),
        uptimeSec: s.uptimeSec,
        version: ADMIN_VERSION,
        build: adminBuild,
        serverName,
        game: {
          ok: true,
          sockets: s.sockets, sessions: s.sessions, playersOnline: s.playersOnline,
          rooms: s.rooms, roomsTotal: s.roomsTotal, matches: s.matches, uptimeSec: s.uptimeSec,
        },
      });
      return;
    }

    // ---- the page: public, it is only a password form until the API accepts the password ----
    if ((req.method === 'GET' || req.method === 'HEAD') && (route === '/' || route === '/index.html')) {
      noteVisit('page');
      let html;
      try { html = await fsp.readFile(PAGE, 'utf8'); } catch (e) {
        log.error?.('[admin] admin.html 读取失败', e);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(`admin.html 读取失败：${e.code || e.message}`);
        return;
      }
      // 初始口令提示 (admin.html #gate-hint): shown only while the password is still DEFAULT_ADMIN_PASSWORD — once the
      // owner sets ADMIN_PASSWORD the line would be misleading, so the page keeps it hidden
      if (usingDefaultPassword()) html = html.replace('id="gate-hint" hidden', 'id="gate-hint"');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(req.method === 'HEAD' ? undefined : html);
      return;
    }
    if (req.method === 'GET' && route === '/favicon.ico') { res.writeHead(204); res.end(); return; }

    if (!route.startsWith('/api/')) { sendJson(res, 404, { error: 'not found' }); return; }
    // known routes and their method: an unknown one is a 404, a known one called the wrong way a 405
    if (!Object.hasOwn(API_ROUTES, route)) { sendJson(res, 404, { error: 'not found' }); return; }
    const refused = authorize(req, url);
    if (refused) { sendJson(res, refused.status, refused.body); return; }
      // 方法校验：API_ROUTES 的值可以写成 'POST'，也可以写成 'GET,POST'（多方法，业主 2026-11-21 公告接口）
      const allow = String(API_ROUTES[route] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!allow.length || !allow.includes(req.method)) {
        res.setHeader('Allow', allow.join(', '));
        sendJson(res, 405, { error: 'method not allowed', allow: allow.join(', ') });
        return;
      }
    noteVisit('api');

    if (route === '/api/state') {
      const snap = live.snapshot();
      // 资源检测 (server/admin-monitor.js): the adapter's snapshot carries it; the option is the fallback
      const resource = snap.resource ?? (monitor && typeof monitor.snapshot === 'function' ? monitor.snapshot() : null);
      sendJson(res, 200, { ok: true, serverName, adminBuild, defaultPassword: usingDefaultPassword(), passwordFromEnv, stats: statsOf(), accounts: accounts ? { enabled: true } : { enabled: false }, ...snap, resource });
      return;
    }

    // ---- 账号管理（账号系统第二期）：列表 + 搜索（?q= QQ号/昵称/#tag）----
    if (route === '/api/accounts') {
      if (!accounts) { sendJson(res, 400, { error: '本服务器未启用账号系统' }); return; }
      const q = url.searchParams.get('q') || '';
      sendJson(res, 200, { ok: true, accounts: accounts.adminList({ query: q }) });
      return;
    }

    // ---- 热更（业主 2026-11-14）：上传 zip → 覆盖到安装目录，**不重启服务器** ----
    // 只动磁盘。public/** 与 data/** 立刻生效（静态文件现读），已开着的页面由 buildGuard 轮询 /healthz 察觉
    // build 变化后提示刷新（对局中不打断，等这局走完再刷）；server/** 要重启才生效，返回里会明确说。
    // 包里字节较大，所以走原始 body 而不是 JSON。
    if (route === '/api/update') {
      // 热更锁（业主 2026-11-15）：即使后台已登录，热更还必须再带一次热更锁。
      // 防的是有人趁后台页面开着直接调接口改服务器文件。
      // 当前口径（业主 2026-11-15 晚「先开放口令为热更密码」）：专用锁 或 当前后台口令 都算通过，见 updateLockOk。
      const lock = String(req.headers['x-update-key'] || '');
      if (!lock || !updateLockOk(lock)) {
        log.warn?.('[admin] 热更被拒绝：热更锁不正确');
        sendJson(res, 403, { ok: false, error: 'LOCK', message: '热更锁不正确（填专用热更锁，或当前后台口令）' });
        return;
      }
      const limit = Math.min(Number(opts.updateMaxBytes) || 256 * 1024 * 1024, 512 * 1024 * 1024);
      const raw = await readRawBody(req, limit);
      if (!raw) { sendJson(res, 413, { error: `热更包超过 ${Math.round(limit / 1024 / 1024)} MB` }); return; }
      if (raw.length < 4 || raw[0] !== 0x50 || raw[1] !== 0x4b) { sendJson(res, 400, { error: '不是 zip 文件' }); return; }
      const tmp = tempZipPath(root);
      try {
        fs.writeFileSync(tmp, raw);
        const r = importZip({ root, file: tmp, log });
        if (!r.ok) { sendJson(res, 400, { error: r.message || r.error }); return; }
        // build 标记重算：客户端下一次轮询就会看到新 build（两次确认后提示刷新）
        let buildTag = null;
        try { buildTag = typeof onFilesUpdated === 'function' ? onFilesUpdated() : null; } catch (e) { log.warn?.('[admin] 重算 build 失败', e); }
        log.info?.(`[admin] 热更已导入：${r.files} 个文件（${r.kind}），build=${buildTag}`);
        sendJson(res, 200, {
          ok: true, ...r, build: buildTag,
          note: r.needsRestart
            ? '客户端会收到刷新提示；服务端代码需要重启服务器才生效'
            : '已生效，客户端会在下一次检查（约 1 分钟内）收到刷新提示',
        });
      } catch (e) {
        log.error?.('[admin] 热更失败', e);
        sendJson(res, 500, { error: String(e?.message || e) });
      } finally {
        try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      }
      return;
    }

    // ---- 远程自重启（业主 2026-11-14）：没有守护进程时也安全 ----
    // 先对 server/**、shared/** 做 `node --check` 语法自检，**不过就拒绝重启**（否则重启后必然崩溃）；
    // 通过则拉起一个 detached 中继，稍后由它 spawn 新的 server/index.js，旧进程随即退出。
    // 新进程与启动器无关，所以启动器窗口显示「已停止」也不影响服务。
    if (route === '/api/restart') {
      // 热更锁（业主 2026-11-15）：重启同样要锁（专用锁 或 当前后台口令，见 updateLockOk），否则等于绕过热更锁的门
      const lock = String(req.headers['x-update-key'] || '');
      if (!lock || !updateLockOk(lock)) {
        log.warn?.('[admin] 重启被拒绝：热更锁不正确');
        sendJson(res, 403, { ok: false, error: 'LOCK', message: '热更锁不正确（填专用热更锁，或当前后台口令）' });
        return;
      }
      const check = syntaxCheck(root);
      if (check.bad.length) {
        log.warn?.(`[admin] 重启被拒绝：${check.bad.length} 个文件语法检查未通过`);
        sendJson(res, 409, {
          error: `已拒绝重启：${check.bad.length} 个文件语法检查未通过（重启后会起不来）`,
          checked: check.checked,
          bad: check.bad.slice(0, 8),
        });
        return;
      }
      const port = actualPort ?? publicPort ?? port ?? opts.port ?? 3000;
      const r = scheduleRestart({ root, port, log });
      if (!r.ok) { sendJson(res, 500, { error: `安排重启失败：${r.error}` }); return; }
      log.warn?.(`[admin] 已按后台请求重启（语法自检 ${check.checked} 个文件通过）`);
      sendJson(res, 200, { ok: true, restarting: true, checked: check.checked, relayPid: r.relayPid, logFile: r.logFile });
      // 响应先落袋再退出；给 socket 一点时间把 JSON 送出去
      setTimeout(() => { try { process.exit(0); } catch { /* ignore */ } }, 500).unref?.();
      return;
    }

    // 问题反馈：列表（GET）与删除（POST）
    if (route === '/api/feedback') {
      const store = typeof feedback === 'function' ? feedback() : feedback;
      if (!store) { sendJson(res, 400, { ok: false, error: '反馈功能未启用' }); return; }
      sendJson(res, 200, { ok: true, count: store.count(), items: store.list().slice(0, 200) });
      return;
    }
    // 公告系统（业主 2026-11-21）：后台编辑 data/announcement.json —— 客户端每次连接弹一次窗。
    // 文件格式见 shared/announcements.js（announcements: [{ id, title?, text, startAt, durationSeconds, level, enabled }]）。
    // 写入后由 server/announcements.js 的 2 秒轮询自动生效，不需要重启。
    if (route === '/api/announcement') {
      const file = path.join(root, 'data', 'announcement.json');
      if (req.method === 'GET') {
        let doc = { announcements: [] };
        try { doc = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { /* 还没有文件 */ }
        sendJson(res, 200, { ok: true, file, doc });
        return;
      }
      let raw = null;
      try { raw = await readJsonBody(req, ANNOUNCEMENT_BODY_MAX); } catch (e) {
        if (e && e.code === 'ETOOLARGE') { sendJson(res, 413, { error: '公告太长：正文上限 4000 字' }); return; }
        raw = null;
      }
      if (!raw) { sendJson(res, 400, { error: '请求体不是合法 JSON' }); return; }
      // 空 text = 撤下公告
      const text = typeof raw.text === 'string' ? raw.text.trim() : '';
      const title = typeof raw.title === 'string' ? raw.title.trim() : '';
      const level = ['info', 'warning', 'urgent'].includes(raw.level) ? raw.level : 'info';
      // 业主 2026-11-22：持续时长新增「永久」——hours=0 或 permanent:true，写 durationSeconds=0（endAt=null）
      const hoursRaw = Number(raw.hours);
      const permanent = raw.permanent === true || hoursRaw === 0;
      const hours = permanent ? 720 : (Number.isFinite(hoursRaw) ? Math.max(1, Math.min(720, hoursRaw)) : 720);
      // 业主 2026-11-22：「更新公告不再是更一次发一条」——**同一天内的公告只维护一条**，
      // 再发就是在这一条上**追加内容**（mode:'append'，默认），而不是另起一条。
      // 需要整段替换（例如写错要重写）时传 mode:'replace'。
      // 业主 2026-11-22 追加需求「后台弹窗公告加一个新建公告功能」：mode:'new' 另起**独立**一条（保留已有条目），
      // 并支持对单条做启用 / 停用 / 删除（action + id），否则新建出来的条目没法管理。
      const mode = raw.mode === 'new' ? 'new' : raw.mode === 'replace' ? 'replace' : 'append';
      const action = ['delete', 'enable', 'disable'].includes(raw.action) ? raw.action : null;
      const rowId = typeof raw.id === 'string' ? raw.id.trim() : '';
      const nowMs = Date.now();
      // 先读出当前所有条目（坏文件 / 不存在都当空表）
      let rows = [];
      try {
        const cur = JSON.parse(await fsp.readFile(file, 'utf8'));
        if (cur && Array.isArray(cur.announcements)) rows = cur.announcements.filter((r) => r && typeof r === 'object' && typeof r.id === 'string');
      } catch { /* 还没有旧公告 */ }
      rows = rows.slice(0, 100);

      // ---- 单条操作：启用 / 停用 / 删除 -------------------------------------------------
      if (action) {
        const i = rows.findIndex((r) => r.id === rowId);
        if (i < 0) { sendJson(res, 404, { error: '没有这条公告：' + (rowId || '(空 id)') }); return; }
        if (action === 'delete') rows.splice(i, 1);
        else rows[i] = { ...rows[i], enabled: action === 'enable' };
        const opDoc = { announcements: rows };
        try {
          const { parseAnnouncements } = await import('../shared/announcements.js');
          parseAnnouncements(opDoc);
        } catch (e) {
          sendJson(res, 400, { error: '公告内容不合法：' + (e && e.message || e) });
          return;
        }
        try {
          await fsp.mkdir(path.dirname(file), { recursive: true });
          const tmp = `${file}.tmp`;
          await fsp.writeFile(tmp, JSON.stringify(opDoc, null, 2), 'utf8');
          await fsp.rename(tmp, file);
        } catch (e) {
          sendJson(res, 500, { error: '写入失败：' + (e && e.message || e) });
          return;
        }
        const note = action === 'delete' ? '已删除这条公告' : action === 'enable' ? '已启用这条公告' : '已停用这条公告';
        sendJson(res, 200, { ok: true, mode, action, id: rowId, doc: opDoc, note });
        return;
      }

      /** 新建公告的 id：admin-<日期>-<随机>，与 parseAnnouncements 的 [A-Za-z0-9_-]{1,64} 兼容且不重复 */
      const newId = () => {
        const d = new Date(nowMs);
        const p = (v) => String(v).padStart(2, '0');
        const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
        let id = '';
        do { id = `admin-${stamp}-${Math.random().toString(36).slice(2, 6)}`; } while (rows.some((r) => r.id === id));
        return id;
      };
      const startIso = (ms) => new Date(ms).toISOString().replace('Z', '+00:00');

      // ---- 新建：独立一条，不覆盖任何已有条目 -------------------------------------------
      if (mode === 'new') {
        if (!text) { sendJson(res, 400, { error: '新建公告需要正文（不能为空）' }); return; }
        const startAtMs = nowMs - 60_000;
        const durationSeconds = permanent ? 0
          : Math.min(2592000, Math.max(60, Math.round(hours * 3600)));
        const row = {
          id: newId(),
          ...(title ? { title } : {}),
          text,
          startAt: startIso(startAtMs),
          durationSeconds,
          level,
          enabled: true,
        };
        rows.push(row);
        if (rows.length > 100) rows = rows.slice(rows.length - 100);
        const doc = { announcements: rows };
        try {
          const { parseAnnouncements } = await import('../shared/announcements.js');
          parseAnnouncements(doc);
        } catch (e) {
          sendJson(res, 400, { error: '公告内容不合法：' + (e && e.message || e) });
          return;
        }
        try {
          await fsp.mkdir(path.dirname(file), { recursive: true });
          const tmp = `${file}.tmp`;
          await fsp.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8');
          await fsp.rename(tmp, file);
        } catch (e) {
          sendJson(res, 500, { error: '写入失败：' + (e && e.message || e) });
          return;
        }
        const chars = [...text].length;
        sendJson(res, 200, {
          ok: true, mode: 'new', id: row.id, appended: false, permanent, chars, doc,
          note: `已新建公告${title ? `「${title}」` : ''}（${chars} 字${permanent ? '，永久有效' : ''}，约 2 秒内对全服生效）`,
        });
        return;
      }

      // ---- 追加 / 覆盖「今天那条」公告（其余条目原样保留） --------------------------------
      // 业主 2026-11-26 复盘：这里原来固定拿 `rows[0]`，于是**跨天**时会把上一条整条换掉 ——
      // 11-26 那次 `-Notes` 就把 11-22 那条 927 字的更新说明替换成了 51 字（只是历史里还留着一份）。
      // 口径是「每天一条」：同一天 → 在当天那条上追加 / 覆盖；换天了 → 当天新起一条，上一条只停用、不删除。
      // 全部判断都在 announcementPlan.js（纯函数、不碰文件、有单测），这里只负责读写与校验。
      const { planAnnouncementWrite } = await import('./announcementPlan.js');
      const plan = planAnnouncementWrite({ rows, text, title, level, hours, permanent, mode, nowMs });
      const doc = plan.doc;
      try {
        const { parseAnnouncements } = await import('../shared/announcements.js');
        parseAnnouncements(doc);            // 先校验，坏内容绝不写盘
      } catch (e) {
        sendJson(res, 400, { error: '公告内容不合法：' + (e && e.message || e) });
        return;
      }
      try {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8');
        await fsp.rename(tmp, file);
      } catch (e) {
        sendJson(res, 500, { error: '写入失败：' + (e && e.message || e) });
        return;
      }
      sendJson(res, 200, {
        ok: true, mode, appended: plan.appended, sameDay: plan.sameDay, permanent,
        chars: plan.chars, doc, note: plan.note,
      });
      return;
    }
    // 历史公告（业主 2026-11-22）：玩家在弹窗右侧能翻回旧公告，后台在这里看/删
    if (route === '/api/announcement/history') {
      const store = typeof announcements === 'function' ? announcements() : announcements;
      if (!store || typeof store.historyList !== 'function') {
        sendJson(res, 503, { error: '公告历史暂不可用（服务端未挂载）' });
        return;
      }
      if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, history: store.historyList() });
        return;
      }
      let raw = null;
      try { raw = await readJsonBody(req, opts.bodyMaxBytes); } catch { raw = null; }
      // 清空
      if (raw && raw.all === true) {
        const rows = store.historyList();
        let n = 0;
        for (const h of rows) { try { if (store.removeHistory(h.id)) n++; } catch { /* 单条失败不影响其余 */ } }
        sendJson(res, 200, { ok: true, removed: n, note: `已清空 ${n} 条历史公告` });
        return;
      }
      const id = raw && typeof raw.id === 'string' ? raw.id : '';
      if (!id) { sendJson(res, 400, { error: '缺少公告 id' }); return; }
      const removed = store.removeHistory(id);
      sendJson(res, removed ? 200 : 404, removed ? { ok: true, id, note: '已删除' } : { error: '没有这条历史公告', id });
      return;
    }
    if (route === '/api/feedback/update') {
      const store = typeof feedback === 'function' ? feedback() : feedback;
      if (!store) { sendJson(res, 400, { ok: false, error: '反馈功能未启用' }); return; }
      let raw = null;
      try { raw = await readJsonBody(req, opts.bodyMaxBytes); } catch { raw = null; }
      const id = raw && typeof raw.id === 'string' ? raw.id : '';
      if (!id) { sendJson(res, 400, { error: '缺少 id' }); return; }
      const row = store.update(id, {
        status: raw.status === 'resolved' || raw.status === 'open' ? raw.status : undefined,
        reply: typeof raw.reply === 'string' ? raw.reply : undefined,
      });
      // 业主 2026-11-21：给反馈人推一条消息（他登录状态下提交的才有 accountId），带跳转按钮
      if (row && typeof raw.reply === 'string' && raw.reply.trim() && row.accountId) {
        const msgStore = typeof messages === 'function' ? messages() : messages;
        try {
          msgStore?.add?.(row.accountId, {
            type: 'feedback',
            title: '你的反馈有回复了',
            text: `「${String(row.text || '').slice(0, 60)}」\n回复：${String(raw.reply).slice(0, 300)}`,
            action: { kind: 'feedback', value: row.id },
          });
        } catch (e) { log.warn?.('[admin] 反馈回复消息推送失败', e); }
      }
      sendJson(res, row ? 200 : 404, row ? { ok: true, item: row } : { error: '找不到这条反馈' });
      return;
    }
    if (route === '/api/feedback/delete') {
      const store = typeof feedback === 'function' ? feedback() : feedback;
      if (!store) { sendJson(res, 400, { ok: false, error: '反馈功能未启用' }); return; }
      let raw = null;
      try { raw = await readJsonBody(req, opts.bodyMaxBytes); } catch { raw = null; }
      const id = raw && typeof raw.id === 'string' ? raw.id : '';
      if (!id) { sendJson(res, 400, { error: '缺少 id' }); return; }
      const done = store.remove(id);
      sendJson(res, done ? 200 : 404, done ? { ok: true } : { error: '找不到这条反馈' });
      return;
    }

    let body;
    try { body = await readJsonBody(req, opts.bodyMaxBytes); } catch (e) {
      sendJson(res, 400, { error: e.message === 'body too large' ? '请求体过大' : '请求体不是合法 JSON' });
      return;
    }

    if (route === '/api/notice') {
      const text = typeof body.text === 'string' ? body.text.slice(0, NOTICE_MAX) : '';
      const notice = live.announce(text, body.ttlMin);
      sendJson(res, 200, { ok: true, notice });
      return;
    }
    // 修改口令: writes admin-password.json (scrypt, never the plain text) and swaps the live secret at once — the old
    // password stops working on the next request. An env-set password stays the deployment's own (409 here).
    if (route === '/api/password') {
      if (passwordFromEnv) {
        sendJson(res, 409, { error: '当前口令由环境变量 ADMIN_PASSWORD 指定，请在启动脚本里修改后重启服务器' });
        return;
      }
      const next = typeof body.next === 'string' ? body.next : '';
      if (next.length < 6 || next.length > 64) { sendJson(res, 400, { error: '新口令需要 6–64 个字符' }); return; }
      if (next === DEFAULT_ADMIN_PASSWORD) { sendJson(res, 400, { error: '新口令不能继续用初始口令 88888888' }); return; }
      if (passwordMatches(next, secret)) { sendJson(res, 400, { error: '新口令和当前口令相同' }); return; }
      if (typeof body.current === 'string' && body.current && !passwordMatches(body.current, secret)) {
        sendJson(res, 401, { error: '当前口令不对' });
        return;
      }
      try {
        secret = writeStoredPassword(next);
      } catch (e) {
        log.error?.('[admin] 写入 admin-password.json 失败', e);
        sendJson(res, 500, { error: '新口令没能保存到磁盘：' + (e.code || e.message || e) });
        return;
      }
      sendJson(res, 200, { ok: true, persisted: true, updatedAt: secret.updatedAt });
      return;
    }
    if (route === '/api/kick') {
      if (typeof body.playerId !== 'string' || !body.playerId) { sendJson(res, 400, { error: '缺少 playerId' }); return; }
      const kicked = live.kick(body.playerId);
      // idempotent: a repeated kick is a 404 with a reason, never a crash (ADMIN-DESIGN.md §8.7)
      if (!kicked) { sendJson(res, 404, { error: '找不到这名玩家（可能已经离开）' }); return; }
      sendJson(res, 200, { ok: true, kicked });
      return;
    }
    if (route === '/api/close-room') {
      if (typeof body.code !== 'string' || !body.code) { sendJson(res, 400, { error: '缺少房间密钥' }); return; }
      const closed = live.closeRoom(body.code);
      if (!closed) { sendJson(res, 404, { error: '找不到这个房间（可能已经关闭）' }); return; }
      sendJson(res, 200, { ok: true, closed });
      return;
    }
    if (route === '/api/gate') {
      if (typeof body.open !== 'boolean') { sendJson(res, 400, { error: '缺少 open（true/false）' }); return; }
      const gate = live.setOpen(body.open, {
        text: typeof body.text === 'string' ? body.text : null,
        reason: typeof body.reason === 'string' && body.reason ? body.reason : 'admin',
      });
      sendJson(res, 200, { ok: true, gate });
      return;
    }
    if (route === '/api/warn') {
      const seconds = Number(body.seconds);
      if (!Number.isFinite(seconds) || seconds < 0) { sendJson(res, 400, { error: '缺少 seconds（秒，0 = 取消）' }); return; }
      if (!seconds) { live.clearWarn(); sendJson(res, 200, { ok: true, warn: null }); return; }
      const warn = live.armFlashWarn(seconds, {
        text: typeof body.text === 'string' ? body.text : null,
        closeOnExpire: body.closeOnExpire !== false,
      });
      sendJson(res, 200, { ok: true, warn });
      return;
    }

    // ---- 直接登录他人账号（业主 2026-11-24）----------------------------------------------
    // 后台点「登录」/输入 QQ → 给这个账号签发一个新会话，把 sp_acc cookie 种到后台自己的浏览器，
    // 之后打开游戏页就是以该账号身份。**不会**踢掉玩家自己的会话（后台只是多一个客户端）。
    if (route === '/api/accounts/login-as') {
      if (!accounts) { sendJson(res, 400, { error: '本服务器未启用账号系统' }); return; }
      const idIn = typeof body.id === 'string' ? body.id.trim() : '';
      const qqIn = typeof body.qq === 'string' ? body.qq.trim() : '';
      let acc = null;
      if (idIn) acc = accounts.accountById(idIn);
      else if (qqIn) {
        const rows = accounts.adminList({ query: qqIn, limit: 20 }).filter((r) => r && String(r.qq || '') === qqIn);
        if (rows.length > 1) { sendJson(res, 409, { error: '同一个 QQ 命中多个账号，请改用账号 id' }); return; }
        if (rows.length === 1) acc = accounts.accountById(rows[0].id);
      }
      if (!acc) { sendJson(res, 404, { error: '找不到这个账号（请填账号 id 或完整 QQ 号）' }); return; }
      // view() 不带封禁状态 / QQ：后台行里有（adminRowsOf → adminList 的同一行）
      const adminRow = accounts.adminRowsOf(acc.id);
      if (adminRow && adminRow.ban) { sendJson(res, 400, { error: '该账号已被封禁，无法登录' }); return; }
      const { token } = accounts.createSession(acc.id);
      // 与 server/accounts/http.js 的登录 cookie 同一口径（路径 /、HttpOnly、SameSite=Lax、30 天）
      res.setHeader('Set-Cookie', `sp_acc=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
      log.info?.(`[admin] 直接登录账号 ${acc.nickname}${acc.tag ? '#' + acc.tag : ''} (${acc.id})`);
      sendJson(res, 200, { ok: true, account: { id: acc.id, nickname: acc.nickname, tag: acc.tag, qq: (adminRow && adminRow.qq) || null } });
      return;
    }

    // ---- 账号管理（账号系统第二期）：封禁 / 解封 / 重置密码 / 管理员 / 重命名 / 删除 ----
    if (route === '/api/accounts/ban' || route === '/api/accounts/unban' || route === '/api/accounts/reset' || route === '/api/accounts/setAdmin'
      || route === '/api/accounts/rename' || route === '/api/accounts/delete') {
      if (!accounts) { sendJson(res, 400, { error: '本服务器未启用账号系统' }); return; }
      const id = typeof body.id === 'string' ? body.id : '';
      if (!id) { sendJson(res, 400, { error: '缺少 id' }); return; }
      try {
        if (route === '/api/accounts/setAdmin') {
          // 业主 2026-11-14：后台可设/取消管理员，客户端头像右上角显示金标
          sendJson(res, 200, { ok: true, account: accounts.setAdmin(id, body.admin === true) });
          return;
        }
        // 业主 2026-11-17：后台重命名账号（不受玩家侧改名冷却限制，但固定账号仍拒绝）
        if (route === '/api/accounts/rename') {
          const nickname = typeof body.nickname === 'string' ? body.nickname : '';
          const account = accounts.adminRename(id, nickname);
          log.info?.(`[admin] 重命名账号 ${id} → ${account?.nickname || nickname}`);
          sendJson(res, 200, { ok: true, account });
          return;
        }
        // 业主 2026-11-17：后台删除账号（账号 + 云存档 + 会话 + 好友关系）
        if (route === '/api/accounts/delete') {
          const removed = accounts.remove(id);
          // 社交存储在账号之后才创建：推迟到第一次请求时取（与 feedback 同一套写法）
          const socialStore = typeof social === 'function' ? social() : social;
          const purged = socialStore && typeof socialStore.purge === 'function' ? socialStore.purge(id) : null;
          // 在线连接踢下线，客户端会回登录页
          if (network) network.dropAccount(id, '账号已被管理员删除');
          log.info?.(`[admin] 删除账号 ${removed.qq} (${removed.nickname}) #${id}${purged ? ` · 社交清理 ${JSON.stringify(purged)}` : ''}`);
          sendJson(res, 200, { ok: true, removed, social: purged });
          return;
        }
        if (route === '/api/accounts/ban') {
          const row = accounts.ban(id, { reason: typeof body.reason === 'string' ? body.reason : '', by: 'admin' });
          if (network) network.dropAccount(id, '账号已被封禁');
          sendJson(res, 200, { ok: true, account: row });
          return;
        }
        if (route === '/api/accounts/unban') {
          sendJson(res, 200, { ok: true, account: accounts.unban(id) });
          return;
        }
        const password = typeof body.password === 'string' ? body.password : '';
        if (password.length < 8 || password.length > 128) { sendJson(res, 400, { error: '新密码需要 8–128 位' }); return; }
        await accounts.resetPassword(id, password);
        // 改密后旧会话已作废，把在线连接踢下线（客户端会回登录页）
        if (network) network.dropAccount(id, '密码已被管理员重置');
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendJson(res, Number.isInteger(e && e.status) ? e.status : 500, { error: (e && e.message) || '操作失败' });
        return;
      }
    }
    sendJson(res, 404, { error: 'not found' });
  }

  /** The one request handler: used by the mounted route (server/http/routes.js) and by our own listener alike. */
  function handle(req, res) {
    handleRequest(req, res).catch((e) => {
      log.error?.('[admin] 请求处理失败', e);
      if (!res.headersSent) sendJson(res, 500, { error: '后台内部错误' });
      else res.destroy();
    });
  }

  /** Does this raw path belong to the backend (`/admin`, `/admin/`, `/admin/api/*`, `/admin/healthz`)? */
  function handles(rawPath) {
    const p = String(rawPath || '/').replace(/\/+$/, '') || '/';
    return p === mountPath || p === `${mountPath}/index.html` || p === `${mountPath}/healthz`
      || p === `${mountPath}/favicon.ico` || p.startsWith(`${mountPath}/api/`);
  }

  let actualPort = null;
  /**
   * Start listening. Resolves with the bound address; rejects when the port is taken (the caller decides whether that
   * is fatal — server/index.js only warns, so the game keeps running without a backend).
   */
  async function listen(bind = {}) {
    const p = bind.port ?? port ?? opts.port;
    const h = bind.host ?? host ?? opts.host;
    // The standalone listener is OPTIONAL now: the backend normally rides on the game's own port at `mountPath`, and
    // server/index.js only calls this when ADMIN_PORT was asked for explicitly.
    const ownServer = http.createServer(handle);
    await new Promise((resolve, reject) => {
      const onError = (e) => { ownServer.off('listening', onListening); reject(e); };
      const onListening = () => { ownServer.off('listening', onListening); resolve(); };
      ownServer.once('error', onError);
      ownServer.once('listening', onListening);
      ownServer.listen(p, h);
    });
    ownServer.on('error', (e) => log.error?.('[admin] 服务器错误', e));
    server = ownServer;
    const addr = ownServer.address();
    actualPort = typeof addr === 'object' && addr ? addr.port : p;
    return { port: actualPort, host: h };
  }

  async function close() {
    if (!server) return;
    try { server.closeIdleConnections?.(); } catch { /* ignore */ }
    await new Promise((resolve) => {
      server.close(() => resolve());
      setTimeout(() => { try { server.closeAllConnections?.(); } catch { /* ignore */ } }, 300).unref?.();
    });
  }

  return {
    server: null, handle, handles, listen, close, opts, password: secret, pagePath: PAGE, build: adminBuild,
    mountPath, visits: visitsOf, stats: statsOf,
    /** The game port /admin rides on (shown in /admin/healthz when there is no listener of our own). */
    setPublicPort(p) { publicPort = p; },
    /** The port of our own listener (null while we only ride on the game's). */
    get port() { return actualPort; },
  };
}

/** Convenience: create + listen. Used by server/index.js; also handy in tests. */
export async function startAdminServer(o) {
  const admin = createAdminServer(o);
  const bound = await admin.listen();
  return { ...admin, ...bound };
}

/** True when the page file exists (server/index.js warns once at boot when a deployment forgot it). */
export const adminPageExists = () => fs.existsSync(PAGE);
