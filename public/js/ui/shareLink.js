// public/js/ui/shareLink.js — 房间/邀请链接的公共链接头（业主 2026-11-21）
//
// 业主口径：「游戏里复制房间链接的主链接头改为 mon3tr.fun」。
//   · 从公网入口（源站 IP 或域名）打开时，复制的房间链接统一用 https://mon3tr.fun/?room=CODE，
//     分享出去是 HTTPS 主域名，不再带 IP:端口；
//   · 本机 / 局域网调试时仍用当前地址 —— 否则邀请链接会指向公网服务器上并不存在的那个房间。
//
// 纯函数（可单测）：不读 DOM，location 可注入。

/** 公网主域名。 */
export const PUBLIC_HOST = 'mon3tr.fun';

const LOCAL_HOST_RE = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|::1|0\.0\.0\.0)$/i;
const LAN_RE = /^(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/;

/**
 * 是否本机 / 局域网地址（这类地址复制出去对别人没意义）。
 * @param {string} host
 */
export function isLocalHost(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  return LOCAL_HOST_RE.test(h) || LAN_RE.test(h) || h.endsWith('.local');
}

/**
 * 分享链接的基地址。
 * @param {{hostname?: string, origin?: string, pathname?: string}} [loc]
 * @param {{keepPath?: boolean}} [opts] keepPath = 保留当前页面路径（主题页要留在自己的入口，例如 /ui-theme-closure.html）
 * @returns {string} 以 `/` 结尾或带页面路径（后面可直接接 `?room=`）
 */
export function shareBase(loc = globalThis.location, { keepPath = false } = {}) {
  if (!loc || !loc.hostname || isLocalHost(loc.hostname)) {
    if (!loc || !loc.origin) return `https://${PUBLIC_HOST}/`;
    return `${loc.origin}${loc.pathname || '/'}`;
  }
  return `https://${PUBLIC_HOST}${keepPath ? (loc.pathname || '/') : '/'}`;
}

/**
 * 房间邀请链接。
 * @param {string} code 房间码
 * @param {{hostname?: string, origin?: string, pathname?: string}} [loc]
 */
export function roomLink(code, loc = globalThis.location) {
  return `${shareBase(loc)}?room=${encodeURIComponent(String(code == null ? '' : code))}`;
}
