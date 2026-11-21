// public/ui-compat/js/ui/transitions.js — 宿主 transitions.js + 分享包要的 LEAVE_MS / afterLeave。
export * from '/js/ui/transitions.js';

/**
 * 离场动画时长（毫秒）。本仓 transitions.js 没有导出同名常量，`usePresence` 内部按 300 ms 收尾，
 * 这里取同一个值，保证主题的「关掉时等多久」和本仓一致。
 */
export const LEAVE_MS = 300;

/**
 * 等离场动画结束（主题在关面板后 await 它）。
 * @param {number} [ms]
 * @returns {Promise<void>}
 */
export function afterLeave(ms = 0) {
  const wait = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return new Promise((resolve) => setTimeout(resolve, wait));
}
