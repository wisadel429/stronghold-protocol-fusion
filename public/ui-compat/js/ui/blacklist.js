// public/ui-compat/js/ui/blacklist.js — 分享包「黑名单」降级桩（本仓无黑名单服务）。
// 一律「没被拉黑」：结算页的举报/屏蔽按钮不出现，也不会因为拉黑而少人。
const STATE = Object.freeze({ list: [], ids: [] });
export const blacklistStore = { get: () => STATE, subscribe: () => () => {} };
export function refreshBlacklist() { return Promise.resolve(); }
export function isBlacklisted() { return false; }
export function addBlacklist() { return Promise.resolve(); }
