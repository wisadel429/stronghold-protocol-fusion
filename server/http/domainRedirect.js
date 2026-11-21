// server/http/domainRedirect.js —— 域名入口 302 到直连地址（业主 2026-11-21）
//
// 背景：域名走 Cloudflare Tunnel 后，国内玩家被 CF 调度到阿姆斯特丹节点（~266ms、~1Mbps），
// 首屏 12 秒；而直连源站 IP 只有 25ms、首屏 ~2 秒。这里把**域名的 HTML 页面请求** 302 到
// 配置的直连地址，玩家跳转后从 IP 加载，速度回到 2 秒级。
//
// 只跳 HTML 入口页（/、/index.html、主题页）；静态资源、WebSocket、API、后台一律不跳，
// 因此通过域名直接取资源/联机不受影响（也便于以后想改回来）。
//
// 配置：<dataDir>/domain-redirect.json
//   { "hosts": ["mon3tr.fun", "www.mon3tr.fun"], "to": "http://8.134.50.56" }
//   文件不存在 / to 为空 → 不跳（默认行为完全不变）。

import fs from 'node:fs';

/** 页面入口（只跳这些路径） */
const PAGE_PATHS = new Set(['/', '/index.html', '/ui-theme.html', '/ui-theme-closure.html', '/ui-theme-initial.html']);

/**
 * 读配置。永不抛错，任何问题都退化成「不跳转」。
 * @param {string} file
 * @param {{ log?: any }} [o]
 * @returns {{ hosts: string[], to: string }}
 */
export function readDomainRedirect(file, { log = console } = {}) {
  let j = null;
  try {
    j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    if (e && e.code !== 'ENOENT') log.warn?.(`[domain-redirect] ${file} 读取失败，忽略：${e.message}`);
    return { hosts: [], to: '' };
  }
  const hosts = Array.isArray(j && j.hosts) ? j.hosts.map((h) => String(h || '').toLowerCase().trim()).filter(Boolean) : [];
  const to = j && typeof j.to === 'string' ? j.to.trim().replace(/\/+$/, '') : '';
  return { hosts, to };
}

/**
 * @param {{ hosts: string[], to: string } | null} cfg
 * @returns {((req: any, rawPath: string) => string | null) | null}
 */
export function createDomainRedirect(cfg) {
  if (!cfg || !cfg.to || !cfg.hosts.length) return null;
  const hosts = new Set(cfg.hosts);
  return (req, rawPath) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return null;
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    if (!hosts.has(host)) return null;
    const path = String(rawPath || '/').split('?')[0] || '/';
    if (!PAGE_PATHS.has(path)) return null;
    // 业主 2026-11-21：跳转必须保留查询串，否则 mon3tr.fun/?room=CODE 这类邀请链接
    // 跳到 IP 后房间号就丢了（复制房间链接的链接头已经改成 mon3tr.fun）。
    let search = '';
    try {
      search = new URL(String(req.url || '/'), 'http://redirect.invalid').search;
    } catch { search = ''; }
    return cfg.to + (path === '/index.html' ? '/' : path) + search;
  };
}
