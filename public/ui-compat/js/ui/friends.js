// public/ui-compat/js/ui/friends.js — 宿主 friends.js + 分享包要的 AddFriendButton / openInviteDrawer。
export * from '/js/ui/friends.js';
import { html, Button } from '/js/ui/components.js';
import { openFriends, requestFriend } from '/js/ui/friends.js';

/**
 * 座位旁的「加好友」小按钮。宿主好友服务不可用时返回 null（不画死按钮）。
 * @param {{ playerId?: any, class?: string }} props
 */
export function AddFriendButton({ playerId = null, class: cls = '' } = {}) {
  if (playerId == null || openFriends?.unavailable === true) return null;
  const onClick = (e) => {
    e?.stopPropagation?.();
    try { Promise.resolve(requestFriend(playerId)).catch(() => {}); } catch { /* 静默 */ }
  };
  return html`<${Button} variant="ghost" size="sm" class=${`acct-addfriend ${cls}`} onClick=${onClick} title=${'加好友'}>+<//>`;
}

/**
 * 邀请抽屉：本仓没有独立抽屉，退化为「复制房号 → 打开好友面板」。
 * @param {(() => any)|null} onCopy
 */
export function openInviteDrawer(onCopy = null) {
  try { if (typeof onCopy === 'function') onCopy(); } catch { /* 复制失败不影响打开面板 */ }
  try { openFriends(); } catch { /* 静默 */ }
}
