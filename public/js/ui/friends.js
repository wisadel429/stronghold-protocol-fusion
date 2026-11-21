// Friends entry, bridged to this repo's own social UI (screens/social.js).
//
// 分享包主题的大厅顶栏用 `<${FriendsTile} />` 渲染好友入口；这个文件原本是「本仓没有好友服务」的
// 兼容空桩（`FriendsTile() { return null }`），所以主题下根本没有好友按钮——业主 2026-11-14
// 「好友键无反应」。本仓的好友 / 黑名单 / 邀请在 screens/social.js（服务端 server/accounts/social.js），
// 这里直接复用它的按钮（懒加载，避免 friends.js ↔ social.js 的模块环）。
import { html } from './components.js';
import { useState, useEffect } from '../../vendor/hooks.module.js';
import { render } from '../../vendor/preact.module.js';
import { createStore, store } from '../store.js';

export const friendsStore = createStore({ data: null, open: false, tab: 'list', seen: [], viewing: null });
export const THUMB = 'M2 10h4v11H2zm6 11V10l5-8 1.2.6c.9.5 1.3 1.5 1.1 2.5L14.6 9H20a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21z';
export const ADD_FRIEND = 'M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM2 20c0-3.5 3.1-6 7-6s7 2.5 7 6v1H2zM19 7h2v3h3v2h-3v3h-2v-3h-3v-2h3z';
export const Glyph = ({ d, cls }) => html`<svg class=${['fglyph', cls].filter(Boolean).join(' ')} viewBox="0 0 24 24" aria-hidden="true"><path d=${d} /></svg>`;

/** 本仓的好友按钮（screens/social.js 的 SocialButton），按需加载。 */
function SocialEntry({ roomCode = null }) {
  const [Btn, setBtn] = useState(null);
  useEffect(() => {
    let alive = true;
    import('../screens/social.js').then((m) => { if (alive) setBtn(() => m.SocialButton); }, () => { /* 加载失败就不显示 */ });
    return () => { alive = false; };
  }, []);
  return Btn ? html`<${Btn} roomCode=${roomCode} />` : null;
}

export function FriendsTile({ roomCode = null } = {}) { return html`<${SocialEntry} roomCode=${roomCode} />`; }
export function FriendsHost() { return null; }

/** 命令式打开好友界面。
 *  业主 2026-11-14：「点击邀请好友不呼出好友界面，只呼出邀请好友界面」——
 *  在房间里（有 roomCode）时直接弹**邀请好友列表**（InviteDialog），不再先开好友面板；
 *  房间外仍打开完整好友面板。
 *  @param {{ roomCode?: string|null, invite?: boolean }} [opts]
 */
let socialHost = null;
export function openFriends(opts = {}) {
  // 兼容字符串调用（主题房间里的 openFriends('list')）：'list' = 直接开好友列表
  if (typeof opts === 'string') opts = { invite: opts !== 'list' };
  let roomCode = opts && opts.roomCode != null ? opts.roomCode : null;
  if (roomCode == null) { try { roomCode = store.get()?.room?.code || null; } catch { /* ignore */ } }
  const wantInvite = opts.invite === true || (opts.invite !== false && !!roomCode);
  const mount = (node, onClose) => {
    if (!socialHost || !socialHost.isConnected) {
      socialHost = document.createElement('div');
      socialHost.className = 'social-host';
      document.body.appendChild(socialHost);
    }
    const close = () => { try { render(null, socialHost); } catch { /* ignore */ } onClose && onClose(); };
    render(node(close), socialHost);
    return close;
  };
  import('../screens/social.js').then((m) => {
    try {
      if (!wantInvite) {
        mount((close) => html`<${m.SocialPanel} onClose=${close} roomCode=${roomCode} />`);
        return;
      }
      // 邀请模式：先拉好友列表，再弹邀请浮窗
      fetch('/api/social', { credentials: 'include' })
        .then((r) => r.json())
        .then((j) => {
          const friends = (j && j.friends) || [];
          mount((close) => html`<${m.InviteDialog} friends=${friends} roomCode=${roomCode} onClose=${close} />`);
        })
        .catch(() => mount((close) => html`<${m.InviteDialog} friends=${[]} roomCode=${roomCode} onClose=${close} />`));
    } catch (e) { console.warn('[social] 打开好友界面失败', e); }
  }, (e) => { console.warn('[social] 好友界面加载失败', e); });
}
openFriends.unavailable = false;
/** 房间座位卡上的「加好友」小按钮（room.js: `<${AddFriendButton} playerId=… />`）。
 *  本仓没有「给指定玩家发请求」的一键接口，这里打开好友面板（「添加」标签里可按 QQ / 昵称#tag 搜索）。 */
export function AddFriendButton({ playerId = null, className = '' } = {}) {
  void playerId;
  return html`<button type="button" class=${className || ''} title="添加好友" aria-label="添加好友"
    onClick=${(e) => { e?.stopPropagation?.(); openFriends(); }}>
    <${Glyph} d=${ADD_FRIEND} />
  </button>`;
}
/** 房间里的「邀请好友」抽屉：本仓没有单独抽屉，直接把好友页开到「添加」标签。 */
export function openInviteDrawer() { openFriends({ tab: 'add' }); }
export const closeFriends = () => {};
export async function refreshFriends() { return null; }
export async function requestFriend() { throw new Error('请从好友面板添加好友'); }
export function pendingCount() { return 0; }
export function startFriends() {}

const CSS = `
.social-badge{position:absolute;top:-5px;right:-5px;min-width:15px;height:15px;padding:0 4px;border-radius:8px;
  display:grid;place-items:center;background:#ff4d4d;color:#fff;font-size:10px;font-weight:900;font-style:normal;
  line-height:1;box-shadow:0 0 0 2px rgba(5,8,7,.85),0 0 8px rgba(255,77,77,.7);pointer-events:none;z-index:5}
.rs-key__friends,.rs-friends,.soc__btn{position:relative}
`;
function ensureBadgeCss() {
  if (document.getElementById('social-badge-css')) return;
  const st = document.createElement('style');
  st.id = 'social-badge-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/**
 * 好友红点（业主 2026-11-14）：房间里/大厅上的好友入口显示待处理请求数。
 * 独立轮询 `/api/social`，把数量挂到这些元素上（主题文件不用改）：
 *   .rs-key__friends（同盟界面左上角）、.rs-friends、.soc__btn（顶栏好友）
 * 数量 0 就去掉红点；轮询 30 秒一次，页面隐藏时跳过，省流量。
 */
let badgeTimer = null;
export function installSocialBadges() {
  if (badgeTimer) return;
  ensureBadgeCss();
  const SELECTORS = ['.rs-key__friends', '.rs-friends', '.soc__btn', '[data-social-badge]'];
  const paint = (n) => {
    for (const sel of SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        let dot = el.querySelector('.social-badge');
        if (!n) { if (dot) dot.remove(); continue; }
        if (!dot) {
          dot = document.createElement('i');
          dot.className = 'social-badge';
          el.appendChild(dot);
        }
        dot.textContent = n > 99 ? '99+' : String(n);
      }
    }
  };
  const tick = async () => {
    if (document.hidden) return;
    try {
      const r = await fetch('/api/social', { credentials: 'include' });
      if (!r.ok) return;
      const j = await r.json();
      paint(((j && j.requests) || []).length);
    } catch { /* 未登录/离线忽略 */ }
  };
  badgeTimer = setInterval(tick, 30_000);
  setTimeout(tick, 1200);
}
