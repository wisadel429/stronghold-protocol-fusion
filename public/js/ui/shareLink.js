// public/js/ui/shareLink.js — 房间/邀请链接的公共链接头（业主 2026-11-21，2026-11-22 改口径）
//
// 业主口径变更（2026-11-22 13:15）：「mon3tr.fun 暂停转接，域名另有他用」——
//   复制的房间链接**不再用域名**，改成直连 `http://8.134.50.56:3000/?room=CODE`；
//   · 本机 / 局域网调试时仍用当前地址 —— 否则邀请链接会指向公网服务器上并不存在的那个房间。
//
// 纯函数（可单测）：不读 DOM，location 可注入。

/** 公网主入口（直连；域名 mon3tr.fun 已停用）。 */
export const PUBLIC_ORIGIN = 'http://8.134.50.56:3000';
/** 兼容旧引用：只保留主机部分。 */
export const PUBLIC_HOST = '8.134.50.56:3000';

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
    if (!loc || !loc.origin) return `${PUBLIC_ORIGIN}/`;
    return `${loc.origin}${loc.pathname || '/'}`;
  }
  return `${PUBLIC_ORIGIN}${keepPath ? (loc.pathname || '/') : '/'}`;
}

/**
 * 房间邀请链接。
 * @param {string} code 房间码
 * @param {{hostname?: string, origin?: string, pathname?: string}} [loc]
 */
export function roomLink(code, loc = globalThis.location) {
  return `${shareBase(loc)}?room=${encodeURIComponent(String(code == null ? '' : code))}`;
}
