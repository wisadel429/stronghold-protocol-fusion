// Client entry: boot (fonts, identity, socket), net → store wiring, router, global overlays.
//
// Router (derived from the store, no URL routes):
//   not entered            → Title
//   m.public.phase ≠ LOBBY → Game (screens/game.js: briefing / band draft / match / result by phase)
//   room.inMatch           → Game (match starting, m.public on its way)
//   in a room              → Room
//   otherwise              → Lobby
// Deep link `?room=CODE`: remembered at boot, auto-joined once the player has entered and the
// session is online (after a short grace period in case the server restores a room on resume).
// Reloading a tab that already passed the title re-enters automatically (sessionStorage flag) and
// resumes the server session with the saved token; stale room/match state is dropped if the
// server does not re-push it within RESTORE_GRACE_MS after `welcome`. Boot waits for
// `identity.init()` (which token this tab may use without stealing another live tab's session)
// before the first connect; a page restored from the back/forward cache reloads.
// A `welcome` with a NEW playerId (the server restarted / the session expired) while a room or match was on screen:
// toast 「服务器会话已重置，上一局模拟已结束」 (store.js sessionResetNotice) and return to the lobby with nothing stale.
//
// Shared modules are imported relatively ('../../shared/…' resolves to /shared/… in the browser).
// Multi-device support (ui/device.js + css/devices.css): feature classes on <html>, no page zoom, safe areas, rotation
// re-layout; ui/compat.js polyfills are imported before anything else.
// 干员调配 (DESIGN §16): an overlay over any route (<LoadoutHost/>, opened from lobby / room / briefing); its loadout is
// kept in sync with the server by installLoadoutSync (room.loadout after every welcome and edit), its 干员持有 tab's
// not-owned list (0.2.0 补位) by installOwnershipSync (room.ownership, likewise), the 自选编队 picks (0.2.0 DIY) by
// installDiySync (room.diy, likewise; it also keeps welcome.diyKitted for the picker).
// Game data: every text of the game is static data (/data/*.json) downloaded once per page; the in-match files are
// warmed in the background as soon as the player is in a room (warmGameData), before the match needs them.
// Language (ui/lang.js, docs/I18N.md): chosen before the first render (initLang); App re-renders on a switch (useLang).
// Server texts are translated on arrival: m.toast / m.ticker frames (msgid + params, or the text as a msgid; a
// config.broadcasts line from its id + args), error codes (ui/toasts.js describeError) and room.closed reasons.
// Cosmetic plugins (DESIGN §32 P1a): installContent (content.js) lays the room's visual set and the player's personal
// plugins over the art manifest every screen reads. Gameplay plugins (§32.6): installContentSet (content.js) downloads and
// checks a room's content set and makes it the data every screen and the battle runner read.
// Official versions (DESIGN §35.23, versions.js): welcome.versions turns the lobby's version switch on; installContentSet
// also loads and checks the version the page shows (the lobby's choice, a room's version). A room whose version changes
// while a result is on screen drops that result (the server dropped the room's replay: its chess ids are the old
// version's), and a result that arrives after the room is gone keeps the version its frames name (m.result / m.public
// `version`, versions.js matchFrameVersion), also on a freshly loaded page that never saw the room.

// Polyfills first (older Safari / Firefox ESR): every module evaluated after this one sees them.
import './ui/compat.js';
import { render } from '../vendor/preact.module.js';
import { useEffect, useState, useErrorBoundary } from '../vendor/hooks.module.js';
import { html, UiHosts, Button, MicroLabel, closeAllDialogs } from './ui/components.js';
import { ConnectionBanner } from './ui/connBanner.js';
// 账号系统（server/accounts）：登录态查询 + 云存档同步（未登录时服务端会拒绝 WS 握手）
import { accountApi } from './accountApi.js';
import { installCloudSave } from './ui/cloudSave.js';
// 好友邀请浮层（账号系统第二期）：收到好友邀请时在任意界面弹出「加入 / 忽略」
import { installSocialInvites } from './screens/social.js';
import { installMessageCenter } from './ui/messageCenter.js';
import { installAnnouncementPopup } from './ui/announcementPopup.js';
import { SocialButton } from './screens/social.js';
import { ToastHost, toast, toastError, describeError } from './ui/toasts.js';
import { getRoomDanmaku } from './ui/roomDanmaku.js';
import { net, identity, NetError } from './net.js';
import { store, useStore, emptyMatch, selectRoute, sessionResetNotice, isSpectating, pushChatMessage, clearChat, roomIdentityChanged } from './store.js';
import { data } from './data.js';
import { GAME_FILES } from './ui/gameComponents.js';
import { TitleScreen, sanitizeName } from './screens/title.js';
import { LobbyScreen, rememberRoom, parseRoomParam, joinKnown } from './screens/lobby.js';
import { RoomScreen, TrustedNotice } from './screens/room.js';
import { playLobbyIntro } from './ui/lobbyIntro.js';
import { NoticeBar, hasNotice } from './ui/notice.js';
import { GameScreen } from './screens/game.js';
import { preloadBootArt } from './ui/protocolBoot.js';
import { audio, installAudio } from './audio.js';
import { installLobbyMedia } from './ui/lobbyMedia.js';
import { settingsStore } from './ui/settings.js';
import { GuideHost } from './ui/guide.js';
import { installDeviceSupport, useFullscreen, useScreenWakeLock } from './ui/device.js';
import { installFullscreenHotkey } from './ui/fullscreen.js';
import { isCombatPhase } from './ui/gameLogic/phases.js';
import { registerImportedAssetWorker } from './assetCache.js';
import { LoadoutHost } from './screens/loadout.js';
import { StatsHost, useStatsOpen } from './screens/stats.js';
import { CoveredVersionVote } from './ui/versionVote.js';
import { installRehearsal } from './battle/rehearsal.js';
import { recordResult, installStatsRecorder } from './ui/stats.js';
import { installLoadoutSync, installOwnershipSync, installDiySync, installSkinsSync, installCardSync, installSettingsViews, loadoutStore } from './ui/loadoutSync.js';
import { skinsStore, SKINS_KEY } from './ui/skins.js';
import { startBuildGuard } from './ui/buildGuard.js';
import { updateArtKeyNotice } from './ui/artKeyNotice.js';
import { initLang, useLang, tickerText } from './ui/lang.js';
import { t, N_, translateWire } from '../../shared/i18n.js';
import { recordError, installTrafficMeter } from './diag.js';
import { installErrorReporter, ErrorDialogHost } from './ui/errorDialog.js';
import { installContent, installContentSet } from './content.js';
import { cosmetics } from './cosmetics.js';
import { sanitizeVersions, roomVersion, isDefaultVersion, matchFrameVersion } from './versions.js';

const RESTORE_GRACE_MS = 1500;
const JOIN_DELAY_MS = 350;
const TICKER_KEEP = 20;
const EMOTE_KEEP = 20;

const SCREENS = { title: TitleScreen, lobby: LobbyScreen, room: RoomScreen, game: GameScreen };

// 右下角的全局水印文本（业主 2026-11-14：SERVER-1）。多服部署时改这里，或部署时用
// window.__SP_SERVER_NAME__ 覆盖（例如在 index.html 的 runtime-config 里写）。
const SERVER_WATERMARK = (typeof globalThis.__SP_SERVER_NAME__ === 'string' && globalThis.__SP_SERVER_NAME__.trim())
  || 'SERVER-1';

// ---- the Android shell link (docs/ANDROID.md §8, MainActivity.armBlankScreenWatchdog) -----------------
//
// A page whose DOM exists but whose WebView surface never composites looks exactly like a healthy page from inside
// JavaScript, so the shell may not judge by this file's word alone. Two things cross the bridge instead:
//
//   __SP_PAINT__       a count of *delivered* frames that the shell polls; zero means this page never got a frame
//                      (a blocked main thread, a dead GPU surface, or a page that threw before boot);
//   reportClientState  what this page can see — boot, layout size, canvases, WebGL, UA, errors — for the 查看日志
//                      dialog, which is the only evidence a player can read off a black screen.
//
// The counter only has to outlive the watchdog's window: a rAF loop that runs forever is a wakeup forever.
const PAINT_HEARTBEAT_MS = 60_000;

// Counts *delivered* frames, not calls made: a page the compositor never gives a frame to leaves it at 0, and a screen
// that has finished drawing simply stops counting (an idle page gets no more rAF callbacks — that is not a black
// screen, so the shell treats the first delivered frame as the evidence and never asks for a stream).
globalThis.__SP_PAINT__ = 0;
(function paintHeartbeat(until = performance.now() + PAINT_HEARTBEAT_MS) {
  requestAnimationFrame(() => {
    globalThis.__SP_PAINT__++;
    if (performance.now() < until) paintHeartbeat(until);
  });
})();

/**
 * Tell the Android shell what this page can see (browsers and older shells have no bridge: nothing happens).
 * `painted: true` is sent only once a frame really reached the screen (see the end of boot()), so the shell never
 * mistakes a rendered DOM for a drawn one.
 */
function reportClientState(extra = {}) {
  const native = globalThis.AndroidNative;
  if (typeof native?.reportClientState !== 'function') return;
  const gl = (type) => { try { return !!document.createElement('canvas').getContext(type); } catch { return false; } };
  const root = document.querySelector('.app-root') || document.getElementById('app');
  const renderedW = root?.clientWidth || 0;
  const renderedH = root?.clientHeight || 0;
  const layoutCollapsed = renderedW === 0 || renderedH === 0;
  try {
    native.reportClientState(JSON.stringify({
      at: Date.now(),
      booted: !!globalThis.__SP__ && !layoutCollapsed,
      layoutCollapsed,
      renderedW,
      renderedH,
      rootChildren: document.getElementById('app')?.childElementCount ?? -1,
      canvases: document.querySelectorAll('canvas').length,
      webgl2: gl('webgl2'), webgl: gl('webgl'),
      paintTicks: globalThis.__SP_PAINT__ || 0,
      dpr: globalThis.devicePixelRatio || 1,
      vw: globalThis.innerWidth || 0, vh: globalThis.innerHeight || 0,
      ua: String(navigator.userAgent).slice(0, 160),
      ...(layoutCollapsed ? { error: `UI layout collapsed (w=${renderedW}, h=${renderedH})` } : {}),
      ...extra,
    }));
  } catch { /* a reporting failure must never break boot */ }
}

/** Copy of a server message without transport fields. */
function payload(msg) {
  const { t, rid, ...rest } = msg; // eslint-disable-line no-unused-vars
  return rest;
}

function clearRoomParam() {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has('room')) return;
    url.searchParams.delete('room');
    history.replaceState(history.state, '', url.pathname + (url.search || '') + url.hash);
  } catch { /* ignore */ }
}

// ---- net → store wiring ---------------------------------------------------------------------------

let seq = 0;
let welcomeAt = 0;
let roomStateAt = 0;
let matchAt = 0;
let restoreTimer = null;
let joinTimer = null;
let joinInFlight = false;
/** The rehearsal installer (battle/rehearsal.js): its tasks follow the match on screen (see wireNet's store hook). */
let rehearsal = null;

function clearPendingJoin() {
  store.patch('ui', { pendingJoin: null });
  clearRoomParam();
}

/** Auto-join the deep-linked room once entered + online (idempotent). */
function schedulePendingJoin() {
  clearTimeout(joinTimer);
  joinTimer = setTimeout(async () => {
    const s = store.get();
    const code = s.ui.pendingJoin;
    if (!code || joinInFlight || !s.session.entered || net.status !== 'online') return;
    if (s.room) {
      if (s.room.code !== code) toast(t('你已在其他同盟中，请先离开当前同盟'), 'warn');
      clearPendingJoin();
      return;
    }
    joinInFlight = true;
    try {
      await joinKnown('room.join', code);
    } catch (err) {
      toastError(err);
    } finally {
      joinInFlight = false;
      clearPendingJoin();
    }
  }, JOIN_DELAY_MS);
}

/** End the post-resume "syncing" state early once the server re-pushed what we were showing. */
function maybeFinishRestore() {
  const s = store.get();
  if (!s.ui.restoring) return;
  const roomOk = !s.room || roomStateAt >= welcomeAt;
  const matchOk = !s.match.public || matchAt >= welcomeAt || !s.room?.inMatch;
  if (roomOk && matchOk) {
    clearTimeout(restoreTimer);
    store.patch('ui', { restoring: false });
  }
}

/**
 * Leave whatever room / match was on screen for the lobby with nothing stale left behind: open imperative dialogs,
 * the post-resume restore timer, ticker lines and emote bubbles of the old match (the battle runner and the 暂离 flag
 * follow the store themselves).
 */
function backToLobby() {
  identity.rememberMatch(null);
  clearTimeout(restoreTimer);
  const s = store.get();
  if (s.room || s.match.public) closeAllDialogs();
  store.set({ room: null, match: emptyMatch(), ticker: [], emotes: [] });
  store.patch('ui', { restoring: false });
}

/** The unofficial plugins a server counts in welcome / /healthz `content.plugins` (absent: none — DESIGN §32 P1a). */
const pluginCount = (content) => (content && Number.isInteger(content.plugins) && content.plugins > 0 ? content.plugins : 0);

function onWelcome(msg) {
  identity.saveToken(msg.token);
  identity.rememberMatch(null);
  const prev = store.get();
  const prevId = prev.me.playerId;
  const name = typeof msg.name === 'string' && msg.name ? msg.name : prev.me.name;
  identity.saveName(name);
  store.set({
    me: { playerId: msg.playerId ?? null, name, token: typeof msg.token === 'string' ? msg.token : null },
    // the server's content identity (DESIGN §32): the diagnostics name it (diag.js contentLine)
    content: msg.content && typeof msg.content.vanilla === 'string' ? { vanilla: msg.content.vanilla } : null,
    // how many unofficial plugins it has (P1a — absent: none; content.js fetches the catalogue only when there are some)
    installedPlugins: pluginCount(msg.content),
    installedNotices: msg.content?.notices === true,
    testMode: msg.testMode === true,
    // the official versions the server enables (protocol §2; absent: the switch is off — versions.js)
    versions: sanitizeVersions(msg.versions),
  });
  welcomeAt = Date.now();

  if (msg.takeoverFrom === prevId && prevId != null) {
    toast(t('你已接管AI席位，资金、阵容与席位已保留'), 'info');
  } else if (prevId != null && prevId !== msg.playerId) {
    // A brand-new server session (the server restarted — crashed / killed, so no room.closed arrived — or this session
    // expired on it): whatever we showed before is gone — back to the lobby cleanly and say why.
    const notice = sessionResetNotice(prev, msg.playerId);
    backToLobby();
    if (notice) toast(t(notice), 'warn', { ttl: 7000 });
  } else if (prev.room || prev.match.public) {
    // Resumed session: the server re-pushes room/match state; drop whatever it doesn't.
    store.patch('ui', { restoring: true });
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      const s = store.get();
      const patch = {};
      if (s.room && roomStateAt < welcomeAt) patch.room = null;
      if (s.match.public && matchAt < welcomeAt) patch.match = emptyMatch();
      store.set(patch);
      store.patch('ui', { restoring: false });
    }, RESTORE_GRACE_MS);
  }
  schedulePendingJoin();
}

function onRoomState(msg) {
  const room = payload(msg);
  roomStateAt = Date.now();
  const myId = store.get().me.playerId;
  const seats = Array.isArray(room.seats) ? room.seats : [];
  if (myId != null && seats.length && !seats.some((s) => s && s.playerId === myId) && !isSpectating(room, myId)) {
    // We are no longer seated (kicked / left elsewhere) — neither in a player seat nor a spectator seat.
    if (store.get().room) toast(t('你已不在该同盟中'), 'warn');
    store.set({ room: null, match: emptyMatch() });
    return;
  }
  const prevRoom = store.get().room;
  // A (new) match starts: forget the previous match's state so stale results never show.
  if (room.inMatch && !(prevRoom && prevRoom.inMatch && prevRoom.code === room.code)) store.set({ match: emptyMatch() });
  // The room switched its version (DESIGN §35.23): a result still on screen (a settlement, a spectator's view) names the old
  // version's chess ids, and the server dropped the room's replay — it closes, back to the room.
  else if (prevRoom && prevRoom.code === room.code && !room.inMatch && roomVersion(prevRoom) !== roomVersion(room) && store.get().match.public) store.set({ match: emptyMatch() });
  store.set({ room });
  identity.rememberMatch(room.inMatch && seats.some((seat) => seat?.playerId === myId)
    ? { name: store.get().me.name, code: room.code || '' } : null);
  if (room.mode === 'coop' && typeof room.code === 'string') rememberRoom(room.code, room.test === true);
  maybeFinishRestore();
}

const CLOSE_REASON = {
  // 'timeout' = this player was removed after staying disconnected past the lobby grace (server/lobby.js)
  host_left: N_('创建者已离开，同盟已解散'), timeout: N_('由于长时间断开连接，你已离开同盟'), empty: N_('同盟已解散'),
  kicked: N_('你已被移出同盟'), ended: N_('模拟已结束'), expired: N_('同盟已过期'), shutdown: N_('服务器维护中，同盟已关闭'),
  // 结束暂离的独立模拟（业主 2026-11-14）：这条紧随结算帧而来，不是异常，别再弹黄色警告
  'parked-end': N_('模拟已结束'),
};

function wireNet() {
  net.on('status', (snap) => {
    const cur = store.get().connection;
    store.set({
      connection: {
        status: snap.status, ping: snap.ping, attempt: snap.attempt, retryAt: snap.retryAt,
        lastError: snap.lastError, everOnline: cur.everOnline || snap.status === 'online',
      },
    });
  });
  net.on('clock', (c) => store.set({ clock: { offset: c.offset, rtt: c.rtt, synced: c.synced } }));
  net.on('welcome', onWelcome);
  net.on('helloError', (err) => {
    if (err.code === 'SESSION_IN_USE') identity.rejectToken();
    // 账号系统：未登录 / 会话被顶掉 → 回标题页的登录卡（服务端 requireAccount 会拒绝握手）。
    // 不整页刷新：刷新在「cookie 还在但会话已失效」时会来回循环；这里清掉账号态、断开 socket，标题页直接显示登录表单。
    if (err && (err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_EXPIRED')) {
      try { toast(t(err.code === 'AUTH_EXPIRED' ? '账号已在其他设备登录，请重新登录' : '请先登录'), 'warn', { ttl: 6000 }); } catch { /* ignore */ }
      try { identity.rejectToken(); } catch { /* ignore */ }
      try { net.close(); } catch { /* ignore */ }
      backToLobby();
      store.set({ account: null, accountsEnabled: true, session: { ...store.get().session, entered: false } });
      return;
    }
    toastError(err);
  });
  net.on('replaced', () => toast(t('该身份已在其他页面登录，本页已断开'), 'warn', { ttl: 6000 }));
  // ---- 后台推送 (server/admin-live.js): 全服公告 / 闪断预警 / 关服 ----
  net.on('notice', (msg) => {
    // 全服公告条 (ui/notice.js): an empty text is the server clearing it (or its TTL passing)
    const text = msg && typeof msg.text === 'string' ? msg.text.trim() : '';
    if (!text) { store.set({ notice: null }); return; }
    store.set({ notice: { text: text.slice(0, 500), at: Number(msg.at) || Date.now(), until: Number(msg.until) || 0 } });
  });
  net.on('server.warn', (msg) => {
    if (!msg || msg.cancelled === true || !(msg.until > Date.now())) { store.set({ flashWarn: null }); return; }
    store.set({ flashWarn: {
      text: msg.text || t('服务器即将闪断更新'),
      at: Number(msg.at) || Date.now(),
      until: Number(msg.until),
      closeOnExpire: msg.closeOnExpire !== false,
    } });
  });
  net.on('server.closed', (msg) => {
    store.set({ flashWarn: null });
    if (msg && msg.open === false) toast(msg.text ? ('服务器已关闭：' + msg.text) : t('服务器已关闭，请稍后再来'), 'warn', { ttl: 8000 });
  });
  // 消息中心实时推送（业主 2026-11-22）：server/accounts/messages.js 一落盘就推 `account.msg`（好友请求 / 同盟邀请 /
  // 后台回复反馈都走这一条通道）。消息中心是原生 DOM 浮层、不在 Preact 树里，所以这里只广播一个窗口事件，
  // 由 ui/messageCenter.js 自己监听并刷新 —— 那边还有 60 秒兜底轮询，推送只是把延迟从「一个轮询周期」降到即时。
  net.on('account.msg', (msg) => {
    try { window.dispatchEvent(new CustomEvent('sp:messages', { detail: msg || null })); } catch { /* 浮层的事不该影响对局 */ }
  });
  // 搜寻队友 (server/matchmaking.js): queue progress, then the room the server formed
  // 两个字段名同时写：本仓大厅 (`screens/lobby.js`) 读 `matchmake`，而分享包的主题 UI（可露希尔 / 卫戍协议终端）
  // 读的是 `matchmaking`（它的 `isSearching = mm?.status === 'searching'`）。store 里本来就有 `matchmaking`
  // 这个字段（store.js），只是此前没人写 → 主题下的「搜寻队友」点了没反应、面板不进 searching。
  net.on('match.status', (msg) => {
    if (!msg || msg.status !== 'searching') {
      store.set({ matchmake: null, matchmaking: { ...(store.get().matchmaking || {}), status: 'idle' } });
      if (msg && msg.reason === 'timeout') toast(t('匹配超时，已取消；可以再试或先创建同盟'), 'warn', { ttl: 6000 });
      return;
    }
    const progress = {
      status: 'searching', mode: String(msg.mode || ''), difficulty: String(msg.difficulty || ''),
      elapsed: Number(msg.elapsed) || 0, matched: Number(msg.matched) || 1, target: Number(msg.target) || 4,
    };
    store.set({ matchmake: progress, matchmaking: progress });
  });
  net.on('match.found', (msg) => {
    store.set({ matchmake: null, matchmaking: { ...(store.get().matchmaking || {}), status: 'idle' } });
    toast(t('已找到队友，正在进入房间…'), 'success', { ttl: 4000 });
    void msg;
  });
  net.on('unhandledError', (err) => toastError(err));
  net.on('room.state', onRoomState);
  net.on('room.closed', (msg) => {
    backToLobby();
    // 结束暂离的独立模拟：随后就是结算界面，别再用黄色 toast 盖住它（业主 2026-11-14「给了个黄色的弹窗」）
    if (String(msg.reason) === 'parked-end') return;
    const known = Object.hasOwn(CLOSE_REASON, String(msg.reason)) ? CLOSE_REASON[msg.reason] : null;
    toast(known ? t(known) : typeof msg.reason === 'string' && msg.reason.length < 60 ? t('同盟已关闭：{reason}', { reason: msg.reason }) : t('同盟已关闭'), 'warn');
  });
  net.on('m.public', (msg) => { matchAt = Date.now(); store.patch('match', { public: payload(msg) }); maybeFinishRestore(); });
  net.on('m.private', (msg) => { matchAt = Date.now(); store.patch('match', { private: payload(msg) }); });
  net.on('m.layer', (msg) => {
    const s = store.get();
    if (selectRoute(s) === 'game' && msg.playerId === s.me?.playerId) audio.layerGain(msg.bondId, msg.add);
  });
  net.on('m.field', (msg) => store.patch('match', { field: payload(msg) }));
  net.on('m.result', (msg) => {
    const res = payload(msg);
    store.patch('match', { result: res });
    // 本机统计 (PR #323): every arrival, including the lobby's result replay after a reconnect / reload —
    // replays dedupe by content id inside recordResult (spectator seats' copies build no record at all)
    // (`vs`: the room's cosmetic plugins, recorded — such a match still counts as the original game: ui/stats.js)
    // (`content`: the room's content set when it played gameplay plugins — such a match is unofficial: ui/stats.js)
    // (`version`: the official version the match played, DESIGN §35.23 — the room's, or the result's own `version` when
    // it arrives after the room is gone, also to a freshly loaded page; only a non-default one is written)
    const s = store.get();
    const version = s.room ? roomVersion(s.room) : matchFrameVersion({ result: res, public: s.match.public });
    if (s.room?.test !== true && s.match.public?.test !== true) recordResult(res, { myId: s.me.playerId, roomMode: s.room?.mode ?? null, vs: s.room?.content?.vs ?? null, content: s.room?.content ?? null, version: isDefaultVersion(version) ? null : version, now: Date.now() });
  });
  net.on('m.toast', (msg) => {
    const kind = ['info', 'success', 'warn', 'error'].includes(msg.kind) ? msg.kind : 'info';
    // msgid + params (server ≥ 0.2.0) or the text itself as a msgid, in the current language
    toast(translateWire(msg), kind);
  });
  net.on('m.ticker', (msg) => {
    if (typeof msg.text !== 'string') return;
    const text = tickerText(msg);
    // type, player + the round it came in: a BOSS_HIT line is dropped once its boss round is over and superseded by the
    // same player's next one (ui/ticker.js tickerLineLive / tickerSupersedes)
    const type = typeof msg.type === 'string' ? msg.type : null;
    const playerId = typeof msg.playerId === 'string' ? msg.playerId : null;
    // its broadcast priority: the strip plays the highest first (ui/ticker.js enqueueTickerLines)
    const priority = Number.isFinite(msg.priority) ? msg.priority : 0;
    store.set((s) => ({ ticker: [...s.ticker.slice(-(TICKER_KEEP - 1)), { id: ++seq, text, at: Date.now(), type, playerId, round: s.match?.public?.round ?? null, priority }] }));
  });
  net.on('m.emote', (msg) => {
    store.set((s) => ({ emotes: [...s.emotes.slice(-(EMOTE_KEEP - 1)), { seq: ++seq, playerId: msg.playerId, id: msg.id, at: Date.now() }] }));
  });
  // 房间 / 局内文字聊天 (room.chat): the room screen's draggable panel and the in-match ChatBox both read the store's
  // ring buffer, and every line also flies as a danmaku (ui/roomDanmaku.js; the switch lives in that module's store).
  net.on('room.chat', (msg) => {
    pushChatMessage(msg);
    try {
      // the waiting room's own panel draws its danmaku (ui/roomChat.js); the in-match ChatBox relies on this one
      const s = store.get();
      if (selectRoute(s) === 'game') getRoomDanmaku().show(msg, msg.playerId === s.me?.playerId);
    } catch { /* the danmaku layer must never break the chat log */ }
  });

  // Entering (title → lobby) while already online also needs the deep-link join.
  store.subscribe((s, prev) => {
    if (s.session.entered && !prev.session.entered) schedulePendingJoin();
    // in a room (co-op or solo, also a resumed one) a match is near: its data starts downloading
    if (s.room && !prev.room) warmGameData();
    // the previous room's lines must not sit under the next room's (leaving included, not only on room.closed)
    if (roomIdentityChanged(prev.room, s.room)) clearChat();
    // the match on screen is over (left, closed, kicked, a new session): a rehearsal task of it is dead, and the frame
    // that cancels it may never arrive (a disposed match sends nothing) — the page stops what it is running itself
    if (selectRoute(prev) === 'game' && selectRoute(s) !== 'game') rehearsal?.clear();
  });
}

/**
 * Download every data file of the match UI (gameComponents GAME_FILES: operators, skills, bonds, items, enemies, 特质 …)
 * and the pre-game sprites in the background once the player is in a room — a match is near (the lobby alone never
 * downloads them). The game's
 * texts are static data loaded once per page — never fetched during a match — and the match screen waits for these
 * files, so with them warmed it opens at once and no text ever appears late (user playtest #3 item 9). Idempotent (the
 * data store shares each file's promise).
 */
function warmGameData() {
  // a room with gameplay plugins: content.js downloads its content set's files instead (DESIGN §32.6). With the art list
  // in, the pre-game sprites (协议启动！ and the 请选择策略 band, ui/protocolBoot.js) start too: a solo player who starts
  // at once and skips through the briefing meets the band draft's first turn with them at hand (§35.18's leftover)
  // Another official version's room (DESIGN §35.23): its version set brings those files (content.js) — the server's
  // default ones would race it; only the art list the sprites need is fetched.
  const go = () => {
    const room = store.get().room;
    if (room?.content?.vanilla === false) return;
    if (typeof room?.version === 'string') { data.load('assets').then(() => preloadBootArt(), () => {}); return; }
    data.loadAll(GAME_FILES).then(() => preloadBootArt(), () => {});
  };
  if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(go, { timeout: 2500 });
  else setTimeout(go, 600);
}

// ---- UI chrome (the connection banner lives in ui/connBanner.js) -----------------------------------

function ScreenCrashed({ error, reset }) {
  return html`<div class="screen crash">
    <div class="crash__box brackets">
      <${MicroLabel} tone="mint">SYSTEM FAULT<//>
      <h2>${t('界面发生错误')}</h2>
      <p class="t-lo">${String(error?.message || error).slice(0, 200)}</p>
      <${Button} variant="primary" icon="refresh" onClick=${reset}>${t('重新加载界面')}<//>
    </div>
  </div>`;
}

/**
 * 闪断预警条：顶部常驻倒计时，纯 transform/opacity 动画，一个 1s 定时器。
 *
 * 业主 2026-11-22 第三轮调整：
 *   1) 「走马灯」＝原来在背景上的那道斜向扫光，现在挪到**外框**上跑，并且带渐散（彗星头 + 长渐隐尾巴）；
 *   2) 左侧红点换成**三角感叹号**警报图标，辉光闪动频率放慢（2.6 秒一轮，不抢注意力）；
 *   3) 文字过长时**自动滚动**（量溢出宽度，超出才启用）。
 */
function FlashWarnBar() {
  const w = useStore((s) => s.flashWarn);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!w) { setLeft(0); return undefined; }
    const tick = () => setLeft(Math.max(0, Number(w.until) - Date.now()));
    tick();
    const id = setInterval(() => { if (!document.hidden) tick(); }, 1000);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [w && w.until]);
  const show = !!w && left > 0;
  const sec = Math.ceil(left / 1000);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');

  // 文字过长才滚：文本变化时量一次溢出宽度，按每秒约 45px 折算时长，两端各留停留（关键帧里留了）。
  const text = show ? w.text : '';
  const [marquee, setMarquee] = useState(null);
  useEffect(() => {
    setMarquee(null);
    if (!text) return undefined;
    // 等两帧再量：第一帧 DOM 刚插入还没排版，scrollWidth / clientWidth 都可能是 0，
    // 量出 0 就会误判成"溢出 0"或算出荒谬的位移（文字被推出可视区，看起来就像"没有文字"）。
    let raf2 = 0;
    const raf = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        try {
          const track = document.querySelector('[data-testid="flash-warn"] .flashwarn__track');
          const box = track && track.parentElement;
          if (!track || !box) return;
          const boxW = box.clientWidth;
          if (boxW < 40) return;                 // 还没排好版（或条是收起的），这次不滚
          const overflow = Math.ceil(track.scrollWidth - boxW);
          if (overflow > 8) {                    // 8px 以内不值得滚，反而显得抖
            const dur = Math.max(7, Math.round((overflow / 45) * 2) + 6);
            setMarquee({ shift: overflow, dur });
          }
        } catch { /* 量不到就退化成不滚：预警条本身不能因为量不到尺寸而挂掉 */ }
      });
    });
    return () => { cancelAnimationFrame(raf); if (raf2) cancelAnimationFrame(raf2); };
  }, [text]);
  const trackStyle = marquee ? `--marquee-shift:-${marquee.shift}px;--marquee-dur:${marquee.dur}s` : null;

  // 注意：is-soon / is-urgent 必须挂在 show 上。
  // 曾经只判断秒数，倒计时归零后 sec = 0 让两者都成立，而 is-show 已经撤掉 ——
  // CSS 里 `.is-soon`/`.is-urgent` 各自带 animation: flashwarn-in … both，both 会保持末帧
  // （opacity:1 + translate(-50%,0)），结果就是预警结束后顶上留一条空的残留条。
  const tone = `${show ? ' is-show' : ''}${show && sec <= 60 ? ' is-soon' : ''}${show && sec <= 10 ? ' is-urgent' : ''}`;
  return html`<div class=${`flashwarn${tone}`}
      role="status" aria-live="polite" data-testid="flash-warn">
    <span class="flashwarn__ring" aria-hidden="true"></span>
    <span class="flashwarn__ico" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3.3 22 20.2H2Z" />
        <path d="M12 9.4v4.7" />
        <path d="M12 17.5h.01" />
      </svg>
    </span>
    <span class="flashwarn__scroll">
      <span class=${`flashwarn__track${marquee ? ' is-scroll' : ''}`} style=${trackStyle}>${text}</span>
    </span>
    <b class="flashwarn__time num">${show ? `${mm}:${ss}` : ''}</b>
  </div>`;
}

/**
 * 闪断预警的「强调特效」（业主 2026-11-22：照 ClassIsland 的强调提醒做，颜色用红）。
 *
 * ClassIsland 那边的实现是 RippleEffect：提醒触发时弹一个**全屏透明置顶窗**，在里面放一个圆形色块，
 * 圆心取通知的 CenterPoint、填充取这条通知自己的 Color，然后
 *   直径 = 圆心到窗口四角最远距离 × 2（展开后刚好盖满整屏）
 *   Scale  0 → 1  QuadraticEaseIn  600ms
 *   Opacity 1 → 0 SineEaseIn        600ms
 *   750ms 后收尾（EffectCompleted）
 * 而且一次提醒**只播一个**波纹，不是连播。
 *
 * 本项目口径（业主 2026-11-22 第二轮调整）：
 *   1) **圆心 = 闪断预警条的中心**（业主：「从闪断条的位置出现然后对外扩散」）——
 *      这正是 ClassIsland 取「通知自身 CenterPoint」的同一套逻辑，比屏幕中心更合理：
 *      玩家的注意力先被条吸住，波纹就从那里铺开；
 *   2) 直径按**实测算的距离**给（圆心到四角最远者 × 2，向上取整），不再写死 vmax ——
 *      条在最顶上，竖屏/超宽屏下写死的比例会露出角落；
 *   3) 不透明度拉高（业主：「不透明度高一点」）：填充改纯色，且开头保持全不透明一小段再淡出；
 *   4) 颜色固定红（我们这条预警本来就该是红的；ClassIsland 用的是通知色）。
 * 另外除了「出现」播一次，进入最后 10 秒再补一次 —— 那才是玩家真正要抬头的时候。
 */
function FlashRipple() {
  const w = useStore((s) => s.flashWarn);
  const until = w && w.until ? Number(w.until) : 0;
  // 每次要播就换一个新 id：<i key> 变化时 Preact 会重挂这个节点，CSS 动画自然从头开始
  const [burst, setBurst] = useState(null);
  useEffect(() => {
    if (!until) return undefined;
    const fire = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // 圆心：预警条的中心。条由 FlashWarnBar 渲染（data-testid="flash-warn"），它可能还在入场动画里，
      // 但 getBoundingClientRect 取的是**变换后**的位置，正好就是玩家此刻看到的位置。
      let x = vw / 2;
      let y = 0;
      try {
        const bar = document.querySelector('[data-testid="flash-warn"]');
        const r = bar && bar.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) { x = r.left + r.width / 2; y = r.top + r.height / 2; }
      } catch { /* 量不到就退回屏幕正上方中点 */ }
      // 半径 = 圆心到四个角最远的那个（ClassIsland 的 EllipseSize 就是这么来的），向上取整
      const radius = Math.ceil(Math.max(
        Math.hypot(x, y), Math.hypot(vw - x, y), Math.hypot(x, vh - y), Math.hypot(vw - x, vh - y),
      ));
      setBurst({ id: `${until}:${Date.now()}`, x, y, size: radius * 2 });
    };
    fire();
    // 最后 10 秒再强调一次（已经进最后 10 秒了就不补）
    const ms = until - 10_000 - Date.now();
    if (ms <= 0) return undefined;
    const id = setTimeout(fire, ms);
    return () => clearTimeout(id);
  }, [until]);
  if (!burst || !until) return null;
  const { x, y, size } = burst;
  // 用负 margin 把圆盘的中心对到 (x, y)：动画只动 transform: scale()，不用 transform 做定位，
  // 这样缓动曲线和 ClassIsland 完全一致（缩放从 0 起，不掺平移）
  const style = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;margin-left:${-size / 2}px;margin-top:${-size / 2}px`;
  return html`<div class="flashripple" aria-hidden="true"><i key=${burst.id} class="flashripple__disc" style=${style}></i></div>`;
}

function App() {
  const route = useStore(selectRoute);
  const combatActive = useStore((s) => selectRoute(s) === 'game' && s.room?.inMatch === true
    && !s.match?.result && isCombatPhase(s.match?.public?.phase));
  const fullscreenWakeLock = useStore((s) => s.fullscreenWakeLock, Object.is, settingsStore);
  const fullscreenActive = useFullscreen();
  useScreenWakeLock(combatActive || (fullscreenWakeLock && fullscreenActive));
  useLang(); // a language switch re-renders the whole tree in place
  const [error, resetError] = useErrorBoundary((err) => console.error('[ui] screen crashed', err));
  const Screen = SCREENS[route] || LobbyScreen;
  const notice = useStore((s) => s.notice);
  // 好友入口：标题页用右上角那颗（title.js），其他界面用这个悬浮入口；房间里有房间号就能直接邀请好友
  const account = useStore((s) => s.account);
  const roomCode = useStore((s) => s.room?.code || null);
  return html`<div class=${`app-root${hasNotice(notice) ? ' has-notice' : ''}`}>
    <div class="app-bg" aria-hidden="true"></div>
    ${error ? html`<${ScreenCrashed} error=${error} reset=${resetError} />` : html`<${Screen} key=${route} />`}
    ${account && route !== 'title' ? html`<div class="social-dock"><${SocialButton} roomCode=${roomCode} /></div>` : null}
    <${NoticeBar} />
    <${TrustedNotice} />
    <${ConnectionBanner} />
    <${FlashWarnBar} />
    <${FlashRipple} />
    <${ToastHost} />
    <${ErrorDialogHost} />
    <${UiHosts} />
    <${GuideHost} />
    <${LoadoutHost} />
    <${StatsHost} />
    <${VoteOverOverlays} />
    <div class="server-watermark" aria-hidden="true">${SERVER_WATERMARK}</div>
  </div>`;
}

/** The room's version vote above 干员调配 / 统计数据 while one covers the room (ui/versionVote.js CoveredVersionVote). */
function VoteOverOverlays() {
  const lo = useStore((s) => !!s.open, Object.is, loadoutStore);
  const st = useStatsOpen();
  return html`<${CoveredVersionVote} covered=${lo || st} />`;
}

// ---- boot -----------------------------------------------------------------------------------------

async function waitForFonts(ms) {
  const fonts = document.fonts;
  if (!fonts || typeof fonts.load !== 'function') return;
  const loads = [
    fonts.load('900 1em "Noto Sans SC"', '卫戍协议盟约'), // i18n-ignore (font sample)
    fonts.load('700 1em "Noto Sans SC"', '开始'), // i18n-ignore (font sample)
    fonts.load('700 1em Bender', '0123456789'),
    fonts.load('700 1em Rajdhani', '0123456789'),
  ].map((p) => p.catch(() => null));
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, ms))]);
}

function installGlobalErrorHandlers() {
  window.addEventListener('unhandledrejection', (ev) => {
    const err = ev.reason;
    // Media autoplay/abort rejections (audio.play() before a user gesture, interrupted loads) are
    // expected browser behaviour, not app errors: log quietly, never toast.
    if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) { console.warn('[app] ignored rejection', err.name); return; }
    console.error('[app] unhandled rejection', err);
    recordError('rejection', err);
    if (err instanceof NetError) toastError(err);
    else toast(t('发生意外错误：{error}', { error: describeError(err) }).slice(0, 120), 'error');
  });
  window.addEventListener('error', (ev) => {
    if (!(ev instanceof ErrorEvent)) return; // resource load errors are not script errors
    console.error('[app] uncaught error', ev.error || ev.message);
    recordError('error', ev.error || ev.message, ev.error ? null : `${ev.filename || '?'}:${ev.lineno || 0}:${ev.colno || 0}`);
    // 安卓外壳的黑屏看门狗与诊断弹窗靠这个知道「页面到底有没有起来」：崩了也要把错误报过去（但不说自己画了帧）。
    reportClientState({ error: String((ev.error && ev.error.message) || ev.message || 'unknown').slice(0, 200) });
  });
}

/**
 * 账号系统（账号系统第一期）：查询登录态，但**不再整屏拦截** —— 未登录时标题页的「开始」卡里就是登录/注册表单
 * （screens/title.js 的 AuthCard，业主 2026-11-14 口径「登录直接长在标题页上」）。
 * 服务器没挂账号 API（SP_ACCOUNTS=off → /api/account/me 404）时 accountsEnabled=false：行为与没有账号系统时一致。
 * 其它失败（连不上服务器 / 超时）按「已启用账号」处理：标题页显示登录表单，登录时会把错误原样报给玩家。
 * @returns {Promise<{ account: any | null, accountsEnabled: boolean }>}
 */
function loadAccount() {
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 4000));
  const req = accountApi.me()
    .then((res) => ({ account: (res && res.account) || null }))
    .catch((e) => ({ error: e }));
  return Promise.race([req, timeout]).then((r) => {
    if (r && r.error) {
      if (r.error.code === 'E_NOT_FOUND' || r.error.status === 404) return { account: null, accountsEnabled: false };
      console.warn('[account] 登录态查询失败，按已启用账号处理', r.error && r.error.message);
      return { account: null, accountsEnabled: true };
    }
    if (r && r.timedOut) {
      console.warn('[account] 登录态查询超时，按已启用账号处理');
      return { account: null, accountsEnabled: true };
    }
    return { account: r.account, accountsEnabled: true };
  });
}

async function boot() {
  installGlobalErrorHandlers();
  // 错误报告弹窗 (ui/errorDialog.js): classify the error, show the related log lines, point to the QQ group
  installErrorReporter();
  // what this page downloads, by category, for the 问题反馈 report's traffic line (diag.js; nothing is sent anywhere)
  installTrafficMeter();
  // touch / hover / fullscreen classes, zoom-gesture blocking, rotation re-layout (ui/device.js, css/devices.css)
  installDeviceSupport();
  // F11 全屏（业主 2026-11-21）：WebView2 内嵌宿主不触发浏览器自带的 F11，由页面自己接管；浏览器里不动
  installFullscreenHotkey();
  // Hashed art a player imported. HTTPS or localhost only; a failure here must not stop boot.
  void registerImportedAssetWorker();
  // A page restored from the back/forward cache has a dead socket and a stale token choice: start over.
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) location.reload(); });
  // Pick this tab's reconnect token (asks other live tabs; ≤150 ms) while fonts load.
  const identityReady = identity.init();

  // 账号系统（账号系统第一期）：先查登录态（登录卡长在标题页上，不整屏挡）；未登录时 boot 不连 WebSocket ——
  // 服务端 requireAccount 会拒绝未登录握手（AUTH_REQUIRED），登录成功后由标题页的登录卡触发连接。
  const { account, accountsEnabled } = await loadAccount();

  const pendingJoin = parseRoomParam(location.search);
  // 登录后昵称以账号为准（昵称#tag 是公开身份）；没登录时沿用本机记住的代号。
  const savedName = (account ? sanitizeName(account.nickname) : '') || sanitizeName(identity.loadName()) || '';
  // 启动时不跳过登录页：只有同一页面的「刷新」才沿用已进入状态；新打开/重新启动一律先回标题页。
  // 有账号系统时还必须真的登录着（账号被登出/会话过期后刷新回到登录卡）。
  const navType = (() => { try { return performance.getEntriesByType?.('navigation')?.[0]?.type || 'navigate'; } catch { return 'navigate'; } })();
  const entered = navType === 'reload' && identity.wasEntered() && !!savedName
    && (!accountsEnabled || !!account);
  store.set((s) => ({
    ...s,
    account: account || null,
    accountsEnabled,
    me: { ...s.me, name: savedName },
    session: { entered },
    ui: { ...s.ui, pendingJoin },
  }));

  wireNet();
  // 云存档（账号系统）：首次登录把本地战绩/调配/皮肤/名片/设置合并进账号，之后节流回写
  if (account) {
    try { installCloudSave({ api: accountApi, onError: (e) => console.warn('[cloudSave] 同步失败', e && e.message) }); }
    catch (err) { console.warn('[cloudSave] 安装失败', err); }
    // 好友邀请浮层：注册一次，之后任何界面收到 social.invite 都会弹
    try { installSocialInvites(); } catch (err) { console.warn('[social] 邀请浮层安装失败', err); }
  // 全局「消息」入口（业主 2026-11-21）：主页/大厅/等待室都在，只在对局内与拓展选择界面隐藏
  try { installMessageCenter(); } catch (err) { console.warn('[messages] 入口安装失败', err); }
  // 好友红点（业主 2026-11-14）：房间里/顶栏的好友入口显示待处理请求数
  import('./ui/friends.js').then((m) => { try { m.installSocialBadges(); } catch (e) { console.warn('[social] 红点安装失败', e); } }, () => {});
  }
  // 全服公告弹窗（业主 2026-11-21）：每次连接弹一次，内容在后台「公告」卡片里改。
  // 2026-11-22：**移到 `if (account)` 之外** —— 公告是全服的，未登录/只用代号的玩家也必须看到，
  // 紧急公告还要能在对局中插播。原来放在账号块里，等于这批玩家从来收不到公告（实测发现的）。
  void installAnnouncementPopup();
  installStatsRecorder(store); // follows the match on screen, so a 放弃模拟 can be recorded (ui/stats.js)
  // the loadout / 干员持有 / 自选 settings by operator, shown for the data on screen (DESIGN §35.23; a v1 store migrates)
  installSettingsViews();
  installLoadoutSync({ net });
  installOwnershipSync({ net });
  installDiySync({ net });
  // 干员皮肤 (docs/SKINS.md): keeps the server's copy of this browser's chosen appearances current (room.skins), from
  // ui/skins.js' own store — its 皮肤 section is rendered by screens/loadout.js.
  installSkinsSync({ net });
  // 名片干员 (PR #643 split 6): the operator on this browser's seat card (room.card, ui/seatArt.js cardStore) — after every
  // welcome, pick and content change, with the engine's retries (the room screen only reads and sets the pick)
  installCardSync({ net });
  // the room's cosmetic plugins and the player's own over the art manifest (content.js; nothing is fetched without them)
  installContent({ toast });
  // a room with gameplay plugins: its content set downloaded, checked and shown (content.js — DESIGN §32.6)
  installContentSet({ toast });
  // A bot prep's layout rehearsal the server offers this host's browser (DESIGN §14, SP_BOT_REHEARSAL=host on the
  // server): a same-origin module Worker simulates the candidates off the main thread and answers with its pick; a
  // browser that cannot run one answers `error` and the server rehearses itself. Nothing happens while the server
  // does not delegate. A gameplay-plugin room is never offered (the server keeps that rehearsal).
  rehearsal = installRehearsal({ net });
  net.attachBrowserHooks();
  // Audio: unlock on first gesture, BGM follows the route / match phase (js/audio.js).
  // a cosmetic plugin's sound that will not load falls back like its art (content.js, DESIGN §32 P1a)
  installAudio({ getManifest: () => data.get('assets'), subscribe: store.subscribe, getState: store.get, selectRoute, settings: settingsStore.get(),
    getSkinVoices: () => data.get('skinVoices'),
    getSkin: (charId) => skinsStore.get()?.[SKINS_KEY]?.[charId] || null,
    onFailed: (url) => cosmetics.fail(url) });
  // …and the music follows the art: the screen's track again when the cosmetic layers change its URLs
  cosmetics.subscribe(() => audio.refreshBgm());
  // 自定义大厅背景与音乐 (ui/lobbyMedia.js): the player's own files of this browser, the music from the title on
  installLobbyMedia();
  data.load('assets').then(() => audio.refreshBgm()).catch(() => {});
  // 皮肤专属语音 (data/skin-voices.json): loaded with the art so the first voice of a worn outfit already has it
  data.load('skinVoices').catch(() => {});
  // Warm the data cache in the background (missing files are tolerated).
  data.loadAll('config').catch(() => {});
  // Optional local-client art manifest (emotes, tutorial pages, official UI sprites; DESIGN §13).
  data.load('local').catch(() => {});

  const connectWhenReady = identityReady.then(() => {
    // 账号系统：未登录不连（服务端会以 AUTH_REQUIRED 拒绝握手）；登录成功后由标题页的登录卡 net.connect()。
    if (accountsEnabled && !account) return;
    if (entered) net.setName(savedName);
    else net.connect();
  });
  // the language (and its UI translations) before the first render: no Chinese flash for an English player
  const langReady = initLang().catch((err) => console.warn('[app] language setup failed', err));
  await Promise.all([waitForFonts(1200), connectWhenReady, langReady]);
  const root = document.getElementById('app');
  render(html`<${App} />`, root);
  // 开场动画（旧版 Fusion 的进场演出）：每次打开页面先播一次「卫戍协议：联盟」入场，可点击/按键跳过
  try { playLobbyIntro(); } catch (err) { console.warn('[intro] the opening did not start', err); }

  const splash = document.getElementById('boot');
  if (splash) {
    splash.classList.add('is-done');
    setTimeout(() => splash.remove(), 300);
  }
  globalThis.__SP__ = { store, net, data, version: 1 };
  // 「已在绘制」: two frames after the first render. The second rAF callback only runs once a frame carrying the routed
  // screen has actually been produced — a single rAF would also resolve when render() merely returned.
  requestAnimationFrame(() => requestAnimationFrame(() => reportClientState({ painted: true })));
  // A page keeps the modules it imported at load time for its whole lifetime, so a deploy cannot reach an open tab
  // (ui/buildGuard.js): watch `/healthz.build`. Outside a match the page reloads itself; during a match the guard says
  // so instead (the connection banner offers 刷新页面) and reloads once the match — settlement screen included — is over,
  // so a running game is never thrown away.
  try {
    startBuildGuard({
      inMatch: () => selectRoute(store.get()) === 'game',
      onStale: ({ waiting }) => { if (waiting) store.patch('ui', { buildStale: true }); },
      // the same /healthz names how many plugins the server has: the title screen shows it before any hello
      onHealth: (h) => {
        const n = pluginCount(h.content), notices = h.content?.notices === true;
        if (n !== store.get().installedPlugins || notices !== store.get().installedNotices) store.set({ installedPlugins: n, installedNotices: notices });
        // 资源密钥没拿到就弹提示（业主 2026-11-15）：/healthz.artKey === 'missing' 时加密资源会破图
        updateArtKeyNotice(h.artKey);
      },
    });
  } catch (err) {
    console.warn('[app] build guard failed to start', err);
  }
}

boot().catch((err) => {
  console.error('[app] boot failed', err);
  const el = document.getElementById('boot-err');
  if (el) el.textContent = t('启动失败，请刷新页面重试');
});
