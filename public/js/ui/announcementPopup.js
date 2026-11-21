// public/js/ui/announcementPopup.js — 全服公告弹窗（业主 2026-11-21）
//
// 口径：「每次连接服务器都会弹出公告弹窗，公告内容在后台可调节」。
// 数据源就是既有的 GET /api/announcement（data/announcement.json，后台「公告」卡片可编辑）：
//   { announcement: { id, title?, text, level, startAt, endAt, ... } | null, serverTime }
// 每次页面加载（= 每次连接）都弹一次；不写入任何「已读」标记，所以下次进还是会弹。
// 原生 DOM，不依赖 Preact 树，标题页/大厅都能出。

const OPEN_KEY = 'sp-announcement-popup';
const SNOOZE_KEY = 'sp.announce.snooze';

/** 同一条公告（id 相同）今天勾过「不再弹出」就跳过；公告一更新（id 变）照常弹。 */
function snoozed(notice) {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    return !!s && s.id === (notice && notice.id) && s.day === today;
  } catch { return false; }
}
function setSnooze(notice) {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify({ id: notice && notice.id, day: new Date().toISOString().slice(0, 10) }));
  } catch { /* ignore */ }
}

const LEVEL_STYLE = {
  info: { bar: '#50e0b0', label: '公告' },
  warning: { bar: '#ffc65c', label: '警告' },
  urgent: { bar: '#e2534a', label: '紧急' },
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 显示一条公告。已有一条开着时不再叠加。 */
function show(notice) {
  if (!notice || !notice.text) return;
  if (document.getElementById(OPEN_KEY)) return;
  const st = LEVEL_STYLE[notice.level] || LEVEL_STYLE.info;
  const wrap = document.createElement('div');
  wrap.id = OPEN_KEY;
  wrap.innerHTML = `
    <style>
      #${OPEN_KEY} { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center;
        background: rgba(4, 8, 7, .72); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
      #${OPEN_KEY} .ap-card { width: min(560px, 92vw); max-height: 78vh; overflow: auto;
        background: #0f1715; border: 1px solid #2a3a34; box-shadow: 0 18px 60px rgba(0,0,0,.65); }
      #${OPEN_KEY} .ap-bar { height: 3px; background: ${st.bar}; }
      #${OPEN_KEY} .ap-body { padding: 18px 20px 16px; }
      #${OPEN_KEY} .ap-kicker { font-size: 11px; letter-spacing: .18em; color: ${st.bar}; text-transform: uppercase; }
      #${OPEN_KEY} .ap-title { margin: 6px 0 10px; font-size: 18px; font-weight: 800; color: #eafff7; }
      #${OPEN_KEY} .ap-text { font-size: 14px; line-height: 1.75; color: #c8d6d0; white-space: pre-wrap; word-break: break-word; }
      #${OPEN_KEY} .ap-foot { display: flex; align-items: center; justify-content: space-between; padding: 0 20px 18px; }
      #${OPEN_KEY} .ap-snooze { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #8a9a94; cursor: pointer; }
      #${OPEN_KEY} .ap-snooze input { accent-color: ${st.bar}; }
      #${OPEN_KEY} .ap-ok { padding: 7px 22px; font-size: 13px; font-weight: 700; cursor: pointer;
        background: #50e0b0; color: #06110d; border: 0; }
      #${OPEN_KEY} .ap-ok:hover { filter: brightness(1.08); }
    </style>
    <div class="ap-card" role="dialog" aria-modal="true" aria-label="公告">
      <div class="ap-bar"></div>
      <div class="ap-body">
        <div class="ap-kicker">${esc(st.label)} · ANNOUNCEMENT</div>
        ${notice.title ? `<h2 class="ap-title">${esc(notice.title)}</h2>` : ''}
        <div class="ap-text">${esc(notice.text)}</div>
      </div>
      <div class="ap-foot">
        <label class="ap-snooze"><input type="checkbox" data-ap-snooze /> 今天不再弹出</label>
        <button type="button" class="ap-ok" data-ap-close>知道了</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => {
    try {
      const box = wrap.querySelector('[data-ap-snooze]');
      if (box && box.checked) setSnooze(notice);
    } catch { /* ignore */ }
    try { wrap.remove(); } catch { /* ignore */ }
  };
  wrap.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t === wrap || (t && t.closest && t.closest('[data-ap-close]'))) close();
  });
  // Esc 关闭
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });
}

/** 拉一次公告并弹窗。每次连接调用一次。 */
export async function installAnnouncementPopup() {
  try {
    const r = await fetch('/api/announcement', { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) return;
    const j = await r.json();
    const notice = j && j.announcement;
    if (notice && notice.text && !snoozed(notice)) {
      // 等首屏渲染完再弹，避免盖住加载动画
      setTimeout(() => show(notice), 800);
    }
  } catch { /* 离线/接口不存在时静默 */ }
}
