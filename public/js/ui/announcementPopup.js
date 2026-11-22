// public/js/ui/announcementPopup.js — 全服公告弹窗（业主 2026-11-21）
// 2026-11-22 两轮改动：
//   1) 三个档位都要**明确显示紧急程度**并按 绿→黄→红 配色（原来服务端连 level 都没下发，全是同一个样子）；
//   2) **紧急（urgent）公告即使在游玩中也弹出**（以前只在页面加载时拉一次，对局中新发的根本不会出现）；
//   3) **右侧历史公告**：可以翻回去看以前的公告，小卡片显示 紧急程度 / 标题 / 时间。
//
// 数据源：GET /api/announcement
//   { announcement: { id, title?, text, level, expiresAt } | null, history: [{ id, title?, text, level, startAt, endAt, at }], serverTime }
// 原生 DOM，不依赖 Preact 树，标题页/大厅/对局内都能出。

import { store, selectRoute } from '../store.js';
import { net } from '../net.js';

const OPEN_KEY = 'sp-announcement-popup';
const SNOOZE_KEY = 'sp-announce.snooze';
/** 本次会话已经弹过的公告 id：轮询时不要重复弹同一条 */
const SEEN = new Set();
/** 轮询间隔（毫秒）：紧急公告从后台保存到玩家看到，最坏延迟就是这个值 */
const POLL_MS = 45000;
/** 最近一次接口给的历史公告（新的在前） */
let HISTORY = [];
/** 最近一次接口给的**当前/最新**公告：永久置顶在历史列表第一行，切到旧公告后也能点回来 */
let LATEST = null;

/**
 * 业主 2026-11-22：「今日不再弹出」→「**下次更新前不再弹出**」。
 * 判据由「同一 id + 同一天」改成**只比 id** —— 只要公告内容不变就一直不弹，
 * 内容一更新（id 变）立刻重新弹，不再等到第二天。
 */
function snoozed(notice) {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    return !!s && !!s.id && s.id === (notice && notice.id);
  } catch { return false; }
}
function setSnooze(notice) {
  try {
    // 只记 id：同一条公告在它被更新之前都不再弹（不再按天过期）
    localStorage.setItem(SNOOZE_KEY, JSON.stringify({ id: notice && notice.id, at: Date.now() }));
  } catch { /* ignore */ }
}

/**
 * 三档的表现。紧急程度用 1/2/3 格 + 文字同时表达（不只靠颜色 —— 色觉障碍也能分辨）。
 * 与启动器 launcher/app.js 的 TONE 保持一致。
 */
const LEVELS = {
  info: { key: 'info', label: '公告', severity: '低', pips: 1, color: '#50e0b0', soft: 'rgba(80, 224, 176, .14)', edge: 'rgba(80, 224, 176, .55)', tint: '#18332b' },
  warning: { key: 'warning', label: '警告', severity: '中', pips: 2, color: '#ffc65c', soft: 'rgba(255, 198, 92, .14)', edge: 'rgba(255, 198, 92, .60)', tint: '#31301f' },
  urgent: { key: 'urgent', label: '紧急', severity: '高', pips: 3, color: '#e2534a', soft: 'rgba(226, 83, 74, .16)', edge: 'rgba(226, 83, 74, .85)', tint: '#31211e' },
};
// tint = 档位色调压成**不透明**的深色（业主 2026-11-22「不要半透明背景」）：
// 原来卡片顶部用 rgba 渐变，会透出后面的画面，看着是半透明的。
const levelOf = (n) => LEVELS[(n && n.level) || 'info'] || LEVELS.info;
const rankOf = (n) => ({ info: 1, warning: 2, urgent: 3 }[levelOf(n).key] || 1);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** 历史卡片上的时间：历史条目有开始/收录时间；当前这条只有 expiresAt，就显示「至 xx」。 */
function fmtTime(n) {
  const start = Number(n && (n.startAt || n.at)) || 0;
  const end = Number(n && n.expiresAt) || 0;
  const p = (v) => String(v).padStart(2, '0');
  const fmt = (ms) => { const d = new Date(ms); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  if (start) return fmt(start);
  if (end) return '至 ' + fmt(end);
  return '';
}
/** 历史列表标题：有标题用标题，否则截取正文。 */
function listTitle(n) {
  const t = (n && (n.title || n.text)) || '';
  return t.length > 18 ? t.slice(0, 18) + '…' : t;
}

/**
 * 自绘滚动条（业主 2026-11-22：不要浏览器原生那根）。
 * 容器自己 overflow:auto、原生条由 CSS 隐藏；轨道挂在**父元素**上（父元素需 position:relative），
 * 位置与高度按两者的 rect 对齐，所以父元素有内边距也不会错位。
 * @param {HTMLElement} el 滚动容器
 * @param {string} className 轨道类名（样式在各自的 <style> 里）
 * @returns {{ sync: () => void, track: HTMLElement } | null}
 */
function attachSlimScroll(el, className) {
  if (!el || !el.parentElement) return null;
  const host = el.parentElement;
  const track = document.createElement('div');
  track.className = className;
  const thumb = document.createElement('i');
  track.appendChild(thumb);
  host.appendChild(track);

  const sync = () => {
    const hr = host.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const sh = el.scrollHeight;
    const ch = el.clientHeight;
    if (sh <= ch + 1 || er.height <= 0) { track.style.display = 'none'; return; }
    track.style.display = '';
    track.style.top = (er.top - hr.top) + 'px';
    track.style.height = er.height + 'px';
    const h = Math.max(26, Math.round((ch * ch) / sh));
    thumb.style.height = h + 'px';
    const max = sh - ch;
    const top = max > 0 ? Math.round((el.scrollTop / max) * (ch - h)) : 0;
    thumb.style.transform = 'translateY(' + top + 'px)';
  };

  // 内容变化（切换公告、列表重画）时必须在**下一帧**再量：MutationObserver 回调时新文字还没排版，
  // 那时 scrollHeight 仍等于 clientHeight，会把滚动条误判成「不需要」并隐藏。
  const scheduleSync = () => setTimeout(sync, 16);
  el.addEventListener('scroll', scheduleSync, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(scheduleSync).observe(el);
  if (typeof MutationObserver === 'function') new MutationObserver(scheduleSync).observe(el, { childList: true, subtree: true });

  let dragging = false;
  let startY = 0;
  let startTop = 0;
  thumb.addEventListener('pointerdown', (e) => {
    dragging = true; startY = e.clientY; startTop = el.scrollTop;
    track.classList.add('is-drag');
    try { thumb.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  });
  thumb.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const sh = el.scrollHeight;
    const ch = el.clientHeight;
    const h = Math.max(26, Math.round((ch * ch) / sh));
    const ratio = (sh - ch) / Math.max(1, ch - h);
    el.scrollTop = startTop + (e.clientY - startY) * ratio;
  });
  const stop = () => { dragging = false; track.classList.remove('is-drag'); };
  thumb.addEventListener('pointerup', stop);
  thumb.addEventListener('pointercancel', stop);

  sync();
  // 弹窗是「先建 DOM 再显示」，显示前后各算几次，避免拿到 0 尺寸（显示时机由调用方决定）
  setTimeout(scheduleSync, 0);
  setTimeout(scheduleSync, 120);
  setTimeout(scheduleSync, 400);
  setTimeout(scheduleSync, 900);
  return { sync, track };
}

/**
 * 显示公告弹窗（左侧内容 + 右侧历史）。已开着时：更高的紧急程度会顶掉低的，同级则切换内容。
 * @param {any} notice 要显示的那一条
 */
function show(notice) {
  if (!notice || !notice.text) return;
  const existing = document.getElementById(OPEN_KEY);
  if (existing) {
    if (Number(existing.getAttribute('data-rank') || 0) > rankOf(notice)) return; // 已有更紧急的挂着
    try { existing.remove(); } catch { /* ignore */ }
  }

  const wrap = document.createElement('div');
  wrap.id = OPEN_KEY;
  wrap.innerHTML = `<style>
      #${OPEN_KEY} { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center;
        background: #060b09; }
      /* 业主 2026-11-22「公告卡片尺寸不要乱动，最好固定」：宽高都写死，
         切换不同长度的公告时卡片不再跳；内容超出时在卡片内部滚动（.ap-body） */
      #${OPEN_KEY} .ap-card {
        width: min(880px, 94vw); height: min(560px, 78vh); max-height: 78vh;
        overflow: hidden; display: flex; flex-direction: column;
        background: #0f1715; border: 1px solid #2a3a34; box-shadow: 0 18px 60px rgba(0,0,0,.65); }
      #${OPEN_KEY} .ap-bar { height: 4px; flex: 0 0 auto; }
      #${OPEN_KEY} .ap-grid { display: grid; grid-template-columns: 250px minmax(0, 1fr); min-height: 0; flex: 1 1 auto; }
      #${OPEN_KEY} .ap-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
      #${OPEN_KEY} .ap-body { flex: 1 1 auto; min-height: 0; padding: 18px 20px 10px; overflow: auto; }
      #${OPEN_KEY} .ap-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
      #${OPEN_KEY} .ap-pips { display: inline-flex; gap: 3px; align-items: center; }
      #${OPEN_KEY} .ap-pips i { width: 6px; height: 12px; border-radius: 2px; display: block; background: rgba(255,255,255,.16); }
      #${OPEN_KEY} .ap-kicker { font-size: 11.5px; letter-spacing: .16em; font-weight: 700; }
      #${OPEN_KEY} .ap-sev { margin-left: auto; font-size: 11.5px; letter-spacing: .08em; opacity: .9; }
      #${OPEN_KEY} .ap-title { margin: 8px 0 10px; font-size: 19px; font-weight: 800; color: #eafff7; }
      #${OPEN_KEY} .ap-text { font-size: 14px; line-height: 1.75; color: #c8d6d0; white-space: pre-wrap; word-break: break-word; }
      /* 底栏：按钮靠右下，「下次更新前不再弹出」紧挨在它左边（业主 2026-11-22） */
      #${OPEN_KEY} .ap-foot { display: flex; align-items: center; justify-content: flex-end; gap: 14px; padding: 10px 20px 16px; }
      #${OPEN_KEY} .ap-snooze { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #8a9a94; cursor: pointer; }
      #${OPEN_KEY} .ap-snooze[hidden] { display: none; }
      #${OPEN_KEY} .ap-ok { padding: 7px 22px; font-size: 13px; font-weight: 700; cursor: pointer; border: 0; }
      #${OPEN_KEY} .ap-ok:hover { filter: brightness(1.08); }
      /* 右侧历史公告：卡片紧凑（业主：切换卡片不要过大） */
      #${OPEN_KEY} .ap-hist { border-right: 1px solid #22302b; display: flex; flex-direction: column; min-height: 0; }
      #${OPEN_KEY} .ap-hist-h { padding: 12px 12px 8px; font-size: 11.5px; letter-spacing: .12em; color: #7d8f88; flex: 0 0 auto; }
      #${OPEN_KEY} .ap-hist-list { overflow: auto; padding: 0 8px 10px; display: flex; flex-direction: column; gap: 5px; }
      #${OPEN_KEY} .ap-row { position: relative; display: grid; grid-template-columns: 4px minmax(0, 1fr) auto; gap: 7px; align-items: center;
        padding: 6px 7px; cursor: pointer; background: rgba(255,255,255,.02); border: 1px solid transparent; }
      #${OPEN_KEY} .ap-row:hover { background: rgba(255,255,255,.06); }
      /* 「查看中」不再是文字，而是用该档位的颜色高光把整张卡片包住（颜色由 JS 写进行内样式） */
      #${OPEN_KEY} .ap-row.is-on { background: rgba(255,255,255,.08); }
      #${OPEN_KEY} .ap-row-dot { width: 4px; height: 22px; border-radius: 2px; }
      #${OPEN_KEY} .ap-row-t { font-size: 12px; color: #c8d6d0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${OPEN_KEY} .ap-row-m { font-size: 10.5px; color: #7d8f88; margin-top: 1px; }
      #${OPEN_KEY} .ap-row-end { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
      #${OPEN_KEY} .ap-row-time { font-size: 10.5px; color: #7d8f88; white-space: nowrap; }
      /* 最新那条右上角的 NEW（颜色 = 该公告档位色，由 JS 写行内样式） */
      #${OPEN_KEY} .ap-row-new { font-size: 9.5px; font-weight: 800; letter-spacing: .12em; line-height: 1.4;
        padding: 0 5px; border-radius: 2px; border: 1px solid currentColor; }
      #${OPEN_KEY} .ap-hist-empty { padding: 4px 12px 12px; font-size: 12px; color: #6c7d76; }
      /* 自绘滚动条（业主 2026-11-22：不要浏览器原生那根）——原生条隐藏，用 .ap-slim 覆盖 */
      #${OPEN_KEY} .ap-body, #${OPEN_KEY} .ap-hist-list { scrollbar-width: none; -ms-overflow-style: none; }
      #${OPEN_KEY} .ap-body::-webkit-scrollbar, #${OPEN_KEY} .ap-hist-list::-webkit-scrollbar { width: 0; height: 0; }
      #${OPEN_KEY} .ap-main, #${OPEN_KEY} .ap-hist { position: relative; }
      #${OPEN_KEY} .ap-slim { position: absolute; right: 3px; width: 6px; border-radius: 3px; }
      #${OPEN_KEY} .ap-slim i { display: block; width: 100%; border-radius: 3px; background: rgba(200,214,208,.26); }
      #${OPEN_KEY} .ap-slim:hover i, #${OPEN_KEY} .ap-slim.is-drag i { background: rgba(200,214,208,.55); }
      @media (max-width: 720px) {
        #${OPEN_KEY} .ap-grid { grid-template-columns: minmax(0, 1fr); }
        /* 窄屏：历史排到内容下面（一打开先看到公告正文，而不是列表） */
        #${OPEN_KEY} .ap-hist { order: 2; border-right: 0; border-top: 1px solid #22302b; max-height: 32vh; }
        #${OPEN_KEY} .ap-main { order: 1; }
      }
    </style>
    <div class="ap-card" role="dialog" aria-modal="true" aria-label="公告">
      <div class="ap-bar"></div>
      <div class="ap-grid">
        <div class="ap-hist">
          <div class="ap-hist-h">历史公告</div>
          <div class="ap-hist-list" data-ap-history></div>
        </div>
        <div class="ap-main">
          <div class="ap-body">
            <div class="ap-head">
              <span class="ap-pips" aria-hidden="true"><i></i><i></i><i></i></span>
              <span class="ap-kicker"></span>
              <span class="ap-sev"></span>
            </div>
            <h2 class="ap-title" hidden></h2>
            <div class="ap-text"></div>
          </div>
          <div class="ap-foot">
            <label class="ap-snooze"><input type="checkbox" data-ap-snooze /> 下次更新前不再弹出</label>
            <button type="button" class="ap-ok" data-ap-close>知道了</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const $ = (sel) => wrap.querySelector(sel);
  const card = $('.ap-card');
  const bar = $('.ap-bar');
  const pips = $('.ap-pips');
  const kicker = $('.ap-kicker');
  const sev = $('.ap-sev');
  const titleEl = $('.ap-title');
  const textEl = $('.ap-text');
  const snoozeRow = $('.ap-snooze');
  const okBtn = $('.ap-ok');
  const listBox = $('[data-ap-history]');
  // 自绘滚动条：正文与历史列表各一条（原生条已在 CSS 里隐藏）
  attachSlimScroll($('.ap-body'), 'ap-slim');
  attachSlimScroll(listBox, 'ap-slim');
  let shown = notice;

  /** 把一条公告画到左边（含档位配色）。 */
  const paint = (n) => {
    shown = n;
    const lv = levelOf(n);
    const urgent = lv.key === 'urgent';
    wrap.setAttribute('data-rank', String(rankOf(n)));
    card.style.background = `linear-gradient(180deg, ${lv.tint}, #0f1715 42%)`;
    card.style.borderColor = lv.edge;
    card.style.boxShadow = urgent
      ? `0 18px 60px rgba(0,0,0,.65), 0 0 0 1px ${lv.edge}, 0 0 28px ${lv.soft}`
      : '0 18px 60px rgba(0,0,0,.65)';
    bar.style.background = lv.color;
    kicker.style.color = lv.color;
    kicker.textContent = `${lv.label} · ANNOUNCEMENT`;
    sev.style.color = lv.color;
    sev.textContent = `紧急程度 ${lv.severity}`;
    for (const [i, dot] of [...pips.children].entries()) {
      dot.style.background = i < lv.pips ? lv.color : 'rgba(255,255,255,.16)';
      dot.style.boxShadow = i < lv.pips ? `0 0 6px ${lv.edge}` : 'none';
    }
    if (n.title) { titleEl.textContent = n.title; titleEl.hidden = false; }
    else { titleEl.textContent = ''; titleEl.hidden = true; }
    textEl.textContent = n.text || '';
    // 业主 2026-11-22：所有档位都给「下次更新前不再弹出」（含紧急）
    snoozeRow.hidden = false;
    okBtn.style.background = lv.color;
    okBtn.style.color = '#06110d';
    // 右侧列表：当前这条排最上面，其后是历史
    renderList();
  };

  /** 左侧列表：**最新公告永远置顶**（右上角挂该档位颜色的 NEW），
   *  正在看的那一行用**该档位颜色高光整卡包裹**（不再是"· 查看中"文字）。 */
  const renderList = () => {
    const rows = [];
    // 业主 2026-11-22：最新一条必须常驻列表第一行 —— 否则切到旧公告之后就没有入口切回来了
    if (LATEST) rows.push({ ...LATEST, __latest: true });
    for (const h of HISTORY) if (!LATEST || h.id !== LATEST.id) rows.push(h);
    if (!rows.length) { listBox.innerHTML = '<div class="ap-hist-empty">暂无历史公告</div>'; return; }
    listBox.innerHTML = '';
    for (const n of rows) {
      const lv = levelOf(n);
      const viewing = !!shown && n.id === shown.id;
      const row = document.createElement('div');
      row.className = `ap-row${viewing ? ' is-on' : ''}`;
      row.setAttribute('data-ap-pick', String(n.id));
      row.title = (n.title || n.text || '') + (n.__latest ? '（最新）' : '');
      if (viewing) {
        // 高光 = 该档位颜色的描边 + 外发光 + 同色淡底
        row.style.borderColor = lv.color;
        row.style.boxShadow = `0 0 0 1px ${lv.edge}, 0 0 12px ${lv.soft}`;
        row.style.background = lv.tint;
      }
      const dot = document.createElement('span');
      dot.className = 'ap-row-dot';
      dot.style.background = lv.color;
      const main = document.createElement('span');
      main.style.minWidth = '0';
      const t = document.createElement('div');
      t.className = 'ap-row-t';
      t.textContent = listTitle(n);
      const m = document.createElement('div');
      m.className = 'ap-row-m';
      m.textContent = `${lv.label} · 紧急程度 ${lv.severity}`;
      main.appendChild(t);
      main.appendChild(m);
      // 右端：NEW 在时间上方（视觉上就是卡片右上角）
      const end = document.createElement('span');
      end.className = 'ap-row-end';
      if (n.__latest) {
        const badge = document.createElement('span');
        badge.className = 'ap-row-new';
        badge.textContent = 'NEW';
        badge.style.color = lv.color;
        badge.style.background = lv.soft;
        end.appendChild(badge);
      }
      const time = document.createElement('span');
      time.className = 'ap-row-time';
      time.textContent = fmtTime(n);
      end.appendChild(time);
      row.appendChild(dot);
      row.appendChild(main);
      row.appendChild(end);
      listBox.appendChild(row);
    }
  };

  paint(notice);

  const close = () => {
    try {
      const box = $('[data-ap-snooze]');
      if (box && box.checked) setSnooze(shown);
    } catch { /* ignore */ }
    try { wrap.remove(); } catch { /* ignore */ }
  };
  wrap.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t === wrap || (t && t.closest && t.closest('[data-ap-close]'))) { close(); return; }
    // 点历史卡片：切到那一条（不关闭弹窗）
    const pick = t && t.closest ? t.closest('[data-ap-pick]') : null;
    if (!pick) return;
    const id = pick.getAttribute('data-ap-pick');
    const target = (LATEST && LATEST.id === id) ? LATEST
      : ((shown && shown.id === id) ? shown : HISTORY.find((h) => h.id === id));
    if (target) paint(target);
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });
}

/** 当前是不是在对局界面（紧急档不管这个，非紧急档要避开）。 */
function inMatch() {
  try { return selectRoute(store.get()) === 'game'; } catch { return false; }
}

/**
 * 拉一次公告，按档位决定弹不弹。
 * @param {{ initial?: boolean }} [opts]
 */
async function check({ initial = false } = {}) {
  let j = null;
  try {
    const r = await fetch('/api/announcement', { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) return;
    j = await r.json();
  } catch { return; }
  // 历史随时更新（弹窗开着时右侧列表也要能跟上）
  HISTORY = Array.isArray(j && j.history) ? j.history : [];
  LATEST = (j && j.announcement && j.announcement.text) ? j.announcement : LATEST;
  const notice = j && j.announcement;
  if (!notice || !notice.text) return;
  const lv = levelOf(notice);
  const urgent = lv.key === 'urgent';
  if (SEEN.has(notice.id)) return;

  if (!urgent) {
    const scene = notice.scene || 'all';
    const wantMatch = scene === 'match';
    if (scene !== 'all' && wantMatch !== inMatch()) { SEEN.add(notice.id); return; }
    if (inMatch()) return;                   // 对局中的非紧急公告：记着，等回到大厅下次轮询再弹
  }
  // 业主 2026-11-22：勾了「下次更新前不再弹出」之后，紧急档也按它来（勾选对所有档位生效）
  if (snoozed(notice)) { SEEN.add(notice.id); return; }
  SEEN.add(notice.id);
  if (initial) setTimeout(() => show(notice), 800);   // 等首屏渲染完，别盖住加载动画
  else show(notice);
}

/**
 * 装上公告弹窗：连接时弹一次（旧行为），之后定时轮询，
 * 新一轮的**紧急公告能直接在对局里弹出来**（业主 2026-11-22）。
 * @returns {() => void} 卸载
 */
export function installAnnouncementPopup() {
  void check({ initial: true });
  // 服务端一改公告就推一帧（site.announcement）：立刻拉一次，紧急公告不必等那一轮轮询
  try { net.on('site.announcement', () => { void check(); }); } catch { /* net 未就绪时靠轮询兜底 */ }
  const timer = setInterval(() => { if (!document.hidden) void check(); }, POLL_MS);
  const onVis = () => { if (!document.hidden) void check(); };
  document.addEventListener('visibilitychange', onVis);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
}
