// public/js/ui/extensionEntry.js — 主题大厅里的「拓展模式」入口（业主 2026-11-14：「给我的拓展玩法加个入口，类似他的无限火力」）。
//
// 背景：主题大厅（分享包的 `screens/lobby.js`）只有它自己那一套入口（独立模拟 / 联盟模拟 / 无限火力 / 模拟邀约），
// 没有本仓的「拓展模式」（湮灭模拟 / 炸惊模拟）。主题文件我们不在运行时改，所以这里用**独立模块**补一颗入口：
//   · 在大厅 `.oh-fire`（分享包原来的无限火力 pill，已被补丁样式隐藏）旁边插入一颗同款样式的按钮；
//   · 点开后在 body 上挂一层自己的浮层，直接渲染**本仓**的 `ExtensionHall`（screens/extensionModes.js）；
//   · 选好玩法点「开始/进入」时，按本仓大厅同样的口径建房：`net.request('room.create', { mode, difficulty, erosion? })`。
// 原版大厅（没有主题）不需要它 —— 原版本来就有「拓展模式」第三张卡，所以只在 `html[data-ui-theme]` 下工作。
import { render } from '../../vendor/preact.module.js';
import { html } from './components.js';
import { ExtensionHall, extensionModeById, defaultExtensionPick, EXTENSION_MODES } from '../screens/extensionModes.js';
import { net } from '../net.js';
import { toastError } from './toasts.js';

const READY = () => EXTENSION_MODES.filter((m) => m.status === 'ready').length;
const LAYER_ID = 'sp-ext-entry-layer';

let host = null;        // 浮层容器
let mounted = false;

function unmount() {
  if (host) { render(null, host); host.remove(); host = null; }
}

/** 建房：与宿主大厅 createExtension 同一口径（mode + difficulty [+ 蚀流]）。 */
async function createRoom(id, erosion, party) {
  const entry = extensionModeById(id);
  if (!entry) return;
  const kind = party === 'coop' ? 'coop' : 'solo';
  const difficulty = entry.difficulty;
  const tiers = Number.isInteger(entry.erosionTiers) && entry.erosionTiers > 1;
  try {
    await net.request('room.create', {
      mode: kind,
      difficulty,
      ...(tiers ? { erosion: Number.isInteger(erosion) && erosion > 0 ? erosion : 1 } : {}),
    });
    unmount();
  } catch (err) { toastError(err); }
}

function openHall() {
  if (host) return;
  host = document.createElement('div');
  host.id = LAYER_ID;
  host.className = 'sp-ext-entry-layer';
  document.body.append(host);
  const state = { pick: defaultExtensionPick(EXTENSION_MODES), erosion: 1, party: 'solo', entered: false, key: 0 };
  const paint = () => render(html`<div class="sp-ext-entry-veil" onClick=${(e) => { if (e.target === e.currentTarget) unmount(); }}>
    <${ExtensionHall}
      selected=${state.pick}
      erosion=${state.erosion}
      party=${state.party}
      entered=${state.entered}
      enterKey=${state.key}
      onSelect=${(id) => { state.pick = id; state.entered = false; paint(); }}
      onErosion=${(n) => { state.erosion = n; paint(); }}
      onParty=${(p) => { state.party = p; paint(); }}
      onEnter=${(id) => { if (id) state.pick = id; state.key += 1; state.entered = true; paint(); }}
      onBack=${() => { state.entered = false; paint(); }}
      onPick=${(id, erosion, party) => createRoom(id || state.pick, erosion, party || state.party)}
      onClose=${unmount}
      onRules=${() => {}}
      onPoolEdit=${() => {}}
      onFeatureSettings=${() => {}}
      onSearchCoop=${() => {}}
      recruitRooms=${[]}
      onJoinRecruit=${() => {}}
      online=${true}
      busy=${null}
    />
  </div>`, host);
  paint();
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); unmount(); } };
  window.addEventListener('keydown', onKey, true);
  const obs = new MutationObserver(() => { if (!host || !host.isConnected) { window.removeEventListener('keydown', onKey, true); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
}

/** 生成那颗入口按钮（复用分享包 `.oh-fire` 的外观：同一个类加一个自己的标记类）。 */
function makeButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'oh-fire hub-ext-entry';
  btn.dataset.testid = 'lobby-ext-entry';
  const n = READY();
  btn.innerHTML = `<span class="oh-fire__label">拓展模式</span><b class="oh-fire__badge">${n}</b>`;
  btn.title = `拓展玩法：湮灭模拟 / 炸惊模拟（${n} 个可选）`;
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openHall(); });
  return btn;
}

/**
 * 业主 2026-11-17「超限玩法不见了，把他搞回来」：主题大厅里补一颗「超限模拟」入口。
 *
 * 为什么要在主题里补：分享包的 lobby 只有它自己那四个入口，本仓的「超限模拟」是原版大厅里
 * 作为第 5 个难度卡出现的（screens/lobby.js INFINITE_OPTION），主题入口看不到它；
 * 这颗按钮按本仓同一口径建房：`room.create { mode: 'solo_infinite' | 'coop_infinite', difficulty: 'ABYSS' }`
 * （超限 = 终极难度 + 无上限回合，服务端 shared/infiniteMode.js 认这两个 mode）。
 * 走单人还是同盟看大厅上次选的模拟方式（`sp.pref.lobby.simulation`），与用户当前选择一致。
 */
function makeInfiniteButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'oh-fire hub-inf-entry';
  btn.dataset.testid = 'lobby-infinite-entry';
  btn.innerHTML = '<span class="oh-fire__label">超限模拟</span><b class="oh-fire__badge">∞</b>';
  btn.title = '超限模拟：终极难度 + 敌方强度无上限（可选单人 / 同盟，按大厅当前模拟方式）';
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    let pref = 'coop';
    try {
      const raw = localStorage.getItem('sp.pref.lobby.simulation');
      if (raw != null) pref = JSON.parse(raw);
    } catch { /* 读不到就用同盟 */ }
    const mode = pref === 'solo' ? 'solo_infinite' : 'coop_infinite';
    try {
      await net.request('room.create', { mode, difficulty: 'ABYSS' });
    } catch (err) { toastError(err); }
  });
  return btn;
}

/** 把入口插进主题大厅（分享包的无限火力 pill 旁边）；大厅重渲染被删掉时补回去。 */
function ensureEntry() {
  if (document.documentElement.dataset.uiTheme == null) return;      // 原版大厅本来就有「拓展模式」卡
  const lobby = document.querySelector('.lobby-hub');
  if (!lobby) return;
  // 「超限模拟」入口：与「拓展模式」并列，两个各自独立补（互不阻塞）
  if (!lobby.querySelector('.hub-inf-entry')) {
    const inf = makeInfiniteButton();
    const ext = lobby.querySelector('.hub-ext-entry');
    const anchor = lobby.querySelector('.oh-fire');
    if (ext && ext.parentElement) ext.parentElement.insertBefore(inf, ext);
    else if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(inf, anchor);
    else lobby.append(inf);
  }
  if (lobby.querySelector('.hub-ext-entry')) return;
  const anchor = lobby.querySelector('.oh-fire');
  const btn = makeButton();
  if (anchor && anchor.parentElement) {
    // 分享包那颗无限火力 pill 由补丁样式隐藏，正好占着同一个布局槽位
    anchor.parentElement.insertBefore(btn, anchor);
  } else {
    lobby.append(btn);
  }
}

function boot() {
  if (mounted) return;
  mounted = true;
  ensureEntry();
  const obs = new MutationObserver(() => ensureEntry());
  obs.observe(document.body, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
