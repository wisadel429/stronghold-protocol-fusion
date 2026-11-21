// server/feedback.js — 玩家问题反馈（业主 2026-11-14）：客户端提交，后台列表查看。
//
//   POST /api/feedback   { text, diag? }   → { ok:true, id }
//   存到 data/feedback.json（数组，最多保留 MAX 条，写盘走临时文件 + rename）。
//
// 为什么要服务端中转：玩家的启动器是本地 file:// 打开的，直接连 QQ 群/外链体验差；
// 提交到**他正在连的那台服务器**，你在后台就能按顺序看到，诊断信息也一起带上来了。
//
// 防护：按 IP 限流（默认 30 秒 1 条、每小时 10 条）、单条长度上限、最多保留 500 条。

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const MAX_KEEP = 500;
const TEXT_MAX = 4000;
const DIAG_MAX = 4000;
const GAP_MS = 30_000;
const PER_HOUR = 10;

/**
 * @param {{ file: string, log?: any, now?: () => number }} o
 */
export function createFeedbackStore({ file, log = console, now = Date.now }) {
  let rows = null;

  const load = () => {
    if (rows) return rows;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      rows = Array.isArray(j) ? j : (Array.isArray(j.items) ? j.items : []);
    } catch { rows = []; }
    return rows;
  };

  const save = () => {
    const list = load().slice(-MAX_KEEP);
    rows = list;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, items: list }), 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) { log.error?.('[feedback] 写盘失败', e); }
  };

  return {
    file,
    list: () => load().slice().reverse(),
    count: () => load().length,
    // 业主 2026-11-20「反馈要不匿名，并且展示反馈人的名字」：记下提交者的 昵称#tag 与来源 IP
    // （IP 同时用于 HTTP 层的内存限流，见 createFeedbackApi 的 seen 表）。
    add({ text, diag = '', ip = '', name = '', accountId = '' }) {
      const row = {
        id: 'fb_' + randomBytes(5).toString('hex'),
        at: now(),
        text: String(text || '').slice(0, TEXT_MAX),
        diag: String(diag || '').slice(0, DIAG_MAX),
        ip: String(ip || '').slice(0, 64),
        name: String(name || '').slice(0, 64),
        // 业主 2026-11-21：记下提交者账号（登录状态下提交时才有），后台回复后据此推一条消息
        accountId: String(accountId || '').slice(0, 40),
        // 业主 2026-11-21「后台加回复框 + 已解决/未解决，已解决自动折叠」
        status: 'open',       // open | resolved
        reply: '',            // 管理员的回复（玩家端暂不展示，先落盘备查）
        repliedAt: null,
      };
      load().push(row);
      save();
      return row;
    },
    /**
     * 改一条反馈的状态 / 回复（后台）。
     * @param {string} id
     * @param {{ status?: 'open'|'resolved', reply?: string }} patch
     * @returns {any|null} 改完的行；找不到返回 null
     */
    update(id, patch = {}) {
      const list = load();
      const row = list.find((r) => r && r.id === id);
      if (!row) return null;
      if (patch.status === 'resolved' || patch.status === 'open') row.status = patch.status;
      if (typeof patch.reply === 'string') {
        row.reply = patch.reply.slice(0, TEXT_MAX);
        row.repliedAt = row.reply ? now() : null;
      }
      save();
      return row;
    },
    remove(id) {
      const list = load();
      const i = list.findIndex((r) => r && r.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      save();
      return true;
    },
  };
}

/**
 * /api/feedback 的 HTTP 端点。启动器页面是 file:// 打开的，所以必须带 CORS。
 * @param {{ store: ReturnType<typeof createFeedbackStore>, log?: any, now?: () => number }} o
 */
export function createFeedbackApi({ store, log = console, now = Date.now, identify = null }) {
  /** @type {Map<string, { at: number, hourStart: number, hourCount: number }>} */
  const seen = new Map();

  const json = (res, status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify(body));
  };

  function readBody(req, limit = 32 * 1024) {
    return new Promise((resolve) => {
      const chunks = [];
      let size = 0;
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) { fin(null); try { req.destroy(); } catch { /* ignore */ } return; }
        chunks.push(c);
      });
      req.on('end', () => fin(Buffer.concat(chunks)));
      req.on('error', () => fin(null));
    });
  }

  return {
    handles: (p) => p === '/api/feedback' || p === '/api/feedback/',
    async handle(req, res, _p, query) {
      void query;
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '600',
        });
        res.end();
        return;
      }
      if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }); return; }

      const ip = String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
      const t = now();
      const s = seen.get(ip);
      if (s && t - s.at < GAP_MS) { json(res, 429, { ok: false, error: 'TOO_FAST', message: '提交太频繁，请稍后再试' }); return; }
      if (s && t - s.hourStart < 3600_000) {
        if (s.hourCount >= PER_HOUR) { json(res, 429, { ok: false, error: 'TOO_MANY', message: '这一小时提交太多了' }); return; }
        s.hourCount++;
      } else {
        seen.set(ip, { at: t, hourStart: t, hourCount: 1 });
      }
      if (s) s.at = t;

      const raw = await readBody(req);
      if (!raw) { json(res, 413, { ok: false, error: 'TOO_LARGE' }); return; }
      let body = null;
      try { body = JSON.parse(raw.toString('utf8')); } catch { json(res, 400, { ok: false, error: 'BAD_JSON' }); return; }
      const text = String((body && body.text) || '').trim();
      const diag = String((body && body.diag) || '');
      if (!text && !diag) { json(res, 400, { ok: false, error: 'EMPTY', message: '至少写一句问题描述' }); return; }

      const row = store.add({
        text, diag, ip,
        name: String((body && body.name) || '').trim(),
        accountId: typeof identify === 'function' ? (identify(req) || '') : '',
      });
      log.info?.(`[feedback] 收到反馈 ${row.id}（${text.slice(0, 40).replace(/\s+/g, ' ')}…）`);
      json(res, 200, { ok: true, id: row.id });
    },
  };
}
