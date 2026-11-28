// server/accounts/socialHttp.js — 好友 / 黑名单 / 邀请 / 消息 的 HTTP API（/api/social/*、/api/messages）。
//
// 全部需要登录（cookie `sp_acc`）；错误沿用账号 API 的形状 `{ ok:false, error:CODE, message }`。
//   GET  /api/social                 我的好友页数据：{ friends, requests, sent, blocked }
//   GET  /api/social/find?q=         找人：QQ 号 / 昵称#tag / 昵称片段（只回公开身份）
//   POST /api/social/request { id }  发好友请求（对方也请求过我时直接成为好友）
//   POST /api/social/accept  { id }
//   POST /api/social/reject  { id }
//   POST /api/social/remove  { id }
//   POST /api/social/block   { id }
//   POST /api/social/unblock { id }
//   POST /api/social/invite  { id, code }   邀请好友进房（推送到对方在线会话）
//   GET  /api/messages               我的消息列表（业主 2026-11-21）：{ items, unread }
//   POST /api/messages/read  { ids? } 标记已读（ids 省略 = 全部）
import { sendJson } from '../http/common.js';
import { parseCookies, COOKIE } from './http.js';

const BODY_MAX = 64 * 1024;
// 超过这个量就不读了（保护内存），只有这一档才断连接；BODY_MAX 之上只是回 413（2026-11-28）。
const BODY_DRAIN_MAX = 2 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_DRAIN_MAX) {
        reject(Object.assign(new Error('way too large'), { status: 413, code: 'E_BODY_BIG' }));
        req.destroy();
        return;
      }
      if (size > BODY_MAX) { tooBig = true; return; }   // 超限也把流读完，才发得出 413（2026-11-28，同 accounts/http.js）
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) { reject(Object.assign(new Error('too large'), { status: 413, code: 'E_BODY_BIG' })); return; }
      if (!chunks.length) { resolve({}); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('bad json'), { status: 400, code: 'E_JSON' })); }
    });
    req.on('error', reject);
  });
}

/**
 * @param {{ service: any, accounts: any, log?: object, lobby?: any }} deps  service = SocialService；accounts = AccountService；
 *   lobby = Lobby（独立模拟停放：/api/solo/parked、/api/solo/end）
 */
export function createSocialApi({ service, accounts, log = console, lobby = null, messages = null }) {
  const meOf = (req) => {
    try {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      return token ? accounts.resolve(token) : null;
    } catch { return null; }
  };

  function handles(pathname) {
    return pathname === '/api/social' || pathname.startsWith('/api/social/')
      || pathname === '/api/messages' || pathname === '/api/messages/read'
      || pathname === '/api/solo/parked' || pathname === '/api/solo/end';
  }

  async function handle(req, res, pathname, query = '') {
    const me = meOf(req);
    if (!me) { sendJson(req, res, 401, { ok: false, error: 'E_AUTH', message: '请先登录' }); return; }
    const method = req.method || 'GET';
    try {
      // 独立模拟停放（业主 2026-11-14）：查询 24 小时内可「继续游戏」的房间 / 结束它
      if (pathname === '/api/solo/parked' && method === 'GET') {
        const parked = lobby && typeof lobby.parkedSoloOf === 'function' ? lobby.parkedSoloOf(me.id) : null;
        sendJson(req, res, 200, { ok: true, parked: parked || null });
        return;
      }
      if (pathname === '/api/solo/end' && method === 'POST') {
        const ended = lobby && typeof lobby.endParkedSolo === 'function' ? lobby.endParkedSolo(me.id) : false;
        sendJson(req, res, 200, { ok: true, ended });
        return;
      }
      if (pathname === '/api/messages' && method === 'GET') {
        const items = messages ? messages.list(me.id) : [];
        sendJson(req, res, 200, { ok: true, items, unread: messages ? messages.unread(me.id) : 0 });
        return;
      }
      if (pathname === '/api/messages/read' && method === 'POST') {
        const b = await readBody(req);
        const ids = Array.isArray(b && b.ids) ? b.ids.slice(0, 200) : null;
        const n = messages ? messages.markRead(me.id, ids) : 0;
        sendJson(req, res, 200, { ok: true, marked: n, unread: messages ? messages.unread(me.id) : 0 });
        return;
      }
      if (pathname === '/api/social' && method === 'GET') {
        sendJson(req, res, 200, { ok: true, ...service.overview(me.id) });
        return;
      }
      if (pathname === '/api/social/find' && method === 'GET') {
        const q = new URLSearchParams(String(query || '').replace(/^\?/, '')).get('q') || '';
        const found = service.find(q).filter((a) => a.id !== me.id);
        sendJson(req, res, 200, { ok: true, accounts: found });
        return;
      }
      if (method !== 'POST') { sendJson(req, res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }); return; }
      const body = await readBody(req);
      const id = typeof body.id === 'string' ? body.id : '';
      switch (pathname) {
        case '/api/social/request': sendJson(req, res, 200, { ok: true, ...service.request(me.id, id) }); return;
        case '/api/social/accept': sendJson(req, res, 200, { ok: true, ...service.accept(me.id, id) }); return;
        case '/api/social/reject': sendJson(req, res, 200, { ok: true, ...service.reject(me.id, id) }); return;
        case '/api/social/remove': sendJson(req, res, 200, { ok: true, ...service.remove(me.id, id) }); return;
        case '/api/social/block': sendJson(req, res, 200, { ok: true, ...service.block(me.id, id) }); return;
        case '/api/social/unblock': sendJson(req, res, 200, { ok: true, ...service.unblock(me.id, id) }); return;
        case '/api/social/invite': sendJson(req, res, 200, { ok: true, ...service.invite(me.id, id, body.code) }); return;
        default: sendJson(req, res, 404, { ok: false, error: 'E_NOT_FOUND' });
      }
    } catch (e) {
      const status = Number.isInteger(e && e.status) ? e.status : 500;
      if (status >= 500) { try { log.error?.('[social] api failed', e); } catch { /* ignore */ } }
      sendJson(req, res, status, { ok: false, error: (e && e.code) || 'E_INTERNAL', message: (e && e.message) || '服务器内部错误' });
    }
  }

  return { handles, handle, meOf };
}
