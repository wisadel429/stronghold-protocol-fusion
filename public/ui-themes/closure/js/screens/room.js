import {roomSquadLabel} from '/js/ui/squadLabel-20261024.js';
import {BossHpOption} from '/js/ui/bossHpOption-20261024.js';
import {publicRoomCode} from '/shared/unifiedRegion-20261024.js';
import { useRosterScroll } from '/js/ui/rosterScroll.js';
import { reversePolicyLabel } from '/js/ui/roomPolicy.js';
import { useAccount, useCurrentAccount, AccountTag, AccountName } from '/js/ui/accounts.js';
import { TrophyBadge } from '/js/ui/trophies.js';
import { isOwnerName, decorateOwnerName } from '/js/ui/ownerName.js';
import { enabled as federationEnabled, regionMatching, currentNode } from '/js/federation.js';
import { shareBase } from '/js/ui/shareLink.js';
// Room screen (同盟等待室). 2026-10-13 (the owner's request: the event's room, video 5:22–6:29): tall seat cards side by
// side — a portrait per doctor (名片干员: the player's own pick — room.card, room.state seats[].card; one's own screen shows
// it at once, the others once the server takes room.card — else an operator chosen from the player id), 创建者, 已就绪 / 准备中
// / 失去信号, the name plate with the account avatar and #tag, the host's 移出; an empty seat is 邀请 (copies the
// alliance key) or, while searching, a waiting glyph. Top: leave, the time waited, latency, 统计 / 设置 / 玩法说明, the
// alliance key with 复制 / 链接. Bottom: 干员调配, the status line, the 精确搜寻 | difficulty | ⚙ pill (the host picks the
// difficulty in 选择模拟协议 over the room and keeps 私密房间 / 人数上限 / AI 队友最后选择 / 无限火力 branch under ⚙),
// 开始搜寻 and 开始模拟 (host) or 准备就绪. 开始搜寻 runs the server's room queue (match.queue: same mode and
// difficulty) and keeps it running until stopped or full (the server ends a room's turn after 10 s without bots: the
// host's client queues again); everybody sees 搜寻中 (ui/matchFlow.js), then 搜寻成功 when the seats fill or a player
// arrives through match.found. 人数上限 only shows when shared/constants.js allows more than DEFAULT_SEATS.
// Motion (the event's, css tr-*): the room comes up from black card by card and fades out when left; a doctor turning
// 已就绪 flashes green; 选择模拟协议, ⚙, 搜寻中 and 搜寻成功 stay mounted while they fade out (ui/transitions.js).
//
// Start rule (server/lobby.js): room.start needs every *other* human connected and ready; the
// host's start counts as the host's ready. So 开始模拟 is enabled exactly then and sends room.start
// alone (no separate room.ready round trip that could leave the host "ready" after a failed start).
// Solo rooms show a single seat.
// Spectator seats (community report #26, a remake feature): a co-op room with spectators shows the 观战席 strip under
// the seats — names, offline marks, the host's ✕ (room.removeSpectator) — and a spectator's own view swaps the ready
// button for 观战中 and offers 入座 (room.join of the room) while a player seat is free.
// Plugins (DESIGN §32 P1a): the tag under the title — 「原版」 or 「插件 ×N」 — opens the 插件 panel (ui/pluginPanel.js:
// the host switches the room's plugins, everybody else reads them). With gameplay plugins (§32.6: a content set of its
// own — the tag reads 「非官方」 too) every seat shows whether its page has loaded and checked the room's content
// (seats[].content: 载入中 / 就绪 / 校验失败), 准备就绪 and 开始模拟 wait for it (the server refuses them before:
// CONTENT_NOT_READY), and a plugin mode the host chose shows beside the difficulty.
// Texts go through t() (docs/I18N.md).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from '/vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS, difficultyName, difficultyTheme, MAX_SPECTATORS } from '/shared/constants.js';
// 业主 2026-11-15：炸惊 / 湮灭这类「小玩法」的难度由玩法本身决定，不允许再切（切了会出严重 bug）
import { ZHAJING_DIFFICULTY } from '/shared/zhajing-constants.js';
import { ANNIHILATION_DIFFICULTY } from '/shared/annihilation-constants.js';
// seat counts through the namespace: the live constants (before the 10-seat package) have MAX_SEATS 4 and no DEFAULT_SEATS
import * as SEAT_CONST from '/shared/constants.js';
import { RANDOM_MODE, RANDOM_MODE_NAME } from '/shared/randomMode.js';
import {
  html, Button, Icon, PingPill, MicroLabel, AvatarFrame, DifficultyIcon, Tooltip, confirmDialog, doctorNo, Spinner, Modal,
} from '/js/ui/components.js';
import { toast, toastError } from '/js/ui/toasts.js';
import { copyText } from '/js/ui/clipboard.js';
import { GuideButton } from '/js/ui/guide.js';
import { openStats } from '/js/screens/stats.js';
import { AddFriendButton, openFriends, openInviteDrawer } from '/js/ui/friends.js';
import { NameCardLayer } from '/js/ui/namecards.js';
import { SettingsButton } from '/js/ui/settings.js';
import { LoadoutButton } from '/js/screens/loadout.js';
import { PluginTag, isModdedRoom } from '/js/ui/pluginTag.js';
import { hasScriptConsent, rememberScriptConsent } from '/js/content.js';
import { net } from '/js/net.js';
import { store, useStore, shallowEqual, emptyMatch, isSpectating, serverNow, loadPref, savePref } from '/js/store.js';
import { data, useData } from '/js/data.js';
import { chessAvatarUrl, chessPortraitUrl } from '/js/ui/assetUrls.js';
import { CARD_PREF, cardOperators, seatPortrait } from '/js/ui/seatArt.js';
import { C2S } from '/shared/protocol.js';
import { availableDifficulties, difficultyInfo, ProtoCard } from '/js/screens/lobby.js';
import { ProtocolScene } from '/js/ui/protocolScene.js';
import { SearchPanel, FoundPanel } from '/js/ui/matchFlow.js';
import { usePresence, useRise, afterLeave } from '/js/ui/transitions.js';
import { CrisisTagStrip } from '/js/ui/crisisTags.js';
import { VersionPicker } from '/js/ui/versionPicker.js';
import { VersionVote, versionVoteOf } from '/js/ui/versionVote.js';
import { DEFAULT_VERSION, roomVersion, versionLabel, needsContent } from '/js/versions.js';
import { t, tc } from '/shared/i18n.js';

const MAX_SEATS = Number(SEAT_CONST.MAX_SEATS) || 4;
const DEFAULT_SEATS = Number(SEAT_CONST.DEFAULT_SEATS) || MAX_SEATS;

/**
 * Seats padded to the room's capacity (co-op 4, solo 1), each null or a seat record.
 * @param {any} room room.state payload
 * @returns {(null | {seat:number, playerId:any, name:string, isBot:boolean, ready:boolean, connected:boolean})[]}
 */
export function normalizeSeats(room) {
  const src = Array.isArray(room?.seats) ? room.seats : [];
  // Display every server-provided seat, including rooms created by higher-capacity content sets.
  const cap = room?.mode === 'solo' ? 1 : Math.min(64, Math.max(DEFAULT_SEATS, Math.floor(Number(room?.maxSeats)) || 0, src.length));
  const out = [];
  for (let i = 0; i < cap; i++) {
    const s = src[i];
    out.push(s && typeof s === 'object' ? { ...s, seat: Number.isInteger(s.seat) ? s.seat : i } : null);
  }
  return out;
}

/**
 * Derived room facts for the local player.
 * @param {any} room
 * @param {any} myId
 */
export function roomFacts(room, myId) {
  const seats = normalizeSeats(room);
  const occupied = seats.filter(Boolean);
  const humans = occupied.filter((s) => !s.isBot);
  const mine = occupied.find((s) => s.playerId === myId) || null;
  const isHost = room?.hostId != null && room.hostId === myId;
  const others = humans.filter((s) => s.playerId !== myId);
  // The host never readies: starting the match is the host's ready (server rule), so the count
  // treats the host as ready — "已就绪 0/1" next to "准许进入模拟" would contradict itself.
  const isReady = (s) => !!s.ready || s.playerId === room?.hostId;
  const readyHumans = humans.filter(isReady).length;
  const othersReady = others.every((s) => s.ready && s.connected !== false);
  // a room with gameplay plugins (DESIGN §32.6): every player's page has loaded and checked its content (the host's too)
  const modded = isModdedRoom(room);
  const loadsContent = needsContent(room);
  const contentReady = !loadsContent || humans.every((s) => s.content === 'ready');
  // a 四人 危机合约 starts with every seat taken, doctors or AI (server/lobby.js start; shared/crisis.js CRISIS_QUAD_SEATS)
  const crisisShort = room?.crisis?.mode === 'quad' ? Math.max(0, 4 - occupied.length) : 0;
  return {
    seats, occupied, humans, mine, isHost, readyHumans, isReady,
    emptySeats: seats.filter((s) => !s).length,
    crisisShort,
    canStart: isHost && othersReady && !!mine && contentReady && !crisisShort && !versionVoteOf(room) && (!room?.content?.trusted || humans.every(s => room.content.trusted.consent[s.seat])),
    othersReady,
    modded,
    needsContent: loadsContent,
    versionRoom: loadsContent && !modded,
    contentReady,
    myContent: loadsContent ? (mine?.content || 'loading') : 'ready',
    // spectator seats (never players: not in `humans`, never counted for ready / start)
    spectators: Array.isArray(room?.spectators) ? room.spectators.filter((s) => s && typeof s === 'object') : [],
    spectating: isSpectating(room, myId),
  };
}

/**
 * The co-op room option 「AI 队友最后选择」 (GitHub #338; room.setAiPicksLast, room.state.aiPicksLast): in the strategy and
 * 机变 drafts every human picks before the AI teammates. null in a solo room (no AI teammates); otherwise its state (off
 * when the server sends none) and whether this player may switch it — the host only, the others see it read-only.
 * @param {any} room room.state payload
 * @param {any} myId
 * @returns {{ on: boolean, editable: boolean } | null}
 */
export function aiLastOption(room, myId) {
  if (!room || room.mode === 'solo') return null;
  return { on: room.aiPicksLast === true, editable: room.hostId != null && room.hostId === myId };
}

export function aiTakeoverOption(room, myId) {
  if (!room || room.mode === 'solo' || roomVersion(room) !== DEFAULT_VERSION || room.content?.vanilla === false) return null;
  return { on: room.aiTakeoverEnabled === true, editable: room.hostId != null && room.hostId === myId && !room.inMatch };
}

/**
 * Invite link for a room code.
 *
 * 业主 2026-11-21：「复制房间链接的主链接头改为 mon3tr.fun」，并且**不要**把对方带进
 * 主题页（ui-theme-closure.html 之类）。所以公网入口一律给 `https://mon3tr.fun/?room=CODE`，
 * 本机 / 局域网调试才保留当前页面地址（否则本地开的房间会指向公网服务器）。
 */
export function inviteLink(code) {
  return `${shareBase()}?room=${encodeURIComponent(federationEnabled?publicRoomCode(currentNode(),code):code)}${federationEnabled ? '&node='+currentNode() : ''}`;
}

/**
 * Copy text to the clipboard (async API with a textarea fallback for insecure contexts). Moved to ui/clipboard.js so
 * 干员调配 can use it without importing this screen (which imports loadout.js): re-exported here for existing callers.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export { copyText };

// 名片干员 portraits (the pick, else one chosen by the player id): ui/seatArt.js, shared with the strategy draft's rows
export { CARD_PREF, cardOperators, seatPortrait };
/** The server takes room.card (shared/protocol.js of the 10-seat package on): teammates then see one's pick. */
export const CARD_SYNC = !!C2S && Object.hasOwn(C2S, 'room.card');
// what else the server offers (its own shared/protocol.js): 开始搜寻 needs match.queue, 私密房间 room.setPrivate
const CAN_QUEUE = !!C2S && Object.hasOwn(C2S, 'match.queue');
// 房间「开启测试」（服主 2026-11-03）：单人随时开关；多人投票，至少 3 票（不足 3 人要全员同意）
if (C2S && !Object.hasOwn(C2S, 'room.testVote')) C2S['room.testVote'] = { on: (v) => typeof v === 'boolean' };
if (typeof document !== 'undefined' && !document.getElementById('rs-test-style')) {
  const st = document.createElement('style');
  st.id = 'rs-test-style';
  st.textContent = `.rs-test-row { display: flex; align-items: center; gap: .14rem; }
.rs-test { display: inline-flex; align-items: center; gap: .08rem; height: max(.56rem, 34px); padding: 0 .22rem; font: inherit; font-size: max(.2rem, 13px); font-weight: 700;
  color: #e9eceb; background: rgba(14, 15, 15, .92); border: 1px solid rgba(255, 255, 255, .14); border-radius: 999px; box-shadow: 0 .04rem .16rem rgba(0, 0, 0, .5); cursor: pointer; white-space: nowrap; }
.rs-test:hover:not(:disabled) { filter: brightness(1.2); }
.rs-test:disabled { cursor: default; opacity: .6; }
.rs-test__dot { width: .5em; height: .5em; border-radius: 50%; background: #6b716f; }
.rs-test.is-on { color: #f5c451; border-color: rgba(245, 196, 81, .6); }
.rs-test.is-on .rs-test__dot { background: #f5c451; box-shadow: 0 0 6px #f5c451; }
.rs-test.is-voted { background: rgba(79, 232, 192, .16); border-color: rgba(79, 232, 192, .6); }
.rs-test__n { font-variant-numeric: tabular-nums; color: #9aa19e; }
.rs-test small { font-size: .85em; font-weight: 400; color: #9aa19e; }`;
  document.head.appendChild(st);
}
function TestVoteButton({ room, facts, myId, busy, online, onVote }) {
  if (!room || room.testVoteSupported !== true || room.test === true || room.crisis || facts.modded || facts.spectating || room.inMatch) return null;
  const on = room.voteTest === true;
  const tv = room.testVote || { votes: 0, need: 1, voters: [] };
  const vote = (tv.need | 0) > 1;
  const mine = vote && Array.isArray(tv.voters) && tv.voters.includes(myId);
  const title = !vote ? (on ? '测试模式已开启：无限资金、木桩敌人、改盟约层数，结算不计奖励和排行。点击关闭' : '开启测试模式：无限资金、木桩敌人、改盟约层数，结算不计奖励和排行')
    : mine ? '你已投票，再点一次撤回' : `需要 ${tv.need} 票${on ? '关闭' : '开启'}测试模式`;
  return html`<button type="button" class=${`rs-test${on ? ' is-on' : ''}${mine ? ' is-voted' : ''}`} data-testid="room-test-vote" aria-pressed=${on ? 'true' : 'false'}
    disabled=${!!busy || !online} title=${title} onClick=${() => onVote(!on)}>
    <span class="rs-test__dot" aria-hidden="true"></span><span>${on ? '关闭测试' : '开启测试'}</span>${vote ? html`<span class="rs-test__n">${mine ? '已投 ' : ''}${tv.votes | 0}/${tv.need | 0}</span>` : null}${on ? html`<small>测试中</small>` : null}</button>`;
}
const CAN_PRIVATE = !!C2S && Object.hasOwn(C2S, 'room.setPrivate');


/** 名片干员 picker: search, rarity, the operators' avatars; 默认 clears the pick. */
function CardPicker({ current, list, m, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [star, setStar] = useState(0);
  const needle = q.trim().toLowerCase();
  const shown = list.filter((c) => (!star || c.rarity === star) && (!needle || String(c.name || '').toLowerCase().includes(needle)
    || String(c.appellation || '').toLowerCase().includes(needle)));
  return html`<${Modal} open=${true} title=${t('名片干员')} micro="SEAT CARD" onClose=${onClose} width="min(9.6rem, 94vw)" class="cardpick">
    <div class="cardpick__bar">
      <label class="cardpick__search"><${Icon} name="search" /><input type="search" value=${q} placeholder=${t('搜索干员')} onInput=${(e) => setQ(e.currentTarget.value)} /></label>
      <div class="cardpick__stars" role="radiogroup" aria-label=${t('稀有度')}>
        ${[[0, t('全部')], [6, '6★'], [5, '5★'], [4, '4★']].map(([v, label]) => html`<button key=${v} type="button" role="radio" aria-checked=${star === v ? 'true' : 'false'}
          class=${star === v ? 'is-on' : ''} onClick=${() => setStar(v)}>${label}</button>`)}
      </div>
    </div>
    <div class="cardpick__grid">
      <button type="button" class=${`cardpick__op cardpick__op--auto${!current ? ' is-on' : ''}`} onClick=${() => onPick('')} title=${t('按博士编号自动分配')}>
        <span class="cardpick__img"><${Icon} name="refresh" /></span><span class="cardpick__name">${t('默认')}</span></button>
      ${shown.map((c) => html`<button key=${c.charId} type="button" class=${`cardpick__op${current === c.charId ? ' is-on' : ''}`} onClick=${() => onPick(c.charId)} title=${c.name}>
        <span class="cardpick__img"><img src=${chessAvatarUrl(m, c)} alt="" loading="lazy" draggable=${false} /></span>
        <span class="cardpick__name">${c.name}</span>${c.rarity ? html`<span class=${`cardpick__star r${c.rarity}`}>${c.rarity}★</span>` : null}</button>`)}
    </div>
    <p class="cardpick__note"><${Icon} name="info" />${CARD_SYNC ? t('选择后，同盟里的博士都会看到这张立绘') : t('目前只有你自己看得到；服务器下次更新后，同盟里的其他博士也能看到你的选择')}</p>
  <//>`;
}

/**
 * 座位上的账号头像 URL（业主 2026-11-15「等待界面不加载头像」）：账号头像＝**干员立绘**，
 * 按 seats[].avatarId（charId）+ avatarSkin 到 data/assets.json 取图，取不到才退回首字。
 * accounts.js 的 `avatar` 字段已固定为 null，直接拿它只会画昵称首字。
 */
function seatAvatarUrl(seat, isMe, myAccount) {
  if (!seat || seat.isBot) return null;
  const charId = seat.avatarId || (isMe ? myAccount?.avatarId : null) || null;
  if (!charId) return null;
  const list = data.list('chess') || [];
  const chess = list.find((c) => c && c.charId === charId && !c.isDiy);
  if (!chess) return null;
  const m = data.get('assets');
  const skin = seat.avatarSkin || (isMe ? myAccount?.avatarSkin : null) || null;
  return chessAvatarUrl(m, chess, { skin }) || chessPortraitUrl(m, chess, { skin }) || null;
}

function SeatCard({ seat, index, room, facts, myId, busy, onKick, onInvite, onAddBot, onRemoveBot, searching, portraits, onPickCard = null }) {
  const seatAccount = useAccount(seat && !seat.isBot ? seat.playerId : null);
  // 账号头像（业主 2026-11-15「等待界面不加载头像」）：要按 avatarId 取干员立绘，数据到了要能重画。
  useData('chess', 'assets');
  const { me: myAccount } = useCurrentAccount();
  const [bad, setBad] = useState(null);
  const flash = useRise(!!seat && (seat.ready || seat.isBot || seat.playerId === room.hostId));
  if (!seat) {
    const invitable = room.mode !== 'solo' && !facts.spectating;
    return html`<article class=${`rseat rseat--empty${searching ? ' is-searching' : ''}`} style=${`--i:${index}`}>
      <span class="rseat__clip" aria-hidden="true"></span>
      <header class="rseat__strip"><i></i><span class="num">P${index + 1}</span></header>
      <div class="rseat__art">
        ${searching
          ? html`<span class="rseat__wait"><svg viewBox="0 0 40 48" aria-hidden="true"><path d="M20 2l5 5-5 5-5-5z" /><rect x="10" y="16" width="14" height="22" rx="3" /><path d="M24 22h10l-4 7 4 7H24" /></svg><small>STRONGHOLD PROTOCOL</small></span>`
          : invitable
            ? html`<button type="button" class="rseat__invite" onClick=${onInvite} title=${t('邀请在线好友，或复制同盟密钥')}>
                <span class="rseat__plus" aria-hidden="true"></span><b>${t('邀请')}</b><small>${t('邀请在线好友，或复制同盟密钥')}</small></button>`
            : html`<span class="rseat__wait"><small>${t('等待博士加入')}</small></span>`}
        <span class="rseat__noinfo" aria-hidden="true">NOINFO</span>
      </div>
      <div class="rseat__plate rseat__plate--empty">
        ${facts.isHost && room.mode !== 'solo' ? html`<button type="button" class="rseat__addbot" disabled=${!!busy || searching}
          style="width:100%;min-height:30px;padding:6px 10px;color:#4fe8c0;background:#102d26;border:1px solid #397e6b;cursor:pointer"
          onClick=${onAddBot}>${t('添加机器人')}</button>` : null}
      </div>
    </article>`;
  }
  const groupLabel = roomSquadLabel(room, seat.playerId);
  const consent = room.content?.trusted?.consent?.[seat.seat];
  const isMe = seat.playerId === myId;
  const isHostSeat = seat.playerId === room.hostId;
  const offline = seat.connected === false && !seat.isBot;
  const ready = seat.ready || seat.isBot || isHostSeat;
  const src = seat.isBot ? null : seatPortrait(seat, portraits);
  const seatAvatar = seatAvatarUrl(seat, isMe, myAccount);
  // 名牌下的小字：编号只留给「没有账号 tag 可显示」的座位（别人的座位服务端不下发 tag，用 DOCTOR # 区分）；
  // 本人的座位名字后面已经有账号 tag（#1234），再排一个随机编号就变成「两个 tag」（业主 2026-11-15 要求清除）。
  const docText = seat.isBot ? 'AUTONOMOUS UNIT'
    : `${groupLabel ? groupLabel + ' · ' : ''}${isMe ? '' : `DOCTOR #${doctorNo(seat.playerId)}`}`;
  const owner = isOwnerName(seat.name);
  const canPick = isMe && !seat.isBot && !!onPickCard;
  return html`<article class=${`rseat${ready ? ' is-ready' : ''}${flash ? ' is-flash' : ''}${isMe ? ' is-me' : ''}${isHostSeat ? ' is-host' : ''}${offline ? ' is-offline' : ''}${seat.isBot ? ' is-bot' : ''}`}
      style=${`--i:${index}`}>
    <span class="rseat__clip" aria-hidden="true"></span>
    ${consent ? html`<span class="rseat__consent" data-testid="script-consented">${t('已同意')}</span>` : null}
    <header class="rseat__strip"><i></i>${groupLabel ? html`<b class="rseat__squad" style="position:absolute;left:50%;transform:translateX(-50%);font-size:max(.15rem,11px);color:inherit">${groupLabel}</b>` : null}<span class="num">P${index + 1}</span></header>
    <div class=${`rseat__art${canPick ? ' is-pickable' : ''}`} onClick=${canPick ? onPickCard : undefined} title=${canPick ? t('点击更换名片干员') : undefined}>
      ${src && bad !== src ? html`<img src=${src} alt="" draggable=${false} loading="lazy" onError=${() => setBad(src)} />`
        : html`<span class="rseat__glyph">${seat.isBot ? html`<${Icon} name="robot" />` : [...(seat.name || '?')][0]}</span>`}
      ${canPick ? html`<button type="button" class="rseat__pick" onClick=${(e) => { e.stopPropagation(); onPickCard(); }} aria-label=${t('更换名片干员')}><${Icon} name="edit" /><span>${t('更换立绘')}</span></button>` : null}
      ${isHostSeat ? html`<span class="rseat__host">${t('创建者')}</span>` : null}
      ${offline ? html`<span class="rseat__lost"><${Icon} name="wifiOff" />${t('失去信号')}</span>` : null}
      <span class="rseat__state">${ready
        ? html`<span class="rseat__box"><${Icon} name="check" /></span>${isHostSeat && !seat.ready ? t('待命中') : t('已就绪')}`
        : html`<span class="rseat__box"></span>${t('准备中')}`}</span>
    </div>
    ${seat.isBot && facts.isHost ? html`<button type="button" class="rseat__kick" disabled=${!!busy}
      onClick=${() => onRemoveBot(index)}>${t('移除机器人')}</button>` : null}
    ${!seat.isBot && !isMe && facts.isHost ? html`<button type="button" class="rseat__kick" disabled=${busy === `kick${index}`}
      onClick=${() => onKick(index, seat.name, seat.playerId)} title=${t('将该博士移出同盟')} aria-label=${t('移出该博士')}><${Icon} name="user" /><${Icon} name="close" /></button>` : null}
    ${facts.modded && !seat.isBot ? html`<span class=${`seat__content rseat__content is-${seat.content || 'loading'}`} data-testid="seat-content">
      ${seat.content === 'ready' ? t('插件内容就绪') : seat.content === 'failed' ? t('插件内容校验失败') : t('插件内容载入中')}
    </span>` : null}
    <div class=${`rseat__plate${seatAccount?.card ? ' has-nc' : ''}`}>
      <${NameCardLayer} card=${seatAccount?.card} />
      ${isMe ? html`<span class="rseat__me" title=${t('你')}><${Icon} name="info" /></span>` : null}
      <${AvatarFrame} size="sm" name=${seat.name} src=${seatAvatar || undefined} seat=${index} bot=${seat.isBot} self=${isMe} />
      <span class="rseat__who">
        <${TrophyBadge} count=${seatAccount?.trophies} class="tbadge--inline" /><${AccountName} profile=${seatAccount} name=${seat.name||t('博士')} className="rseat__name"/><${AccountTag} playerId=${seat.isBot ? null : seat.playerId} />
        
      </span>
      ${!isMe&&!seat.isBot?html`<${AddFriendButton} playerId=${seat.playerId} className="rseat__friend"/>`:null}
      ${docText ? html`<small class="rseat__doc">${docText}</small>` : null}
    </div>
  </article>`;
}

/** 观战席: the room's spectators (host: ✕ frees a seat), and 入座 for a spectator while a player seat is free. */
function SpectatorBar({ facts, myId, busy, onRemove, onSit }) {
  if (!facts.spectators.length) return null;
  return html`<section class="specbar" aria-label=${t('观战席')}>
    <span class="specbar__label"><${Icon} name="eye" />${t('观战席')}<b class="num">${facts.spectators.length}</b><span class="num t-dim">/${MAX_SPECTATORS}</span></span>
    ${facts.spectators.map((s) => html`<span key=${s.playerId} class=${`specbar__who${s.playerId === myId ? ' is-me' : ''}${s.connected === false ? ' is-offline' : ''}`}>
      ${s.connected === false ? html`<${Icon} name="wifiOff" />` : null}${s.name || t('博士')}${s.playerId === myId ? html`<span class="seat__you">${t('你')}</span>` : null}
      ${facts.isHost ? html`<${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `rs${s.playerId}`}
        onClick=${() => onRemove(s.playerId)} aria-label=${t('移出观战者 {name}', { name: s.name || '' })} title=${t('移出该观战者')} />` : null}
    </span>`)}
    ${facts.spectating && facts.emptySeats > 0 ? html`<${Button} size="sm" icon="user" loading=${busy === 'sit'} onClick=${onSit}>${t('入座')}<//>` : null}
  </section>`;
}

/** The 「AI 队友最后选择」 switch (co-op): the host toggles it, everybody else sees its state. */
function AiLastToggle({ option, busy, onToggle }) {
  if (!option) return null;
  return html`<div class="ailast">
    <${Tooltip} text=${t('策略与机变轮选时，所有博士先于 AI 队友选择')}>
      <button type="button" role="switch" aria-checked=${option.on ? 'true' : 'false'}
          class=${`dpick__opt ailast__opt${option.on ? ' is-active' : ''}`} disabled=${!option.editable || !!busy}
          onClick=${() => option.editable && onToggle(!option.on)}>
        <${Icon} name="check" class=${option.on ? 'is-on' : ''} />${t('AI 队友最后选择')}
      </button>
    <//>
    ${option.editable ? null : html`<span class="t-dim">${t('由创建者设置')}</span>`}
  </div>`;
}

/** mm:ss of a duration in seconds. */
const clock = (s) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, s)) % 60).padStart(2, '0')}`;

/** 选择模拟协议 over the room (host): the difficulty cards and 确认. */
function RoomProtocol({ room, variant, onClose, onPick, busy, leaving = false }) {
  const [pick, setPick] = useState(room.difficulty);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return html`<div class=${`rs-proto${leaving ? ' is-leaving' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[pick]}`} role="dialog" aria-label=${t('选择模拟协议')}
      onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="rs-proto__scene" aria-hidden="true"><${ProtocolScene} key=${pick} difficulty=${pick} /></div>
    <section class="rs-proto__side">
      <h2 class="rs-proto__title">${t('选择模拟协议')}</h2>
      <div class="proto-list rs-proto__list" role="radiogroup" aria-label=${t('模拟难度')}>
        ${availableDifficulties(room.mode).map((d) => html`<${ProtoCard} key=${d} roomMode=${room.mode} difficulty=${d} selected=${pick === d} onSelect=${setPick}
          random=${room.random === true} variant=${variant} />`)}
      </div>
      <button type="button" class="proto-start rs-proto__ok" disabled=${!!busy} onClick=${() => (pick === room.difficulty ? onClose() : onPick(pick))}>
        <span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>
        <span class="proto-start__label">${busy === 'diff' ? html`<${Spinner} size="sm" />` : null}${t('确认')}</span>
        <span class="proto-start__deco" aria-hidden="true"></span>
      </button>
    </section>
  </div>`;
}

/** ⚙ of the bottom pill: 私密房间, 人数上限 (with the 10-seat constants), AI 队友最后选择, 无限火力 branch. */
function RoomOptions({ room, facts, myId, busy, online, variant, onPrivate, onMaxSeats, onAiLast, onAiTakeover, onVariant, onStageBans, onBossHp, onClose, leaving = false }) {
  const coop = room.mode !== 'solo';
  const host = facts.isHost;
  const takeover = aiTakeoverOption(room, myId);
  const optionsRef = useRef(null);
  useLayoutEffect(() => {
    const el = optionsRef.current;
    const fit = () => {
      const anchor = el?.closest('.rs-pill');
      if (!anchor) return;
      const available = Math.max(96, Math.min(innerHeight - 24, anchor.getBoundingClientRect().top - 16));
      el.style.setProperty('--rs-opts-available', `${available}px`);
    };
    fit();
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  useEffect(() => {
    const away = (e) => { if (!e.target.closest?.('.rs-opts, .rs-pill__gear')) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('pointerdown', away); addEventListener('keydown', onKey);
    return () => { removeEventListener('pointerdown', away); removeEventListener('keydown', onKey); };
  }, []);
  return html`<div ref=${optionsRef} class=${`rs-opts${leaving ? ' is-leaving' : ''}`} role="dialog" aria-label=${t('同盟设置')}>
    <h4><span>${t('同盟设置')}${host ? null : html`<small>${t('由创建者设置')}</small>`}</span><button type="button" class="rs-opts__close" aria-label=${t('关闭')} onClick=${onClose}>×</button></h4>
    ${coop && CAN_PRIVATE ? html`<label class="rs-opt"><input type="checkbox" checked=${room.private === true} disabled=${!host || !!busy || !online} onChange=${(e) => onPrivate(e.currentTarget.checked)} />
      <span>${t('私密房间')}<small>${room.private ? t('仅凭同盟密钥或邀请加入，不能搜寻队友') : t('公开大厅可见，可以搜寻队友')}</small></span></label>` : null}
    <${BossHpOption} room=${room} host=${host} busy=${busy} online=${online} onApply=${onBossHp}/>
    ${takeover ? html`<label class="rs-opt"><input type="checkbox" data-testid="room-ai-takeover" checked=${takeover.on} disabled=${!takeover.editable || !!busy || !online} onChange=${e => onAiTakeover(e.currentTarget.checked)} />
      <span>${t('允许观战者接替 AI')}<small>${t('默认关闭。开启后，观战者可在休整期经同房间真人投票接替 AI；继承记录不计个人统计或奖励。')}</small></span></label>` : null}
    ${coop && MAX_SEATS > DEFAULT_SEATS ? html`<label class="rs-opt rs-opt--cap"><span>${t('人数上限')}<small>${facts.seats.length > DEFAULT_SEATS ? t('按队共享卡池 · 联防接力') : t('可搜寻队友')}</small></span>
      <select value=${String(facts.seats.length)} disabled=${!host || !!busy || !online} onChange=${(e) => onMaxSeats(Number(e.currentTarget.value))}>
        ${Array.from({ length: Math.max(MAX_SEATS, facts.seats.length) - DEFAULT_SEATS + 1 }, (_, k) => DEFAULT_SEATS + k).map((n) => html`<option key=${n} value=${String(n)} selected=${n === facts.seats.length}>${t('{n} 人', { n })}</option>`)}
      </select></label>` : null}
    <${AiLastToggle} option=${aiLastOption(room, myId)} busy=${busy} onToggle=${onAiLast} />
    ${room.stageBansSupported && room.stageOptions?.length ? html`<fieldset class="rs-map-bans">
      <legend>${t('地图禁选')} · ${(room.stageBans || []).length}/${room.stageOptions.length - 1}</legend>
      <p>${t('勾选后本房间不会随机到该地图，至少保留一张。')}</p>
      ${room.stageOptions.map(map => {
        const banned = room.stageBans?.includes(map.id);
        return html`<label class="rs-opt" key=${map.id}><input type="checkbox" checked=${!!banned}
          disabled=${!host || !!busy || !online || room.inMatch || (!banned && (room.stageBans?.length || 0) >= room.stageOptions.length - 1)}
          onChange=${() => onStageBans(banned ? room.stageBans.filter(id => id !== map.id) : [...(room.stageBans || []), map.id])} />
          <span>${map.name}<small>${banned ? t('已禁用') : t('可随机')}</small></span></label>`;
      })}
    </fieldset>` : null}
    ${room.random === true ? html`<div class="rs-opt rs-opt--variant"><span>${t('模式分支')}</span>
      <div class="dpick" role="radiogroup" aria-label=${t('模式分支')}>
        ${[['blitz', `快速突袭 ${RANDOM_MODE.totalRounds} 回合`], ['endurance', `持久鏖战 ${RANDOM_MODE.endurance.totalRounds} 回合`], ['marathon', `最长时赛 ${RANDOM_MODE.marathon.totalRounds} 回合`]].map(([v, label]) => html`
          <button key=${v} type="button" role="radio" aria-checked=${variant === v ? 'true' : 'false'} class=${`dpick__opt${variant === v ? ' is-active' : ''}`}
            disabled=${!!busy || !host} onClick=${() => variant !== v && host && onVariant(v)}>${label}</button>`)}
      </div></div>` : null}
  </div>`;
}

/** 匹配成功 / 确认入场（业主 2026-11-15）：仿官方「PUBLIC MATCHMAKING」。
 *  每个真人点「确认入场」；确认过的座位卡**边框变绿**。全员确认后房主自动开局。 */
function MatchFoundOverlay({ room, facts, me, portraits, left, busy, online, myReady, onConfirm, onExit, versionText }) {
  const total = facts.seats.length;
  const confirmed = facts.humans.filter((s) => s.ready).length;
  // 人数适配（业主 2026-11-15）：最多排 4 列，8 / 12 人的多队房间自动换行，
  // 2 人房间也只占两格宽，不会硬撑满屏。
  const cols = Math.min(total, 4);
  return html`<div class="mfo" role="dialog" aria-label=${t('匹配成功')}>
    <div class="mfo__inner">
      <div class="mfo__eyebrow"><i></i>PUBLIC MATCHMAKING<span>${t('队友已集结')}</span></div>
      <h2 class="mfo__title">${t('匹配成功')}</h2>
      <div class="mfo__cards" data-many=${total > 4 ? '1' : undefined} style=${`--cols:${cols}`}>
        ${facts.seats.map((seat, i) => {
          const mine = !!seat && seat.playerId === me.playerId;
          const ready = !!seat && seat.ready;
          const src = seat ? seatPortrait(seat, portraits) : null;
          return html`<article key=${i} class=${`mfo__slot${seat ? '' : ' is-empty'}${ready ? ' is-ready' : ''}${mine ? ' is-me' : ''}`}>
            ${mine ? html`<span class="mfo__you">${t('你')}</span>` : null}
            <div class="mfo__art">
              ${seat
                ? (src ? html`<img src=${src} alt="" draggable=${false} />` : html`<span class="mfo__glyph">${[...(seat.name || '?')][0]}</span>`)
                : html`<span class="mfo__ghost" aria-hidden="true"><i></i></span>`}
            </div>
            <div class="mfo__who">${seat ? (seat.name || t('博士')) : t('等待博士')}</div>
            ${ready ? html`<span class="mfo__ok">${t('已确认')}</span>` : null}
          </article>`;
        })}
      </div>
      <div class="mfo__count"><b class="num">${confirmed}</b> / ${total} ${t('已确认')}</div>
      <div class="mfo__timer"><b class="num">${left}</b></div>
      <div class="mfo__acts">
        <button type="button" class="mfo__confirm" disabled=${myReady || !online || busy === 'ready'} onClick=${onConfirm}>
          ${busy === 'ready' ? html`<${Spinner} size="sm" />` : null}${myReady ? t('已确认，等待队友') : t('确认入场')}
        </button>
        <button type="button" class="mfo__exit" onClick=${onExit}>${t('退出本次匹配')}</button>
      </div>
      <p class="mfo__hint">${t('请在 {n} 秒内确认入场', { n: left })}</p>
      <div class="mfo__tags">
        <span class="mfo__tag is-hot">${difficultyName(room.difficulty)}</span>
        <span class="mfo__tag">${t('{n} 名真人 · 不自动补 AI', { n: facts.humans.length })}</span>
        ${versionText ? html`<span class="mfo__tag">${versionText}</span>` : null}
      </div>
    </div>
  </div>`;
}

/** Room screen component. */
export function RoomScreen() {
  const room = useStore((s) => s.room);
  const versions = useStore((s) => s.versions);
  const [versionOpen, setVersionOpen] = useState(false);
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  const mm = useStore((s) => s.matchmaking, shallowEqual);
  const [busy, setBusy] = useState(null);
  const [picker, setPicker] = useState(false);
  const [opts, setOpts] = useState(false);
  const [searchWant, setSearchWant] = useState(false); // the host asked to search and has not stopped
  const [searchSince, setSearchSince] = useState(0);
  // 补齐房间（业主 2026-11-15）：一次性 60 秒等待，人来够了就开局，否则取消并提示失败。
  // 与「开始搜寻」（会反复重排）是两套语义，所以单独一个状态，不共用 searchWant。
  const [fillDeadline, setFillDeadline] = useState(0);
  const [found, setFound] = useState(false);
  const [lastMatching, setLastMatching] = useState(0); // a short grace while the host's client queues the room again
  const [since] = useState(() => Date.now());
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  const requeue = useRef(false);
  const prevEmpty = useRef(null);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((x) => x + 1), 1000); return () => { clearInterval(id); alive.current = false; }; }, []);
  useData('chess', 'assets');
  const m = data.get('assets');
  // 名片干员: the pickable operators, the default pool (5★/6★ by charId, the same order on every client), one's pick
  const cardList = useMemo(() => cardOperators(data.list('chess')), [data.get('chess')]);
  const [myCard, setMyCard] = useState(() => { const v = loadPref(CARD_PREF, ''); return typeof v === 'string' ? v : ''; });
  const [picking, setPicking] = useState(false);
  const seatsRef = useRef(null);
  const seatScroll = useRosterScroll(seatsRef, { identity: `${room?.code}:${room?.maxSeats}:${room?.seats?.length}` });
  const portraits = useMemo(() => ({
    pool: cardList.filter((c) => (c.rarity ?? 0) >= 5).sort((a, b) => (a.charId < b.charId ? -1 : 1)),
    byChar: new Map(cardList.map((c) => [c.charId, c])), m, myId: me.playerId, myCard,
  }), [cardList, m, me.playerId, myCard]);
  const pickCard = (charId) => {
    setMyCard(charId); savePref(CARD_PREF, charId); setPicking(false);
  };
  // tell the server (teammates see it) once it knows room.card; a refused id stays local
  const seatCard = room ? (roomFacts(room, me.playerId).mine?.card || '') : '';
  useEffect(() => {
    if (!CARD_SYNC || !room || conn.status !== 'online' || seatCard === (myCard || '')) return;
    if (myCard && !portraits.byChar.has(myCard)) return;
    net.request('room.card', { charId: myCard || '' }).catch(() => {});
  }, [room?.code, myCard, seatCard, conn.status]);

  // arrived through 搜寻队友 (match.found for this room): 搜寻成功 once
  useEffect(() => {
    if (room && mm?.status === 'found' && mm.roomCode === room.code) {
      setFound(true);
      store.patch('matchmaking', { status: 'idle' });
    }
  }, [room?.code, mm?.status]);
  useEffect(() => { if (!found) return undefined; const id = setTimeout(() => alive.current && setFound(false), 1900); return () => clearTimeout(id); }, [found]);

  const online = conn.status === 'online';
  const coop = room ? room.mode !== 'solo' : false;
  const facts = room ? roomFacts(room, me.playerId) : null;
  const searchable = CAN_QUEUE && !!room && !room.crisis && coop && facts.isHost && room.private !== true && facts.seats.length <= DEFAULT_SEATS && !room.inMatch;
  const firepower = room?.random === true;
  const variant = room?.variant === 'endurance' || room?.variant === 'marathon' ? room.variant : 'blitz';
  // 炸惊 / 湮灭这类「小玩法」：难度是玩法的一部分，不能再切（业主 2026-11-15，切了会出严重 bug + 界面混乱）
  const playSetLocked = room?.difficulty === ZHAJING_DIFFICULTY || room?.difficulty === ANNIHILATION_DIFFICULTY;

  // the server ends a room's search turn after 10 s without bots: queue again while the host still wants it
  const prevMatching = useRef(null);
  const endedAt = useRef(0);
  useEffect(() => {
    if (!room) return undefined;
    // the end of a search turn: the others keep the panel for a moment while the host's client queues again
    if (prevMatching.current && !room.matching) { endedAt.current = Date.now(); setLastMatching(endedAt.current); }
    prevMatching.current = room.matching || null;
    if (room.matching) return undefined;
    if (!searchWant || !searchable || facts.emptySeats === 0 || !online || requeue.current) return undefined;
    requeue.current = true;
    const id = setTimeout(() => {
      net.request('match.queue', { mode: room.mode, difficulty: room.difficulty, random: firepower, ...(firepower ? { variant } : {}), fillBots: false })
        .catch((err) => { if (alive.current) { setSearchWant(false); toastError(err); } })
        .finally(() => { requeue.current = false; });
    }, 400);
    return () => { clearTimeout(id); requeue.current = false; };
  }, [room?.matching, searchWant, searchable, facts?.emptySeats, online]);
  // seats filled while searching → 搜寻成功; a stale wish is dropped
  useEffect(() => {
    if (!facts) return;
    const empty = facts.emptySeats;
    const wasSearching = searchWant || !!room.matching || Date.now() - endedAt.current < 2500;
    if (prevEmpty.current != null && empty < prevEmpty.current && wasSearching && empty === 0) setFound(true);
    if (empty === 0 && searchWant) setSearchWant(false);
    prevEmpty.current = empty;
  }, [facts?.emptySeats]);
  useEffect(() => { if (!searchable && searchWant) setSearchWant(false); }, [searchable]);
  const searching = !!room && coop && facts.emptySeats > 0 && (!!room.matching || (facts.isHost ? searchWant : Date.now() - lastMatching < 1600));
  // the overlays stay mounted while they fade out; 离开同盟 fades the room before the request goes out
  const [searchShown, searchLeaving] = usePresence(searching && !found, 220);
  const [foundShown, foundLeaving] = usePresence(found, 320);
  // 停止搜寻 (round 6): a short grey 搜寻已停止 on autochess_matching_fail — the recording has no fail / cancel screen, so
  // this state and its 1.2 s are OUR inference
  const [stopped, setStopped] = useState(false);
  useEffect(() => { if (!stopped) return undefined; const id = setTimeout(() => alive.current && setStopped(false), 1200); return () => clearTimeout(id); }, [stopped]);
  const [stoppedShown, stoppedLeaving] = usePresence(stopped && !found, 320);
  const [protoShown, protoLeaving] = usePresence(picker && !!facts?.isHost, 220);
  const [optsShown, optsLeaving] = usePresence(opts, 160);
  const [exiting, setExiting] = useState(false);

  // ---- 匹配成功 / 确认入场（业主 2026-11-15，仿官方「PUBLIC MATCHMAKING」）----
  // 触发：房间里**有 2 名以上真人**且还没开局 —— 不要求「刚刚人数变多」，
  // 否则刷新过页面、或从大厅直接进到已坐两人的房间时永远不弹（业主反馈「没弹出确认窗口」）。
  const [mfOpen, setMfOpen] = useState(false);
  const [mfLeft, setMfLeft] = useState(29);
  const mfRoomRef = useRef(null);
  const mfAutoStarted = useRef(false);
  useEffect(() => {
    if (!room || !facts) return;
    if (mfRoomRef.current !== room.code) { mfRoomRef.current = room.code; setMfOpen(false); mfAutoStarted.current = false; }
    if (!coop || room.inMatch) return;
    const n = facts.humans.length;
    if (n >= 2 && !mfOpen) { setMfOpen(true); setMfLeft(29); mfAutoStarted.current = false; }
    // 人又走了（不足 2 人）就把界面收掉
    if (n < 2 && mfOpen) setMfOpen(false);
  }, [room?.code, room?.inMatch, facts?.humans?.length, coop, mfOpen]);
  // 倒计时
  useEffect(() => {
    if (!mfOpen) return undefined;
    const id = setInterval(() => setMfLeft((x) => Math.max(0, x - 1)), 1000);
    return () => clearInterval(id);
  }, [mfOpen]);
  // 全员就绪 → 房主自动开局；开局了就把界面收掉
  // 业主 2026-11-15「确认入场动画未生效」：以前这里是**立刻**发 room.start，
  // 绿框（.is-ready）刚出来就被关掉了，看起来像没动画。现在等 900ms 让动画走完再开局。
  useEffect(() => {
    if (!mfOpen) return undefined;
    if (room?.inMatch) { setMfOpen(false); return undefined; }
    if (facts?.canStart && facts?.isHost && online && !mfAutoStarted.current) {
      mfAutoStarted.current = true;
      const id = setTimeout(() => {
        if (alive.current) run('start', () => net.request('room.start', {}));
      }, 900);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [mfOpen, facts?.canStart, facts?.isHost, online, room?.inMatch]);

  if (!room) return null;
  const myReady = !!facts.mine?.ready;
  const info = difficultyInfo(room.mode, room.difficulty, { random: firepower, variant });
  const variantName = variant === 'endurance' ? '持久鏖战' : variant === 'marathon' ? '最长时赛' : '快速突袭';
  // 危机合约 (room.state.crisis): the contract names the room; its settings are fixed
  const crisis = room.crisis || null;
  const modeName = crisis ? `危机合约 · ${crisis.mode === 'quad' ? '四人' : '单人'}` : firepower ? `${RANDOM_MODE_NAME} · ${variantName}` : coop ? t('同盟模拟') : t('独立模拟');
  const searchElapsed = facts.isHost && searchSince ? (Date.now() - searchSince) / 1000
    : room.matching?.startedAt ? (serverNow() - room.matching.startedAt) / 1000 : 0;
  // 补齐房间倒计时：优先用服务端给的截止时间（多端一致），回落到本地点按时刻
  const fillDeadlineAt = room?.matching?.deadlineAt || fillDeadline;
  const fillLeft = fillDeadlineAt ? Math.max(0, Math.ceil((fillDeadlineAt - serverNow()) / 1000)) : 0;
  const fillClock = `${Math.floor(fillLeft / 60)}:${String(fillLeft % 60).padStart(2, '0')}`;

  const run = async (kind, fn) => {
    if (inFlight.current) return;
    if (!online) { toast(t('连接中断，请稍候重试'), 'warn'); return; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const toggleReady = () => run('ready', () => net.request('room.ready', { ready: !myReady }));
  const start = () => run('start', () => net.request('room.start', {}));
  const addBot = () => run('addBot', () => net.request('room.addBot', {}));
  const removeBot = seat => run('removeBot', () => net.request('room.removeBot', {seat}));
  const queueMatch = () => run('match', async () => {
    await net.request('match.queue', { mode: room.mode, difficulty: room.difficulty, version: roomVersion(room), random: firepower, ...(firepower ? { variant } : {}), fillBots: false });
    setSearchWant(true); setSearchSince(Date.now());
  });
  // 补齐房间（业主 2026-11-15）：
  //   点一下 → 房间进匹配队列（服务端优先把散人塞进正在匹配的房间），等 60 秒；
  //   期间人多于开始时 → 服务端直接开局；否则取消匹配并推 reason:'fill-failed'。
  //   与「开始搜寻」不同：**只等一轮**，失败就停，不自动重排。
  const startFill = () => run('fill', async () => {
    setFillDeadline(Date.now() + 60_000);
    try {
      await net.request('room.matchmake', {
        mode: room.mode, difficulty: room.difficulty, fillBots: false, timeoutMs: 60_000,
      });
      // 服务端回 room.state 后会用它的 deadlineAt 校正（渲染时优先读 room.matching）
      const dl = room.matching?.deadlineAt;
      if (dl) setFillDeadline(dl);
    } catch (e) {
      setFillDeadline(0);
      throw e;
    }
  });
  const cancelFill = () => run('cancel-fill', async () => {
    setFillDeadline(0);
    await net.request('room.matchmake.cancel', {});
  });
  // 服务端说「没人来」→ 弹提示并收掉倒计时
  useEffect(() => {
    const off = net.on('match.status', (msg) => {
      if (!msg || msg.reason !== 'fill-failed' || !alive.current) return;
      setFillDeadline(0);
      toast(t('补齐失败：没有等到新玩家，已取消补齐'), 'warn');
    });
    return off;
  }, []);
  // 安全网：服务端已经结束匹配（room.matching 消失）但消息没到，也把倒计时收掉
  useEffect(() => {
    if (!fillDeadline || room?.matching) return undefined;
    const id = setTimeout(() => { if (alive.current) setFillDeadline(0); }, 1500);
    return () => clearTimeout(id);
  }, [fillDeadline, room?.matching]);
  // 房主切换无限火力分支（blitz / endurance）——room.setRandom 带 variant
  const setVariant = (v) => run('variant', () => net.request('room.setRandom', { random: true, variant: v }));
  const cancelMatch = () => { setSearchWant(false); setLastMatching(0); setStopped(true); if (room.matching || (federationEnabled && regionMatching())) run('cancel-match', () => net.request('match.cancel', {})); };
  // the host removes a human before the match (community report #17): asked first; the player may join again. The
  // confirmed player's id goes along: if they left and someone else took the seat meanwhile, the server refuses it.
  const kick = async (seat, name, playerId) => {
    if (inFlight.current) return;
    const ok = await confirmDialog({ title: t('移出同盟'), text: t('确定将「{name}」移出同盟吗？对方可以凭同盟密钥重新加入。', { name: name || t('博士') }), okText: t('移出'), danger: true });
    if (ok) run(`kick${seat}`, () => net.request('room.kick', { seat, playerId }));
  };
  const setPrivate = (isPrivate) => run('privacy', () => net.request('room.setPrivate', { private: isPrivate }));
  const setAllowReverse = on => run('reverse-policy', () => net.request('room.setAllowReverse', { on }));
  const setBossHp = (percent) => run('bossHp', () => net.request('room.setBossHpBonus', {percent}));
  const setMaxSeats = (n) => run('cap', () => net.request('room.setMaxSeats', { n })); // 2026-10-12: 4–10 seats
  const setStageBans = stages => run('maps', () => net.request('room.setStageBans', { stages }));
  const setDifficulty = (difficulty) => run('diff', async () => { await net.request('room.setDifficulty', { difficulty }); setPicker(false); });
  const setAiLast = (on) => run('ailast', () => net.request('room.setAiPicksLast', { on }));
  const setAiTakeover = (on) => run('aihandover', () => net.request('room.setAiTakeover', { on }));
  const voteTest = (on) => run('testVote', () => net.request('room.testVote', { on }));
  const proposeVersion = version => run('version', async () => {
    const send = () => net.request('room.proposeVersion', { version });
    try { await send(); } catch (err) {
      if (err?.code !== 'RATE') throw err;
      await new Promise(resolve => setTimeout(resolve, 850));
      await send();
    }
    if (alive.current) setVersionOpen(false);
  });
  // spectator seats: the host frees one; a spectator takes a free player seat with room.join of this room
  const removeSpectator = (playerId) => run(`rs${playerId}`, () => net.request('room.removeSpectator', { playerId }));
  const sit = () => run('sit', () => net.request('room.join', { code: room.code }));
  const copy = async (what) => {
    const modeLabel = firepower ? `${RANDOM_MODE_NAME} · ` : '';
    const ok = await copyText(what === 'code' ? (federationEnabled?publicRoomCode(currentNode(),room.code):room.code) : `${inviteLink(room.code)} ${me.name}邀请你加入${roomVersion(room) === 'act3autochess@V3_1' ? '卫戍协议：规程' : '卫戍协议：盟约'}【${modeLabel}${difficultyName(room.difficulty)}】`);
    if (ok) toast(what === 'code' ? t('同盟密钥复制成功，可前往邀请队友') : t('已复制邀请链接'), 'success');
    else toast(t('复制失败，请手动复制'), 'warn');
  };
  const leave = async () => {
    if (inFlight.current) return;
    const othersHere = facts.humans.some((s) => s.playerId !== me.playerId);
    if (facts.isHost && othersHere) {
      const ok = await confirmDialog({ title: t('离开同盟'), text: t('你是同盟的创建者，离开后创建者身份将移交或同盟解散。确定离开吗？'), okText: t('离开'), danger: true });
      if (!ok) return;
    }
    inFlight.current = true;
    setBusy('leave');
    setExiting(true);
    await afterLeave(200);
    let left = false;
    try {
      await net.request('room.leave', {});
      left = true;
    } catch (err) {
      if (err?.code === 'NOT_IN_ROOM') left = true;
      else toastError(err);
    } finally {
      if (left) store.set({ room: null, match: emptyMatch() });
      else if (alive.current) setExiting(false);
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const toFill = Math.max(0, Math.min(DEFAULT_SEATS, facts.seats.length) - facts.occupied.length);
  const statusLine = !online
    ? html`<span class="t-orange"><${Icon} name="wifiOff" />${t('连接中断，正在重连…')}</span>`
    : facts.spectating
      ? html`<span class="t-lo"><${Icon} name="eye" />${t('观战中 · 不占博士席位，模拟开始后可切换观看各位博士')}</span>`
    : !coop
      ? html`<span class="t-mint">${t('*模拟协议已就绪，准许进入模拟')}</span>`
    : facts.modded && !facts.contentReady
      ? html`<span class="t-lo">${t('等待所有博士载入房间的插件内容')}</span>`
    : facts.crisisShort
      ? html`<span class="t-lo">${t('四人合约还差 {n} 位博士，可邀请好友或添加机器人', { n: facts.crisisShort })}</span>`
    : facts.isHost
      ? facts.canStart
        ? facts.emptySeats && searchable
          ? html`<span>${t('精确搜寻：将搜寻 {n} 位同难度的博士', { n: toFill })}<span class="t-mint"> · ${t('也可直接开始模拟')}</span></span>`
          : html`<span class="t-mint">${t('*同盟人数达标，准许进入模拟')}</span>`
        : html`<span class="t-lo">${t('等待所有博士准备就绪')}</span>`
      : myReady
        ? html`<span class="t-mint">${t('已就绪 · 等待创建者开始模拟')}</span>`
        : html`<span class="t-lo">${t('准备就绪后，创建者即可开始模拟')}</span>`;

  return html`<div class=${`screen room-screen rs${coop ? '' : ' rs--solo'}${facts.seats.length > DEFAULT_SEATS ? ' rs--big' : ''}${exiting ? ' is-leaving' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[difficultyTheme(room.difficulty)]}; --n:${facts.seats.length}`}>
    <div class="rs__bg" aria-hidden="true"></div>
    <header class="rs-top">
      <div class="rs-top__left">
        <${Tooltip} text=${t('离开同盟')} placement="bottom">
          <button type="button" class="rs-exit" disabled=${busy === 'leave'} onClick=${leave} aria-label=${t('离开同盟')}><${Icon} name="exit" /></button>
        <//>
        <div class="rs-clock">
          <b>${modeName}<span class="rs-clock__sep"></span>${t('同盟已等待')} <span class="num">${clock((Date.now() - since) / 1000)}</span></b>
          <${PingPill} ms=${conn.ping} online=${online} />
        </div>
        <div class="rs-tools">
          <${Button} variant="secondary" size="sm" square=${true} icon="chart" class="stats-entry" onClick=${openStats} title=${t('统计数据')} aria-label=${t('统计数据')} />
          ${coop ? html`<${Button} variant="secondary" size="sm" square=${true} icon="users" class="rs-friends" onClick=${() => openFriends()} title=${t('好友 · 邀请好友加入')} aria-label=${t('好友')} />` : null}
          <${SettingsButton} class="room-settings" variant="secondary" square=${true} />
          <${GuideButton} class="room-guide" variant="secondary" square=${true} />
        </div>
        ${room.content?.modeId ? html`<span class="room-mode" data-testid="room-mode">${(room.content.modes || []).find((m) => m.id === room.content.modeId)?.name || room.content.modeId}</span>` : null}
        <${PluginTag} room=${room} myId=${me.playerId} />
        ${coop ? html`<button type="button" role="switch" aria-checked=${room.allowReverse === true} aria-label="允许倒转玩家" class=${`rs-reverse${room.allowReverse === true ? ' is-on' : ''}`} disabled=${!facts.isHost || !!busy || !online || room.inMatch || room.allowReverseSupported !== true} title=${facts.isHost ? '房间招募偏好，由房主设置' : '房间招募偏好，仅房主可修改'} onClick=${() => setAllowReverse(room.allowReverse !== true)}><span class="rs-reverse__mark" aria-hidden="true">${room.allowReverse === true ? '✓' : '×'}</span><span>${reversePolicyLabel(room)}</span></button>` : null}
        ${crisis ? html`<${CrisisTagStrip} crisis=${crisis} />` : null}
      </div>
      <div class="rs-top__right">
        <${LoadoutButton} from="room" size="md" class="hub-plate hub-plate--loadout rs-loadout" label=${t('干员调配')} />
        ${coop ? html`<div class="rs-key">
          <span class="rs-key__k">${t('同盟密钥')}</span>
          <b class="rs-key__code num selectable" aria-label=${t('同盟密钥 {code}', { code: federationEnabled?publicRoomCode(currentNode(),room.code):room.code })}>${federationEnabled?publicRoomCode(currentNode(),room.code):room.code}</b>
          <button type="button" class="rs-key__copy" onClick=${() => copy('code')}>${t('复制')}</button>
          <button type="button" class="rs-key__link" onClick=${() => copy('link')} title=${t('复制邀请链接')} aria-label=${t('复制邀请链接')}><${Icon} name="link" /></button>
          ${crisis&&facts.isHost?html`<button type="button" class="prep-add-friend" disabled=${!!busy||!online} onClick=${()=>setPrivate(room.private!==true)}>${room.private?'公开招募':'停止招募'}</button>`:null}
          <button type="button" class="rs-key__friends" onClick=${() => openFriends({ invite: false })} title=${t('查看好友列表')}><${Icon} name="users" /><span>${t('好友')}</span></button>
        </div>` : html`<div class="rs-key rs-key--solo"><${MicroLabel}>SINGLE OPERATOR<//><span>${t('仅限 1 名博士')}</span></div>`}
      </div>
    </header>

    <main ref=${seatsRef} class="rs-seats" tabIndex="0" aria-label=${t('同盟成员，左右滑动查看')}>
      ${facts.seats.map((s, i) => html`<${SeatCard} key=${s ? `p${s.playerId}` : `e${i}`} seat=${s} index=${i} room=${room} facts=${facts}
        myId=${me.playerId} busy=${busy} onKick=${kick} onAddBot=${addBot} onRemoveBot=${removeBot} onInvite=${() => openInviteDrawer(() => copy('code'))} searching=${searching} portraits=${portraits}
        onPickCard=${cardList.length ? () => setPicking(true) : null} />`)}
      ${coop ? null : html`<aside class="solo-brief rs-brief brackets">
        <${MicroLabel} tone="mint">BRIEFING<//>
        <h2>${difficultyName(room.difficulty)}<span class="num t-dim"> ${info.code}</span></h2>
        <p>${info.desc}</p>
        <ul>
          ${info.effects.map((e) => html`<li key=${e}>${e}</li>`)}
          <li>${t('共')} <b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? t('，满足条件时进入隐秘核心') : ''}</li>
          <li>${t('独立模拟中休整期与机变阶段不限时')}</li>
        </ul>
      </aside>`}
    </main>
    <${SpectatorBar} facts=${facts} myId=${me.playerId} busy=${busy} onRemove=${removeSpectator} onSit=${sit} />
    <${VersionVote} room=${room} />

    ${(seatScroll.prev || seatScroll.next) ? html`<nav class="rs-scroll" aria-label=${t('成员列表翻页')}>
      <button type="button" disabled=${!seatScroll.prev} onClick=${() => seatScroll.page(-1)} aria-label=${t('向左')}><${Icon} name="chevronLeft" /></button>
      <span>${t('共 {n} 个席位 · 左右滑动查看', { n: facts.seats.length })}</span>
      <button type="button" disabled=${!seatScroll.next} onClick=${() => seatScroll.page(1)} aria-label=${t('向右')}><${Icon} name="chevronRight" /></button>
    </nav>` : null}
    <footer class="rs-foot">
      <div class="rs-foot__left"></div>
      <div class="rs-foot__center">
        <p class="rs-hint">${coop ? html`<span class="rs-ready num" title=${t('已就绪')}>${facts.humans.map((s) => html`<${Icon} key=${s.playerId} name="user" class=${facts.isReady(s) ? 'is-on' : ''} />`)}<b>${facts.readyHumans}</b>/${facts.humans.length}</span>` : null}${statusLine}</p>
        <div class="rs-test-row"><${TestVoteButton} room=${room} facts=${facts} myId=${me.playerId} busy=${busy} online=${online} onVote=${voteTest} /><div class="rs-pill">
          ${coop && CAN_QUEUE ? html`<span class="rs-pill__mode" title=${t('精确搜寻：只与选择相同难度的博士组成同盟')}><${Icon} name="search" />${t('精确搜寻')}</span><i class="rs-pill__sep"></i>` : null}
          ${Array.isArray(versions) && versions.length > 1 ? html`<button type="button" class="rs-pill__diff" data-testid="room-version" disabled=${!!busy || !!crisis || !!versionVoteOf(room) || facts.modded} onClick=${() => setVersionOpen(true)} title=${t('游戏版本')}><${Icon} name="book" />${versionLabel(roomVersion(room))}</button><i class="rs-pill__sep"></i>` : null}
          <button type="button" class="rs-pill__diff" disabled=${!facts.isHost || !coop || playSetLocked || !!busy || !!crisis} onClick=${() => setPicker(true)}
            title=${playSetLocked ? t('这个玩法的难度由玩法决定，不能切换') : !coop ? t('独立模拟的难度在创建时已确定') : facts.isHost ? t('更改模拟难度') : t('由创建者选择')}><${DifficultyIcon} difficulty=${room.difficulty} />${difficultyName(room.difficulty)}</button>
          <button type="button" class=${`rs-pill__gear${opts ? ' is-on' : ''}`} disabled=${!!crisis} onClick=${() => setOpts((v) => !v)} title=${t('同盟设置')} aria-label=${t('同盟设置')} aria-expanded=${opts ? 'true' : 'false'}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 2h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" fill-rule="evenodd" /></svg>
          </button>
          ${optsShown ? html`<${RoomOptions} room=${room} facts=${facts} myId=${me.playerId} busy=${busy} online=${online} variant=${variant}
            onPrivate=${setPrivate} onMaxSeats=${setMaxSeats} onAiLast=${setAiLast} onAiTakeover=${setAiTakeover} onVariant=${setVariant} onStageBans=${setStageBans} onBossHp=${setBossHp} onClose=${() => setOpts(false)} leaving=${optsLeaving} />` : null}
        </div></div>
      </div>
      <div class="rs-foot__right">
        ${facts.isHost && searchable && facts.emptySeats > 0 && !searching
          ? html`<button type="button" class="rs-search" disabled=${!online || busy === 'match'} onClick=${queueMatch}>
              <${Icon} name="search" />${t('开始搜寻')}${busy === 'match' ? html`<${Spinner} size="sm" />` : null}</button>` : null}
        ${facts.isHost && searchable && facts.emptySeats > 0 && fillLeft <= 0
          ? html`<button type="button" class="proto-start rs-fill" disabled=${!online || busy === 'fill' || !!crisis}
              onClick=${startFill}
              title=${t('把房间挂上匹配，让别人搜寻时优先进入这里；60 秒内凑够人就自动开局')}>
              <span class="proto-start__mark" aria-hidden="true"><${Icon} name="users" /></span>
              <span class="proto-start__label">${busy === 'fill' ? html`<${Spinner} size="sm" />` : null}${t('补齐房间')}</span>
            </button>` : null}
        ${facts.isHost && fillLeft > 0
          ? html`<button type="button" class="proto-start rs-fill is-filling" disabled=${busy === 'cancel-fill'}
              onClick=${cancelFill} title=${t('取消补齐')}>
              <span class="proto-start__mark" aria-hidden="true"><${Icon} name="close" /></span>
              <span class="proto-start__label">${busy === 'cancel-fill' ? html`<${Spinner} size="sm" />` : null}${t('取消补齐')}</span>
            </button>` : null}
        ${facts.isHost
          ? html`<button type="button" class="proto-start rs-go" disabled=${!facts.canStart || !online || busy === 'start' || fillLeft > 0} onClick=${start}
              title=${fillLeft > 0 ? t('正在补齐房间，请先取消补齐或等待倒计时结束') : facts.canStart ? undefined : !facts.contentReady ? t('仍有博士未载入房间的插件内容') : facts.crisisShort ? t('四人合约需要坐满 4 位博士') : t('仍有博士未准备就绪')}>
              <span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>
              <span class="proto-start__label">${busy === 'start' ? html`<${Spinner} size="sm" />` : null}${fillLeft > 0 ? fillClock : t('开始模拟')}</span>
              <span class="proto-start__deco" aria-hidden="true"></span></button>`
          : facts.spectating
            ? html`<button type="button" class="proto-start rs-go" disabled=${true}><span class="proto-start__label"><${Icon} name="eye" />${t('观战中')}</span></button>`
          : html`<button type="button" class=${`proto-start rs-go${myReady ? ' is-ready' : ''}`} disabled=${!online || !facts.mine || busy === 'ready' || (!myReady && facts.myContent !== 'ready')} onClick=${toggleReady}
              title=${myReady ? t('再次点击取消就绪') : facts.myContent !== 'ready' ? t('房间的插件内容载入并通过校验后才能准备') : undefined}>
              <span class="rs-go__box" aria-hidden="true">${myReady ? html`<${Icon} name="check" />` : null}</span>
              <span class="proto-start__label">${busy === 'ready' ? html`<${Spinner} size="sm" />` : null}${myReady ? t('已就绪') : t('准备就绪')}</span>
              <span class="proto-start__deco" aria-hidden="true"></span></button>`}
      </div>
    </footer>

    ${searchShown ? html`<${SearchPanel} class=${`rs-searchpanel${searchLeaving ? ' is-leaving' : ''}`} elapsed=${searchElapsed}
      onStop=${facts.isHost ? cancelMatch : null} stopping=${busy === 'cancel-match'}
      note=${facts.isHost ? t('搜寻期间可随时直接开始模拟') : t('创建者正在搜寻队友')}
      tags=${[{ key: 'mode', label: t('精确搜寻'), icon: html`<${Icon} name="search" />` },
        { key: 'diff', label: difficultyName(room.difficulty), color: DIFFICULTY_COLORS[difficultyTheme(room.difficulty)], icon: html`<${DifficultyIcon} difficulty=${room.difficulty} />` }]} />` : null}
    ${foundShown ? html`<${FoundPanel} class=${foundLeaving ? 'is-leaving' : ''} seats=${facts.seats.length} text=${t('同盟集结完毕')} />` : null}
    ${stoppedShown && !foundShown ? html`<${FoundPanel} fail=${true} class=${stoppedLeaving ? 'is-leaving' : ''} seats=${facts.seats.length} text=${t('已返回房间')} />` : null}
    ${picking ? html`<${CardPicker} current=${myCard} list=${cardList} m=${m} onPick=${pickCard} onClose=${() => setPicking(false)} />` : null}
    ${protoShown ? html`<${RoomProtocol} room=${room} variant=${variant} busy=${busy} onClose=${() => setPicker(false)} onPick=${setDifficulty} leaving=${protoLeaving} />` : null}
    ${mfOpen && facts && coop
      ? html`<${MatchFoundOverlay}
          room=${room} facts=${facts} me=${me} portraits=${portraits}
          left=${mfLeft} busy=${busy} online=${online} myReady=${myReady}
          onConfirm=${toggleReady}
          onExit=${() => run('leave', () => net.request('room.leave', {}))}
          versionText=${versionLabel(roomVersion(room))} />`
      : null}
    ${versionOpen ? html`<${VersionPicker} mode="room" versions=${versions || []} current=${roomVersion(room)} serverDefault=${versions?.find(v => v.default)?.id || DEFAULT_VERSION} roomMode=${room.mode} editable=${facts.isHost && !facts.spectating && !room.inMatch} busy=${!!busy} onPick=${proposeVersion} onClose=${() => setVersionOpen(false)} />` : null}
  </div>`;
}

/** Persistent across room/game routes, including spectators who never consent. */
export function TrustedNotice() {
  const state = useStore(s => s);
  const room = state.room, cs = room?.content?.cs, trusted = room?.content?.trusted;
  const seat = room?.seats?.find(s => s && s.playerId === state.me?.playerId);
  const [dismissed,setDismissed] = useState(null);
  const [busy,setBusy] = useState(false);
  const [review,setReview] = useState(false);
  const choose = async accept => {
    setBusy(true);
    try {
      if (seat) await net.request('room.consent',{cs,accept});
      rememberScriptConsent(cs,accept);
      setDismissed(cs); setReview(false);
      if (accept && trusted.plugins.some(p => p.permissions.includes('trusted.page'))) {
        const url = new URL(location.href); url.searchParams.set('cs',cs); url.searchParams.set('room',room.code);
        location.assign(url.href); return;
      }
      store.set({room:{...store.get().room}}); // wake the content loader after local persistence
    } catch (e) { toastError(e); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (trusted && seat && hasScriptConsent(cs) && !trusted.consent?.[seat.seat] && !room.inMatch) {
      net.request('room.consent',{cs,accept:true}).catch(toastError);
    }
  },[cs,seat?.seat,!!trusted?.consent?.[seat?.seat]]);
  if (!trusted) return null;
  return html`<aside class="trusted-banner" data-testid="trusted-banner">
    <strong>${t('受信任插件')}</strong>
    <button onClick=${() => setReview(true)}>${t('查看风险与同意状态')}</button>
    <${Modal} open=${review || (dismissed !== cs && !hasScriptConsent(cs))} title=${t('受信任插件')} tone="red" closeOnBackdrop=${false}
      onClose=${() => room.inMatch ? setReview(false) : choose(false)} actions=${html`<${Button} disabled=${busy} onClick=${() => choose(false)} data-testid="script-decline">${t('拒绝')}<//>
        <${Button} disabled=${busy} onClick=${() => choose(true)} data-testid="script-accept">${t('同意运行')}<//>`}>
      <p>${t('它可以完全控制你的游戏页面')}</p>
      <p>${t('仅在你信任所有作者及以下代码时同意。换了内容组合需要重新同意。')}</p>
      <ul>${trusted.plugins.map(p => html`<li key=${p.id}><strong>${p.id} ${p.version}</strong>
        <p>${t('作者：{authors}',{authors:(p.authors || []).join(', ') || '—'})}</p>
        <p class="trusted-hash">SHA-256: ${p.hash}</p><p>${t('权限：{permissions}',{permissions:p.permissions.join(', ')})}</p></li>`)}</ul>
    <//>
  </aside>`;
}
