// public/js/ui/messageCenter.js — 全局「消息」入口（业主 2026-11-21）
//
// 口径：**主页 / 大厅 / 等待室都要有入口**，只有「对局内」和「拓展玩法选择界面」隐藏。
// 做成原生 DOM 浮层（和 installSocialInvites 同一套思路），不依赖 Preact 树，
// 因此任何界面下都在；显示与否由路由（store）+ 当前是否有拓展选择弹层决定。
//
// 消息来源：server/accounts/messages.js（好友请求 / 房间邀请 / 反馈回复）。

import { store, selectRoute } from '../store.js';

const MARK = 'sp-messages';

/** 极简转义（消息文本来自服务端，仍按不可信处理）。 */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 拓展玩法选择界面开着时不要抢焦点（业主口径：那里不要入口）。 */
function extensionOpen() {
  try { return !!document.querySelector('.modal.ext'); } catch { return false; }
}

/**
 * 装上全局消息入口。重复调用无副作用。
 * @returns {() => void} 卸载
 */
export function installMessageCenter() {
  if (typeof document === 'undefined') return () => {};
  if (document.getElementById(MARK)) return () => {};

  const root = document.createElement('div');
  root.id = MARK;
  root.innerHTML = `
    <style>
      /* 业主 2026-11-22：消息按钮挪到**右上角**（原来在右侧中部 top:46%）。
         68px 是为了避开标题页右上角那排工具按钮与大厅顶栏；面板改成向下展开。 */
      #${MARK} { position: fixed; right: 14px; top: 68px; z-index: 60; font-family: inherit; }
      #${MARK}[hidden] { display: none; }
      #${MARK} .mc-btn {
        position: relative; width: 44px; height: 44px; border-radius: 50%;
        border: 1px solid rgba(80, 224, 176, .55); background: rgba(12, 20, 17, .92);
        color: #9fe6c4; cursor: pointer; display: grid; place-items: center;
        box-shadow: 0 4px 14px rgba(0, 0, 0, .45);
      }
      #${MARK} .mc-btn:hover { border-color: #50e0b0; color: #eafff7; }
      #${MARK} .mc-btn svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; }
      #${MARK} .mc-dot {
        position: absolute; top: -3px; right: -3px; min-width: 18px; height: 18px; padding: 0 4px;
        border-radius: 9px; background: #e2534a; color: #fff; font-size: 11px; line-height: 18px;
        text-align: center; font-weight: 700;
      }
      /* 面板从按钮下方展开（右对齐），不再往左弹 —— 挪到顶角后往左弹会顶出屏幕 */
      #${MARK} .mc-panel {
        position: absolute; right: 0; top: 52px; width: 330px; max-width: calc(100vw - 28px);
        max-height: min(60vh, 520px); overflow: auto;
        background: #0f1715; border: 1px solid #2a3a34; box-shadow: 0 12px 40px rgba(0,0,0,.55);
        padding: 10px 12px;
      }
      #${MARK} .mc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      #${MARK} .mc-title { font-size: 13px; color: #eafff7; letter-spacing: .06em; }
      #${MARK} .mc-close { background: none; border: 0; color: #7d8f88; cursor: pointer; font-size: 15px; }
      #${MARK} .mc-empty { color: #7d8f88; font-size: 12px; padding: 8px 2px; }
      #${MARK} .mc-item { border: 1px solid #22302b; padding: 8px 9px; margin-bottom: 8px; }
      #${MARK} .mc-item.is-unread { border-color: #2f7a5c; background: rgba(47, 122, 92, .08); }
      #${MARK} .mc-meta { font-size: 11px; color: #7d8f88; }
      #${MARK} .mc-item-t { font-size: 13px; color: #eafff7; font-weight: 700; margin-top: 2px; }
      #${MARK} .mc-text { font-size: 12.5px; color: #c8d6d0; margin-top: 3px; white-space: pre-wrap; word-break: break-word; }
      #${MARK} .mc-actions { margin-top: 7px; display: flex; gap: 6px; }
      #${MARK} .mc-go {
        font-size: 11.5px; padding: 3px 10px; cursor: pointer;
        background: #50e0b0; color: #06110d; border: 0; font-weight: 700;
      }
      #${MARK} .mc-go:hover { filter: brightness(1.08); }
    </style>
    <button type="button" class="mc-btn" data-mc-toggle aria-label="消息" title="消息">
      <svg viewBox="0 0 24 24"><path d="M4 5h16v11H8l-4 4z"/></svg>
      <span class="mc-dot" data-mc-dot hidden></span>
    </button>
    <div class="mc-panel" data-mc-panel hidden></div>
  `;
  document.body.appendChild(root);

  const btn = root.querySelector('[data-mc-toggle]');
  const dot = root.querySelector('[data-mc-dot]');
  const panel = root.querySelector('[data-mc-panel]');
  let items = [];
  let open = false;
  let timer = 0;

  const render = () => {
    if (!open) return;
    panel.innerHTML = `
      <div class="mc-head"><span class="mc-title">消息</span><button class="mc-close" data-mc-close>✕</button></div>
      ${items.length ? items.map((m, i) => `
        <div class="mc-item${m.read ? '' : ' is-unread'}" data-mc-idx="${i}">
          <div class="mc-meta">${fmtTime(m.at)}</div>
          <div class="mc-item-t">${esc(m.title)}</div>
          <div class="mc-text">${esc(m.text)}</div>
          ${m.action && (m.action.kind === 'room' || m.action.kind === 'friends')
            ? `<div class="mc-actions"><button class="mc-go" data-mc-act="${i}">${m.action.kind === 'room' ? '加入房间 ' + esc(m.action.value || '') : '查看好友'}</button></div>`
            : ''}
        </div>`).join('') : '<div class="mc-empty">还没有消息。</div>'}
    `;
  };

  const paint = (list) => {
    items = Array.isArray(list) ? list : [];
    const unread = items.filter((m) => !m.read).length;
    dot.hidden = unread <= 0;
    dot.textContent = unread > 99 ? '99+' : String(unread);
    if (open) render();
  };

  const refresh = async () => {
    try {
      const r = await fetch('/api/messages', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) { paint([]); return; }
      const j = await r.json();
      paint(j && j.items);
    } catch { /* 离线忽略 */ }
  };

  const markAllRead = async () => {
    try { await fetch('/api/messages/read', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch { /* ignore */ }
  };

  /** 入口显示规则：已登录 + 不在对局内 + 没有开着拓展玩法选择界面。 */
  const updateVisible = () => {
    let logged = false, route = 'title';
    try { const s = store.get ? store.get() : null; logged = !!(s && s.account); route = selectRoute(s); } catch { /* ignore */ }
    const show = logged && route !== 'game' && !extensionOpen();
    root.hidden = !show;
    if (!show && open) { open = false; panel.hidden = true; }
  };

  btn.addEventListener('click', () => {
    open = !open;
    panel.hidden = !open;
    if (open) { render(); void markAllRead().then(() => paint(items.map((m) => ({ ...m, read: true })))); }
  });
  panel.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t && t.closest && t.closest('[data-mc-close]')) { open = false; panel.hidden = true; return; }
    const go = t && t.closest ? t.closest('[data-mc-act]') : null;
    if (!go) return;
    const m = items[Number(go.getAttribute('data-mc-act'))];
    if (!m || !m.action) return;
    if (m.action.kind === 'room' && m.action.value) {
      // 走深链进房（main.js 会解析 ?room=CODE 并在进入后自动加入）
      try { location.href = `/?room=${encodeURIComponent(m.action.value)}`; } catch { /* ignore */ }
    } else if (m.action.kind === 'friends') {
      try { window.dispatchEvent(new CustomEvent('sp:open-social')); } catch { /* ignore */ }
      open = false; panel.hidden = true;
    }
  });

  // 路由变化 / 每 2 秒复核一次可见性（拓展弹层是 DOM 层面的开关）
  let unsub = () => {};
  try { unsub = store.subscribe(() => updateVisible()); } catch { /* ignore */ }
  timer = setInterval(updateVisible, 2000);
  updateVisible();
  void refresh();

  // 实时推送（业主 2026-11-22）：服务端 MessageStore 落盘即推 `account.msg`（main.js 转成 `sp:messages` 窗口事件）。
  // 合并 150ms 内的多条 —— 一次操作可能同时产生好几条消息，没必要拉几次列表。
  let pushTimer = 0;
  const onPush = () => {
    if (pushTimer) return;
    pushTimer = setTimeout(() => { pushTimer = 0; void refresh(); }, 150);
  };
  window.addEventListener('sp:messages', onPush);
  // 从后台切回来时补一次（推送可能在标签页休眠期间到了、或者根本没送到）
  const onVisible = () => { if (!document.hidden) void refresh(); };
  document.addEventListener('visibilitychange', onVisible);

  // 兜底轮询：有推送之后它只负责「推送丢了」的情况，所以从 20 秒放宽到 60 秒（请求量降到 1/3）。
  const poll = setInterval(refresh, 60000);

  return () => {
    clearInterval(timer);
    clearInterval(poll);
    if (pushTimer) clearTimeout(pushTimer);
    window.removeEventListener('sp:messages', onPush);
    document.removeEventListener('visibilitychange', onVisible);
    try { unsub(); } catch { /* ignore */ }
    root.remove();
  };
}
