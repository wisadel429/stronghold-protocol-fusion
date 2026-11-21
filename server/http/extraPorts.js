// server/http/extraPorts.js —— 额外端口入口（业主 2026-11-21「域名 mon3tr.fun 输入网址直接进游戏」）
//
// 为什么要它：游戏服只监听一个端口（默认 3000）。域名解析到这台机器后，玩家要输入 `mon3tr.fun:3000` 才能进；
// 想要「打开 mon3tr.fun 就直接进游戏」，就必须有东西在 80 端口上应答（80 是浏览器默认端口，域名裸访问走它）。
//
// 做法：对每个额外端口起一个**透明反向代理**，把 HTTP 请求与 WebSocket 升级都原样转给本进程的主端口
// （127.0.0.1:<主端口>）。这样：
//   * 主端口的行为完全不变（同一个 request handler、同一套鉴权/CSP/静态缓存、同一份会话与房间）；
//   * 额外端口不复制任何游戏逻辑，80 与 3000 天然等价；
//   * 额外端口绑不上（没有管理员权限、被 IIS 占用）只打一条警告，**绝不影响主端口启动**。
//
// 配置：<dataDir>/http-ports.json
//   { "extra": [80], "domain": "mon3tr.fun" }
//   - 文件不存在 / 解析失败 / 端口非法 → 不监听任何额外端口（默认行为零改动）
//   - 与主端口相同、重复的端口会被忽略
//
// 转发时会补 `x-forwarded-for` / `x-forwarded-proto`（服务端 TRUST_PROXY=auto 时据此取真实 IP）。

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';

/**
 * 读额外端口配置。永不抛错：任何问题都退化成「不监听额外端口」。
 * @param {string} file
 * @param {{ log?: any }} [o]
 * @returns {{ ports: number[], domain: string }}
 */
export function readExtraPorts(file, { log = console } = {}) {
  let j = null;
  try {
    // 记事本/旧版 PowerShell 写出的文件可能带 UTF-8 BOM，直接 JSON.parse 会失败
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    j = JSON.parse(text);
  } catch (e) {
    if (e && e.code !== 'ENOENT') log.warn?.(`[extra-ports] ${file} 读取失败，忽略：${e.message}`);
    return { ports: [], domain: '' };
  }
  const raw = Array.isArray(j) ? j : (j && Array.isArray(j.extra) ? j.extra : []);
  const ports = [];
  for (const v of raw) {
    const p = Number(v);
    if (Number.isInteger(p) && p > 0 && p < 65536 && !ports.includes(p)) ports.push(p);
    else log.warn?.(`[extra-ports] 忽略非法端口 ${JSON.stringify(v)}`);
  }
  const domain = j && !Array.isArray(j) && typeof j.domain === 'string' ? j.domain.trim() : '';
  return { ports, domain };
}

/**
 * 在若干端口上起透明代理。
 * @param {{ ports?: number[], domain?: string, targetHost?: string, targetPort: number, log?: any }} o
 */
export function startExtraPorts({ ports = [], domain = '', targetHost = '127.0.0.1', targetPort, log = console }) {
  const started = [];

  const forwardHttp = (agent) => (req, res) => {
    const headers = { ...req.headers };
    headers['x-forwarded-for'] = String(req.socket && req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    headers['x-forwarded-proto'] = 'http';
    if (req.headers.host) headers['x-forwarded-host'] = req.headers.host;
    const preq = http.request(
      { host: targetHost, port: targetPort, method: req.method, path: req.url, headers, agent },
      (pres) => {
        try {
          res.writeHead(pres.statusCode || 502, pres.headers);
          pres.pipe(res);
        } catch { try { res.destroy(); pres.destroy(); } catch { /* ignore */ } }
      },
    );
    preq.on('error', (e) => {
      log.warn?.(`[extra-ports] 转发失败 ${req.method} ${req.url}: ${e.message}`);
      if (!res.headersSent) {
        try { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Bad Gateway'); } catch { /* ignore */ }
      } else { try { res.destroy(); } catch { /* ignore */ } }
    });
    req.on('error', () => { try { preq.destroy(); } catch { /* ignore */ } });
    req.pipe(preq);
  };

  const forwardUpgrade = (req, socket, head) => {
    const conn = net.connect({ host: targetHost, port: targetPort }, () => {
      try {
        const lines = [`${req.method} ${req.url} HTTP/1.1`];
        const raw = req.rawHeaders || [];
        let sawFF = false;
        for (let i = 0; i + 1 < raw.length; i += 2) {
          if (String(raw[i]).toLowerCase() === 'x-forwarded-for') sawFF = true;
          lines.push(`${raw[i]}: ${raw[i + 1]}`);
        }
        if (!sawFF) lines.push(`x-forwarded-for: ${String(socket.remoteAddress || '').replace(/^::ffff:/, '')}`);
        lines.push('x-forwarded-proto: http');
        conn.write(lines.join('\r\n') + '\r\n\r\n');
        if (head && head.length) conn.write(head);
        socket.pipe(conn);
        conn.pipe(socket);
        socket.on('error', () => conn.destroy());
        conn.on('error', () => socket.destroy());
      } catch { try { socket.destroy(); } catch { /* ignore */ } }
    });
    conn.on('error', (e) => {
      log.warn?.(`[extra-ports] WebSocket 转发失败: ${e.message}`);
      try { socket.destroy(); } catch { /* ignore */ }
    });
  };

  for (const port of ports) {
    if (port === targetPort) { log.warn?.(`[extra-ports] ${port} 与主端口相同，忽略`); continue; }
    const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
    const server = http.createServer(forwardHttp(agent));
    server.on('upgrade', forwardUpgrade);
    server.on('clientError', (err, socket) => { try { socket.destroy(); } catch { /* ignore */ } });
    server.on('error', (e) => {
      log.warn?.(`[extra-ports] ${port} 端口监听失败（${e.code || e.message}）——主端口不受影响`);
    });
    const entry = { port, server, agent };
    started.push(entry);
    // 与主端口一致地先试双栈、失败再退 IPv4（0.0.0.0 一定会被尝试到）
    const tryBind = (host) => new Promise((resolve) => {
      const onErr = (e) => { server.off('listening', onOk); log.warn?.(`[extra-ports] ${port}@${host} bind 失败（${e.code || e.message}）`); resolve(false); };
      const onOk = () => { server.off('error', onErr); resolve(true); };
      server.once('error', onErr);
      server.once('listening', onOk);
      try { server.listen(port, host); } catch (e) { log.warn?.(`[extra-ports] ${port} listen 异常：${e.message}`); resolve(false); }
    });
    entry.ready = (async () => {
      if (await tryBind('::')) return true;
      return await tryBind('0.0.0.0');
    })();
  }

  return {
    ports: started.map((s) => s.port),
    domain,
    /** 等所有额外端口的 bind 结果（启动日志用；最多等 1.5s） */
    async ready() {
      await Promise.race([
        Promise.all(started.map((s) => s.ready)).catch(() => []),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
      return started.filter((s) => s.server.listening).map((s) => s.port);
    },
    async close() {
      await Promise.all(started.map((s) => new Promise((resolve) => {
        try {
          s.server.close(() => resolve());
          s.server.closeAllConnections?.();
        } catch { resolve(); }
        try { s.agent.destroy(); } catch { /* ignore */ }
        setTimeout(resolve, 800).unref?.();
      })));
    },
  };
}
