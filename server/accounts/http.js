// server/accounts/http.js — 账号 HTTP API（/api/account/*）。
//
// 为什么走 HTTP 而不是 WebSocket：登录必须发生在 WS 握手之前（hello 时要凭 cookie 绑定账号），
// 且密码等敏感字段不该走游戏协议/回放；HTTP 用 HttpOnly cookie，JS 读不到，天然防 XSS 窃取。
//
// 路由（全部 JSON；错误统一 `{ ok:false, error:CODE, message }`）：
//   POST /api/account/register   { username, password }
//   POST /api/account/login      { username, password }        → 单设备：旧会话作废
//   POST /api/account/logout
//   GET  /api/account/me
//   POST /api/account/rename     { nickname }                  7 天冷却
//   POST /api/account/profile    { avatarId?, frameId?, cardId? }
//   GET  /api/account/save
//   PUT  /api/account/save       { save }
//   POST /api/account/save/merge { save }                      首次登录把本地存档并进来
//
// 防护：注册同 IP 每小时 3 次、登录同 IP 每分钟 10 次（都是内存滑动窗口，重启即清空 —— 账号系统规模小，够用）。
import { sendJson } from '../http/common.js';
import { clientAddress } from '../net.js';

const COOKIE = 'sp_acc';
// 请求体上限（业主 2026-11-28 报障：云存档同步报「连不上服务器」，接口是 /api/account/save/merge）。
// 原来这里是 64 KB，而存档本身上限是 512 KB（service.js 的 SAVE_MAX_BYTES）—— 两个上限打架：
// 存档一大就在 readBody 里被判超限，紧接着 req.destroy()，客户端只看到 ERR_EMPTY_RESPONSE。
// 现在信封给到 1 MB（512 KB 存档 + JSON 包装余量）；超限时**读完再回 413**，不再砍连接。
const BODY_MAX = 1024 * 1024;
// 真正的护栏：超过这个量就不读了（保护内存），只有这一档才断连接。
const BODY_DRAIN_MAX = 8 * 1024 * 1024;
// 业主 2026-11-15：单 IP 1 小时内最多注册 10 个账号（原为 3）。
// 只在**注册成功**后计数（wouldAllow 只检查、成功后 hit 记账），所以填错 QQ / 密码不会把自己锁一小时。
// 另设一个宽松的「尝试上限」兜底，防止有人靠无限失败来枚举 QQ 号是否已注册。
const REGISTER_PER_HOUR = 10;
const REGISTER_ATTEMPTS_PER_HOUR = 60;
// 连续失败 5 次 → 锁 1 分钟（成功后清零）。比锁一小时温和，又能挡住快速撞库。
const REGISTER_FAILS_BEFORE_LOCK = 5;
const REGISTER_LOCK_MS = 60 * 1000;
const LOGIN_PER_MIN = 10;

/** 滑动窗口限速：key → 时间戳数组。 */
class Window {
  constructor(limit, windowMs) { this.limit = limit; this.windowMs = windowMs; this.map = new Map(); }
  /** 只看有没有超限，**不计数**（业主 2026-11-15：注册失败不该占名额）。 */
  wouldAllow(key, now = Date.now()) {
    const arr = (this.map.get(key) || []).filter((t) => now - t < this.windowMs);
    return arr.length < this.limit;
  }
  hit(key, now = Date.now()) {
    const arr = (this.map.get(key) || []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.limit) { this.map.set(key, arr); return false; }
    arr.push(now);
    this.map.set(key, arr);
    if (this.map.size > 5000) { for (const [k, v] of this.map) if (!v.length || now - v[v.length - 1] > this.windowMs) this.map.delete(k); }
    return true;
  }
}

/** `a=1; b=2` → { a: '1', b: '2' }（去引号、解码，只取第一段）。 */
function parseCookies(header) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || out[k] !== undefined) continue;
    out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_DRAIN_MAX) {
        // 极端情况（几百 MB）：不值得为了回一句话把内存吃满，直接断
        reject(Object.assign(new Error('body way too large'), { status: 413, code: 'E_BODY_BIG' }));
        req.destroy();
        return;
      }
      if (size > BODY_MAX) { tooBig = true; return; }   // 超限：不再攒数据，但继续把流读完，好让 413 真的发得出去
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) { reject(Object.assign(new Error('body too large'), { status: 413, code: 'E_BODY_BIG' })); return; }
      if (!chunks.length) { resolve(null); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('bad json'), { status: 400, code: 'E_JSON' })); }
    });
    req.on('error', reject);
  });
}

/** 是否 HTTPS（直连或反代）。 */
function isSecure(req) {
  if (req.socket && req.socket.encrypted) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

function setCookie(req, res, token, maxAgeSec) {
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (isSecure(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function createAccountApi({ service, log = console, trustProxy = 'auto', onSessionReplaced = null }) {
  // 业主 2026-11-21「账号在其他设备登录时不清空登录状态」：默认**多设备并存**，登录不再踢掉别的设备。
  // 需要临时回到旧的单设备行为（新登录顶掉所有旧连接）时，设 SP_SINGLE_DEVICE=1 重启即可。
  const SINGLE_DEVICE = String(process.env.SP_SINGLE_DEVICE || '') === '1';
  const registerWindow = new Window(REGISTER_PER_HOUR, 3600 * 1000);
const registerAttempt = new Window(REGISTER_ATTEMPTS_PER_HOUR, 3600 * 1000);
/**
 * 注册失败计数（业主 2026-11-15）：连续失败 5 次锁 1 分钟。
 * addr → { fails, until }；成功注册或锁到期后清零。
 */
const registerFails = new Map();
const failState = (addr) => {
  const st = registerFails.get(addr);
  if (!st) return null;
  if (st.until && Date.now() >= st.until) { registerFails.delete(addr); return null; }
  return st;
};
/**
 * 记录一次失败；达到阈值就上锁。
 * @returns {boolean} 这一次是否**刚好触发**了锁定（调用方据此直接回 429，而不是再报一次参数错误）
 */
function noteRegisterFail(addr) {
  const st = failState(addr) || { fails: 0, until: 0 };
  st.fails += 1;
  let justLocked = false;
  if (st.fails >= REGISTER_FAILS_BEFORE_LOCK) {
    st.until = Date.now() + REGISTER_LOCK_MS;
    st.fails = 0;
    justLocked = true;
  }
  registerFails.set(addr, st);
  if (registerFails.size > 5000) { for (const [k, v] of registerFails) if (!v.until || Date.now() >= v.until) registerFails.delete(k); }
  return justLocked;
}
  const loginWindow = new Window(LOGIN_PER_MIN, 60 * 1000);

  const cookieToken = (req) => parseCookies(req.headers.cookie)[COOKIE] || null;
  const currentAccount = (req) => service.resolve(cookieToken(req));

  const reply = (req, res, status, body) => sendJson(req, res, status, body);
  const failReply = (req, res, e) => {
    const status = Number.isInteger(e && e.status) ? e.status : 500;
    reply(req, res, status, { ok: false, error: (e && e.code) || 'E_INTERNAL', message: (e && e.message) || '服务器内部错误' });
  };

  /** 需要登录的路由：未登录一律 401。 */
  const requireAccount = (req, res) => {
    const account = currentAccount(req);
    if (!account) { reply(req, res, 401, { ok: false, error: 'E_AUTH', message: '请先登录' }); return null; }
    return account;
  };

  function handles(pathname) { return pathname === '/api/account' || pathname.startsWith('/api/account/'); }

  async function handle(req, res, pathname) {
    const addr = clientAddress(req, trustProxy).ip || 'unknown';
    const method = req.method || 'GET';
    try {
      if (method === 'OPTIONS') { res.writeHead(204, { Allow: 'GET, POST, PUT' }); res.end(); return; }

      if (pathname === '/api/account/register' && method === 'POST') {
        // ① 连续失败 5 次 → 锁 1 分钟（最先生效，给用户明确的等待感）
        const locked = failState(addr);
        if (locked && locked.until > Date.now()) {
          const secs = Math.ceil((locked.until - Date.now()) / 1000);
          reply(req, res, 429, { ok: false, error: 'E_LOCKED', message: `失败次数过多，请 ${secs} 秒后再试` });
          return;
        }
        // ② 名额：先「只看不记」；注册成功后才记账（失败不占 10 个名额）
        if (!registerWindow.wouldAllow(addr)) { reply(req, res, 429, { ok: false, error: 'E_RATE', message: '注册太频繁了，请稍后再试' }); return; }
        // ③ 尝试上限兜底：每请求都记，防止靠无限失败枚举 QQ
        if (!registerAttempt.hit(addr)) { reply(req, res, 429, { ok: false, error: 'E_RATE', message: '尝试次数太多了，请稍后再试' }); return; }
        const body = await readBody(req);
        if (!body || body.agree !== true) { reply(req, res, 400, { ok: false, error: 'E_AGREE', message: '需要先同意用户协议与隐私政策' }); return; }
        let account;
        try {
          account = await service.register({ username: body.username, password: body.password, nickname: body.nickname });
        } catch (e) {
          // 失败：只累加失败次数，**不占**注册名额。
          // 如果这一下刚好凑满 5 次，直接回 429 告诉用户被锁多久（而不是再报一次「QQ 号不对」）
          if (noteRegisterFail(addr)) {
            reply(req, res, 429, {
              ok: false, error: 'E_LOCKED',
              message: `失败次数过多，请 ${Math.ceil(REGISTER_LOCK_MS / 1000)} 秒后再试`,
            });
            return;
          }
          throw e;
        }
        registerFails.delete(addr);  // 成功：失败计数清零
        registerWindow.hit(addr);    // 成功：占掉一个名额
        const { token } = service.createSession(account.id);
        setCookie(req, res, token, 30 * 24 * 3600);
        reply(req, res, 200, { ok: true, account });
        return;
      }

      if (pathname === '/api/account/login' && method === 'POST') {
        if (!loginWindow.hit(addr)) { reply(req, res, 429, { ok: false, error: 'E_RATE', message: '登录尝试太频繁，请稍后再试' }); return; }
        const body = await readBody(req);
        const { account, token, replaced } = await service.login({ username: body?.username, password: body?.password });
        // 多设备（业主 2026-11-21）：登录**不再**断开该账号其它设备的连接 —— 换设备登录不会把这台顶下线。
        // 旧行为：replaced 为真时 network.dropAccount(account.id) 清掉全部连接；SP_SINGLE_DEVICE=1 可恢复。
        if (SINGLE_DEVICE && replaced && typeof onSessionReplaced === 'function') { try { onSessionReplaced(account.id); } catch (e) { log.error('[accounts] onSessionReplaced crashed', e); } }
        if (!SINGLE_DEVICE && replaced && log.info) {
          try { log.info(`[accounts] 多设备登录：${account.nickname || account.id} 新增一条会话，其它设备保持在线`); } catch { /* 日志失败无所谓 */ }
        }
        setCookie(req, res, token, 30 * 24 * 3600);
        reply(req, res, 200, { ok: true, account });
        return;
      }

      if (pathname === '/api/account/logout' && method === 'POST') {
        service.logout(cookieToken(req));
        setCookie(req, res, '', 0);
        reply(req, res, 200, { ok: true });
        return;
      }

      if (pathname === '/api/account/me' && method === 'GET') {
        const account = currentAccount(req);
        // 本人视图（带 QQ 号）：QQ 号是登录凭据，只在「本人」的响应里出现
        reply(req, res, 200, { ok: true, account: account ? service.constructor.view(account, { self: true }) : null });
        return;
      }

      if (pathname === '/api/account/rename' && method === 'POST') {
        const account = requireAccount(req, res); if (!account) return;
        const body = await readBody(req);
        const view = service.rename(account.id, body?.nickname);
        reply(req, res, 200, { ok: true, account: view });
        return;
      }

      if (pathname === '/api/account/profile' && method === 'POST') {
        const account = requireAccount(req, res); if (!account) return;
        const body = await readBody(req);
        const view = service.updateProfile(account.id, body || {});
        reply(req, res, 200, { ok: true, account: view });
        return;
      }

      if (pathname === '/api/account/save' && method === 'GET') {
        const account = requireAccount(req, res); if (!account) return;
        reply(req, res, 200, { ok: true, save: service.getSave(account.id) });
        return;
      }

      if (pathname === '/api/account/save' && method === 'PUT') {
        const account = requireAccount(req, res); if (!account) return;
        const body = await readBody(req);
        const saved = service.putSave(account.id, body?.save);
        reply(req, res, 200, { ok: true, updatedAt: saved.updatedAt });
        return;
      }

      if (pathname === '/api/account/save/merge' && method === 'POST') {
        const account = requireAccount(req, res); if (!account) return;
        const body = await readBody(req);
        const saved = service.mergeSave(account.id, body?.save);
        reply(req, res, 200, { ok: true, save: { ...saved, fields: service.pickFields(saved) } });
        return;
      }

      reply(req, res, 404, { ok: false, error: 'E_NOT_FOUND' });
    } catch (e) {
      if (e && e.code === 'E_JSON') { reply(req, res, 400, { ok: false, error: 'E_JSON', message: '请求体不是合法 JSON' }); return; }
      if (e && e.code === 'E_BODY_BIG') { reply(req, res, 413, { ok: false, error: 'E_BODY_BIG', message: '请求体过大' }); return; }
      if (!e || !e.status || e.status >= 500) { try { log.error('[accounts] api failed', e); } catch { /* ignore */ } }
      failReply(req, res, e);
    }
  }

  return { handles, handle, cookieToken, currentAccount };
}

export { COOKIE, parseCookies };
