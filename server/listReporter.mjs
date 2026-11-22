// server/listReporter.mjs — 可选的「服务器列表上报」（业主 2026-11-22 方案 A）
//
// 跑在**国内**的游戏服进程里（不额外开进程）：定时探测各服 /healthz，把结果 POST 给列表站。
// 只有 data/list-agent.json 存在且 enabled 不为 false 时才工作；删掉该文件即彻底关闭。
//
// 配置示例（data/list-agent.json）：
//   { "enabled": true,
//     "listUrl": "https://mon3tr.fun",
//     "token": "ws-report-2f7c9d",
//     "intervalMs": 30000,
//     "timeoutMs": 8000,
//     "source": "cn" }
//
// 设计原则：**任何异常都不得影响游戏本体** —— 全部包在 try/catch 里，失败只写一行 warn。

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';

const MAX_RESPONSE = 4 * 1024 * 1024;
let started = false;

function readConfig(dataDir) {
  try {
    const file = path.join(dataDir || 'data', 'list-agent.json');
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const cfg = JSON.parse(raw);
    if (!cfg || cfg.enabled === false) return null;
    const listUrl = String(cfg.listUrl || '').replace(/\/+$/, '');
    const token = String(cfg.token || '');
    if (!/^https?:\/\//.test(listUrl) || !token) return null;
    return {
      listUrl,
      token,
      intervalMs: Number(cfg.intervalMs) > 5000 ? Number(cfg.intervalMs) : 30000,
      timeoutMs: Number(cfg.timeoutMs) > 1000 ? Number(cfg.timeoutMs) : 8000,
      source: String(cfg.source || 'cn').slice(0, 16),
    };
  } catch { return null; }
}

function request(url, { method = 'GET', body = null, timeout = 15000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    const req = mod.request(url, {
      method,
      timeout,
      rejectUnauthorized: false,
      headers: {
        'user-agent': 'StrongholdListAgent/1.0',
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size > MAX_RESPONSE) { req.destroy(); return; } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function probe(srv, timeoutMs) {
  const url = String(srv.url || '').replace(/\/+$/, '') + (srv.statusPath || '/healthz');
  const startedAt = Date.now();
  try {
    const r = await request(url, { timeout: timeoutMs, headers: { accept: 'application/json' } });
    const latencyMs = Date.now() - startedAt;
    if (r.status !== 200) return { id: srv.id, ok: false, latencyMs, error: `HTTP ${r.status}` };
    let health;
    try { health = JSON.parse(r.body); } catch { return { id: srv.id, ok: false, latencyMs, error: '不是 JSON' }; }
    return { id: srv.id, ok: true, latencyMs, health };
  } catch (e) {
    return { id: srv.id, ok: false, latencyMs: Date.now() - startedAt, error: e.code || e.message || 'error' };
  }
}

/**
 * 启动上报循环。幂等：重复调用只启动一次。
 * @param {{ dataDir?: string, log?: { info?: Function, warn?: Function } }} [opts]
 */
export function startListReporter({ dataDir = 'data', log = console } = {}) {
  if (started) return false;
  const cfg = readConfig(dataDir);
  if (!cfg) return false;                 // 没配置 = 不启用，静默
  started = true;

  const warn = (m) => { try { (log.warn || log.info || console.log).call(log, '[list-reporter] ' + m); } catch { /* ignore */ } };

  let ticking = false;
  const cycle = async () => {
    if (ticking) return;
    ticking = true;
    try {
      // 1) 取列表
      const listRes = await request(`${cfg.listUrl}/api/servers`, { timeout: cfg.timeoutMs * 2 });
      if (listRes.status !== 200) { warn(`拉列表失败 HTTP ${listRes.status}`); return; }
      const doc = JSON.parse(listRes.body);
      const servers = (doc.servers || []).filter((s) => s && s.url);
      if (!servers.length) { warn('列表为空'); return; }

      // 2) 并发探测
      const results = await Promise.all(servers.map((srv) => probe(srv, cfg.timeoutMs)));

      // 3) 上报
      const up = await request(`${cfg.listUrl}/api/report`, {
        method: 'POST',
        timeout: cfg.timeoutMs * 2,
        body: { token: cfg.token, source: cfg.source, at: Date.now(), results },
      });
      const online = results.filter((r) => r.ok).length;
      if (up.status !== 200) warn(`上报失败 HTTP ${up.status} ${String(up.body).slice(0, 120)}`);
      else (log.info || console.log).call(log, `[list-reporter] ${results.length} 个服 · 在线 ${online} · 已上报`);
    } catch (e) {
      warn('本轮失败：' + (e && (e.code || e.message) || e));
    } finally {
      ticking = false;
      setTimeout(() => { cycle(); }, cfg.intervalMs).unref?.();
    }
  };

  // 启动后先等 10 秒再开始（别和服务器自己的启动期抢资源）
  setTimeout(() => { cycle(); }, 10000).unref?.();
  try { (log.info || console.log).call(log, `[list-reporter] 已启用 → ${cfg.listUrl}（每 ${cfg.intervalMs}ms）`); } catch { /* ignore */ }
  return true;
}
