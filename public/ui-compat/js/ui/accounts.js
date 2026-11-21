// public/ui-compat/js/ui/accounts.js — 宿主 accounts.js + 分享包要的 PlayerName（本仓叫 AccountTag/useAccount）。
export * from '/js/ui/accounts.js';
import { html } from '/js/ui/components.js';
import { useAccount, AccountTag } from '/js/ui/accounts.js';

/**
 * 玩家名（结算/房间座位用）：按 playerId 查账号，查到就用宿主 AccountTag 渲染（同一套标签视觉），
 * 查不到就退回传入的 name。
 * @param {{ playerId?: string|null, name?: string }} props
 */
export function PlayerName({ playerId = null, name = '' } = {}) {
  let account = null;
  try { account = playerId ? useAccount(playerId) : null; } catch { account = null; }
  if (account) return html`<${AccountTag} profile=${account} name=${name} />`;
  return html`<span class="acct-name">${name || ''}</span>`;
}

/** 昵称（等同 PlayerName 的短形式）。 */
export function AccountNickname(props = {}) { return PlayerName(props); }
/** 账号名（等同 PlayerName）。 */
export function AccountName(props = {}) { return PlayerName(props); }
/** 本仓账号系统在启动时已就绪；这里只需保证返回 Promise。 */
export function ensureAccountBound() { return Promise.resolve(); }
/** 主题只 import 不调用；给个空实现，避免 undefined 调用。 */
export function mountAccountButton() { return null; }
