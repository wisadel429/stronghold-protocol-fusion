import { UIThemeButton } from '/js/ui/uiThemePicker.js';
import {publicRoomCode} from '/ui-compat/shared/unifiedRegion-20261024.js';
import {CrisisRoomBadge,isCrisisRoom} from '/js/ui/crisisRoomBadge.js';
import { reversePolicyLabel } from '/js/ui/roomPolicy.js';
import { roomCodeFromText, looksLikeInviteLink } from '/js/ui/inviteParse.js';
import { FeedbackButton, NoticeButton } from '/js/ui/playerSupport.js';
import { LobbyMusicButton } from '/js/ui/lobbyMusic.js';
import { AccountMeChip, AccountNickname, useAccount } from '/js/ui/accounts.js';
import { isOwnerName, decorateOwnerName } from '/js/ui/ownerName.js';
import { enabled as federationEnabled, currentNode, roomCounts as federationCounts, rooms as federationRooms } from '/js/federation.js';
import { latencyStore } from '/js/nodeLatency.js';
import { MatchmakingCount } from '/js/ui/matchmaking.js';
import { Emblem } from '/js/screens/title.js';
import { useHubBackdrop, HubBackdrop, HubRadar, BackdropSettings, BackdropGlyph, backdropTheme } from '/js/ui/hubBackdrop.js';
// Lobby screen — a hub (owner's request, 2026-10-13): an original backdrop (ui/hubBackdrop.js: generated night scenes or
// the player's own picture) with the game's dot-matrix emblem in the middle, a left column (密钥加入 · tips), a right
// column (缺人同盟 card · S.W.E.E.P.报告 (screens/sweep.js) · 干员调配) and four big entries at the bottom right:
// 独立模拟 / 同盟模拟 / 无限火力 open the start sheet (difficulty 标准/险境/绝境/终极, 无限火力's variant, private room,
// 快速匹配, create), 搜寻队友 opens the room list. The 密钥加入 dialog joins with a 同盟密钥 (recent codes remembered) —
// as a player (加入同盟) or in one of its MAX_SPECTATORS spectator seats (观战: room.spectate, also while its match
// runs; community report #26). The server is picked on the title screen.
//
// Difficulty descriptions come from data/config.json `modes[modeId]` when present, else from the
// official act2autochess `modeDataDict` texts embedded below (desc + effectDescList), so the
// screen is complete before data is generated. Rounds: solo 标准 = 9, everything else 14 (+R15
// hidden core on 险境+), per research 00-INDEX §2. Battlefield pool (`modes[].stages`): 标准 always
// plays 战场#01, 险境 draws one of 8, 绝境 / 终极 one of 7 (m01 excluded).
// Texts go through t() (docs/I18N.md); the module-level tables hold msgids (N_) translated where they are shown, the
// config.json mode texts come localized from data.js.

import { ResumeMatchButton } from '/js/ui/resumeMatch.js';
import { useEffect, useRef, useState } from '/vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS, difficultyName, difficultyOptions, difficultyTheme, isDifficulty, ROOM_CODE_LEN, MAX_SEATS, MAX_SPECTATORS, modeIdFor, ERR, ERR_TEXT } from '/shared/constants.js';
import { RANDOM_MODE } from '/shared/randomMode.js';
import { html, Button, Icon, MicroLabel, Panel, TextField, PingPill, AvatarFrame, Tooltip, Spinner, DifficultyIcon, doctorNo, confirmDialog } from '/js/ui/components.js';
import { toast, toastError } from '/js/ui/toasts.js';
import { GuideButton, openGuide } from '/js/ui/guide.js';
import { DemoButton } from '/js/ui/demoMenu.js';
import { openStats } from '/js/screens/stats.js';
import { AchievementEntry, AchievementPanel } from '/js/ui/achievements.js';
import { FriendsTile } from '/js/ui/friends.js';
import { SettingsButton } from '/js/ui/settings.js';
import { PwaInstallButton, fullscreen } from '/js/ui/device.js';
import { LoadoutButton, openLoadout } from '/js/screens/loadout.js';
import { HubNav, HubLogo, HubAchCard, HubPlate, HubInvite, HubEntries, ParkedSoloEntries, useHubProgress, useToolsFold } from '/js/ui/officialHub.js';
import { SweepReport } from '/js/screens/sweep.js';
import { CrisisEventCard } from '/js/ui/crisisEvent.js';   // 危机合约 (shown on a core that plays contracts)
import { VersionSwitch } from '/js/ui/versionPicker.js';
import { lobbyVersion } from '/js/versions.js';
import { ProtocolScene } from '/js/ui/protocolScene.js';
import { SearchPanel, RadarScene, CreateArt, JoinArt } from '/js/ui/matchFlow.js';
import { useLeave } from '/js/ui/transitions.js';
import { net, identity } from '/js/net.js';
import { store, useStore, shallowEqual, loadPref, savePref } from '/js/store.js';
import { getConfig, getMode, getStage, useData } from '/js/data.js';
import { t, tc, N_ } from '/shared/i18n.js';

/** Official mode texts (activity_table act2autochess.modeDataDict), fallback when config.json is absent. */
export const MODE_TEXT = {
  single: {
    FUNNY: { code: 'AC-1', desc: N_('时长较短的模拟训练'), effects: [N_('可以快速完成作战'), N_('常规奖励')] },
    NORMAL: { code: 'AC-2', desc: N_('敌方攻击强度较高的模拟训练'), effects: [N_('可使用盟约数增加'), N_('大幅增加奖励')] },
    HARD: { code: 'AC-3', desc: N_('敌方攻击强度极高的模拟训练'), effects: [N_('作战环境困难'), N_('出现更加危险的敌人')] },
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
  multi: {
    FUNNY: { code: 'AC-1', desc: N_('敌方攻击强度较低的模拟训练'), effects: [N_('作战环境较为温和'), N_('常规奖励')] },
    NORMAL: { code: 'AC-2', desc: N_('敌方攻击强度较高的模拟训练'), effects: [N_('可使用盟约数增加'), N_('大幅增加奖励')] },
    HARD: { code: 'AC-3', desc: N_('敌方攻击强度极高的模拟训练'), effects: [N_('作战环境困难'), N_('出现更加危险的敌人')] },
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
};

/** Battlefield pool per difficulty when config.json is absent (the modes' `stages` lists; same for solo and co-op). */
export const STAGE_POOL = { FUNNY: ['act1autochess_m01'], NORMAL: 8, HARD: 7, ABYSS: 7 };

/**
 * Display name of a stage: stages.json when it is loaded, else derived from the id (act1 m0N → 战场#0N, act2 m0N → 战场#0(N+4)).
 * From the data name only its 战场#NN part (with a (上半) / (下半) mark) — 'Battlefield #NN (First Half)' in English.
 * @param {string} id e.g. 'act1autochess_m01'
 */
export function stageLabel(id) {
  const rec = getStage(id);
  if (rec && typeof rec.name === 'string' && rec.name) {
    const m = rec.name.match(/^(.*?#\d+(?:\s*[(（][^)）]*[)）])?)/);
    return m ? m[1] : rec.name.split(/\s+/)[0];
  }
  const m = String(id || '').match(/^act(\d)autochess_m(\d+)$/);
  return m ? t('战场#{no}', { no: String(Number(m[2]) + (m[1] === '2' ? 4 : 0)).padStart(2, '0') }) : '';
}

/**
 * The battlefield note of a difficulty (official wording): a single-stage pool is fixed ("战场固定为 战场#01"), a larger
 * one is drawn at random ("战场随机（共8张）").
 * @param {string[] | number | null | undefined} stages the mode's `stages` list (or a count)
 * @returns {string} '' when unknown
 */
export function stageNote(stages) {
  if (Array.isArray(stages)) {
    const ids = stages.filter((s) => typeof s === 'string' && s);
    if (ids.length === 1) { const name = stageLabel(ids[0]); return name ? t('战场固定为 {name}', { name }) : t('战场固定'); }
    return ids.length > 1 ? t('战场随机（共{n}张）', { n: ids.length }) : '';
  }
  return Number.isInteger(stages) && stages > 1 ? t('战场随机（共{stages}张）', { stages }) : '';
}

const MODE_CARDS = [
  {
    id: 'solo', name: N_('独立模拟'), en: 'SOLO SIMULATION', icon: 'user',
    desc: N_('独自调配资金与干员，以自己的节奏完成整场模拟。'),
    points: [N_('1 名博士'), N_('休整期与机变阶段不限时')],
  },
  {
    id: 'coop', name: N_('同盟模拟'), en: 'ALLIANCE SIMULATION', icon: 'users',
    desc: N_('与至多 {n} 名博士组成同盟，队内共享干员池，联防接力抵御敌潮。'), params: { n: MAX_SEATS - 1 },
    points: [N_('1–{n} 名博士 · 邀请真人队友'), N_('联防阶段 · 最终攻势合并生命值')], pointParams: { n: MAX_SEATS },
  },
  {
    id: 'firepower', name: '无限火力', badge: '1.1', en: 'UNLIMITED FIREPOWER', icon: 'dice',
    desc: '强势干员、技能连发，迎战怪潮与悬赏首领，轻松体验阵营成型的快感。',
    points: [`1–${MAX_SEATS} 名博士 · 邀请真人队友`, `${RANDOM_MODE.totalRounds} 回合娱乐乱斗 · 推荐标准难度`],
  },
];

/** 无限火力分支（随机模式 variant）：快速突袭 9 回合 / 持久鏖战 13 回合。 */
const VARIANT_CARDS = [
  {
    id: 'blitz', name: '快速突袭', en: 'BLITZ', desc: `固定 ${RANDOM_MODE.totalRounds} 回合短局，紧凑刺激的数值节奏。`,
  },
  {
    id: 'endurance', name: '持久鏖战', en: 'ENDURANCE', desc: `固定 ${RANDOM_MODE.endurance.totalRounds} 回合长局，曲线平滑拉长，供深度养成构筑。`,
  },
  { id: 'marathon', name: '最长时赛', en: 'MARATHON', desc: `固定 ${RANDOM_MODE.marathon.totalRounds} 回合超长局，逐回合悬赏，极限养成拉锯。` },
];

/** 随机模式分支偏好（localStorage）。 */
export function firepowerVariantPreference() {
  const v = loadPref('lobby.firepowerVariant', 'blitz');
  return v === 'endurance' || v === 'marathon' ? v : 'blitz';
}

/** A presentation choice; the protocol still uses solo/coop plus Room.random. */
export function lobbySimulationPreference() {
  const selected = loadPref('lobby.simulation', null);
  if (MODE_CARDS.some((c) => c.id === selected)) return selected;
  // Preserve the old random toggle, including random solo preferences, as the new dedicated mode.
  if (loadPref('lobby.random', false) === true) return 'firepower';
  return loadPref('lobby.mode', 'coop') === 'solo' ? 'solo' : 'coop';
}

function preferredDifficulty(simulation) {
  const key = simulation === 'firepower' ? 'lobby.firepowerDifficulty' : 'lobby.difficulty';
  const d = loadPref(key, 'FUNNY');
  return isDifficulty(d) ? d : 'FUNNY';
}

/** Keep the explanation tied to the shared balance configuration. */
export function firepowerFeatures(variant = 'blitz') {
  const { multipliers, firepower, shop, lowTier, band, rounds, endurance, marathon, evolution, opening } = RANDOM_MODE;
  const v = variant === 'endurance' ? endurance : variant === 'marathon' ? marathon : { totalRounds: RANDOM_MODE.totalRounds, leaders: rounds.leaders };
  const leaderRounds = Object.keys(v.leaders).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const bossSpan = leaderRounds.length ? `第 ${leaderRounds[0]}–${leaderRounds.at(-1)} 回合` : '中后段回合';
  return [
    { title: '强势阵营', text: `开局逐轮发放无限火力模组：装备后生命与攻击 ×${opening.modBuff.hpMul}，防御提升 ${Math.round((opening.modBuff.defMul - 1) * 100)}%，每场可复活一次；盟约层数无上限成长。` },
    { title: '技能回转', text: `全员技力恢复加速 ${Math.round((firepower.spRecoveryMul - 1) * 100)}%，保留原生技能轴；再部署缩短 ${Math.round((1 - firepower.redeployMul) * 100)}%。` },
    { title: '开局成型', text: `${shop.startLevel} 级商店、${shop.startFunds} 资金开局；干员盲盒 ${shop.revealChoices} 选 1，部署上限 9 人，每人 ${band.picksPerPlayer} 个策略。` },
    { title: '阶段质变', text: `第 ${evolution.rounds.join('/')} 回合休整期三选一：层数共鸣 / 生机坚壁 / 军备充盈。` },
    { title: '轻松也有挑战', text: `${v.totalRounds} 回合密集怪潮，${bossSpan}悬赏首领轮换；每回合随机效果，${lowTier.lowTierMax} 阶及以下干员也有额外强化。` },
  ];
}

function FirepowerBrief({ variant, onVariant }) {
  const rounds = variant === 'endurance' ? RANDOM_MODE.endurance.totalRounds : variant === 'marathon' ? RANDOM_MODE.marathon.totalRounds : RANDOM_MODE.totalRounds;
  return html`<aside class="firepower-brief brackets" aria-label="无限火力模式特点">
    <div class="firepower-brief__head">
      <span class="firepower-brief__title">无限火力</span><span class="mode-beta">1.1</span>
      <span class="firepower-brief__hint">从标准难度开始，享受阵营成型与技能清场</span>
    </div>
    <div class="firepower-variants" role="radiogroup" aria-label="模式分支">
      ${VARIANT_CARDS.map((c) => html`<button key=${c.id} type="button" role="radio" aria-checked=${variant === c.id ? 'true' : 'false'}
          class=${`firepower-variant${variant === c.id ? ' is-selected' : ''}`} onClick=${() => onVariant(c.id)}>
        <span class="firepower-variant__name">${c.name}<span class="firepower-variant__en">${c.en}</span></span>
        <span class="firepower-variant__desc">${c.desc}</span>
      </button>`)}
    </div>
    <div class="firepower-features">${firepowerFeatures(variant).map((f) => html`<div key=${f.title} class="firepower-feature">
      <strong>${f.title}</strong><p>${f.text}</p>
    </div>`)}</div>
  </aside>`;
}

/**
 * Text for a difficulty card, preferring data/config.json.
 * @param {'solo'|'coop'} roomMode
 * @param {string} difficulty
 * @param {{ random?: boolean, variant?: string }} [opts] 随机模式: the room's random flag + variant — the variant's
 *   round count (RANDOM_MODE / variantRounds: blitz 9 / endurance 13) replaces the config's lastRound everywhere
 *   the count is shown.
 * @returns {{ code: string, desc: string, effects: string[], rounds: number, hidden: boolean, stageNote: string }}
 */
export function availableDifficulties(roomMode) {
  const choices = difficultyOptions(roomMode).filter((d) => getMode(modeIdFor(roomMode, d)));
  return choices.length ? choices : DIFFICULTIES;
}

export function difficultyInfo(roomMode, difficulty, { random = false, variant = 'blitz' } = {}) {
  const fallback = MODE_TEXT[roomMode === 'single' || roomMode === 'solo' ? 'single' : 'multi'][difficulty] || { code: '', desc: '', effects: [] };
  // modeIdFor() lower-cases the difficulty: never call it with a value the server did not validate.
  const m = isDifficulty(difficulty) ? getMode(modeIdFor(roomMode, difficulty)) : null;
  const effects = Array.isArray(m?.effectDescList)
    ? m.effectDescList.map((e) => String(e).replace(/^[·•\s]+/, '')).filter(Boolean)
    : fallback.effects;
  // 随机模式: the whole run is the variant's rounds (server GameData.applyRandomRounds; variantRounds)
  const rounds = random
    ? (variant === 'endurance' ? RANDOM_MODE.endurance.totalRounds : variant === 'marathon' ? RANDOM_MODE.marathon.totalRounds : RANDOM_MODE.totalRounds)
    : Number.isFinite(m?.lastRound) ? m.lastRound : roomMode === 'solo' && difficulty === 'FUNNY' ? 9 : 14;
  return {
    code: typeof m?.code === 'string' ? m.code : fallback.code,
    desc: typeof m?.desc === 'string' ? m.desc : t(fallback.desc),
    effects,
    rounds,
    hidden: !random && (m ? Number.isInteger(m.hiddenRound) : difficulty !== 'FUNNY'),
    stageNote: stageNote(Array.isArray(m?.stages) && m.stages.length ? m.stages : STAGE_POOL[difficulty]),
  };
}

const CODE_RE = /^(?:[A-Z0-9]{4}|[1-8][A-Z0-9]{4})$/;
/**
 * Normalise user input into a room code: accepts a pasted invite link (`…?room=ABCD`), keeps
 * upper-cased alphanumerics and clamps to the code length.
 * @param {string} v
 * @returns {string}
 */
export function normalizeCode(v) {
  let s = String(v ?? '');
  const m = s.match(/[?&]room=([A-Za-z0-9]+)/);
  if (m) s = m[1];
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, federationEnabled ? 5 : ROOM_CODE_LEN);
}

/**
 * Pasted text → room code (empty string when the text holds no code). 业主 2026-11-21：整段邀请里只取网址的
 * `?room=`，填进密钥并直接进房；纯密钥（4~5 位）照旧可用。
 * @param {string} text
 * @returns {string}
 */
export function codeFromPastedText(text) {
  const c = roomCodeFromText(text);
  return c ? normalizeCode(c) : '';
}

/**
 * A handler that Preact binds as `onClick=${fn}` receives the click EVENT as its first argument, and a default
 * parameter only applies to `undefined` — so `fn(c = code)` would normalise the event target into a nonsense code
 * (`String(el)` → `"[object HTMLElement]"` → "OBJE"). Only a string is ever a code; anything else falls back to the
 * input field. Returns null when neither yields a well-formed code.
 * @param {unknown} arg the argument a handler was called with
 * @param {string} field the current input-field value
 * @returns {string|null}
 */
export function codeArg(arg, field) {
  const k = normalizeCode(typeof arg === 'string' ? arg : field);
  return CODE_RE.test(k) ? k : null;
}

/**
 * Room code from a deep link query string (`?room=CODE`), or null when absent/malformed.
 * Accepts ROOM_CODE_LEN..ROOM_CODE_LEN+2 alphanumerics (the protocol's join limit).
 * @param {string} search e.g. location.search
 * @returns {string|null}
 */
export function parseRoomParam(search) {
  try {
    const raw = new URLSearchParams(search || '').get('room');
    if (!raw) return null;
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]+$/.test(code)) return null;
    return code.length >= ROOM_CODE_LEN && code.length <= ROOM_CODE_LEN + 2 ? code : null;
  } catch {
    return null;
  }
}

/** Recently joined/created co-op room codes (most recent first). */
export function recentRooms() {
  const list = loadPref('recentRooms', []);
  return Array.isArray(list) ? list.filter((c) => typeof c === 'string' && CODE_RE.test(c)).slice(0, 4) : [];
}

/** @param {string} code */
export function rememberRoom(code) {
  if(federationEnabled)code=publicRoomCode(currentNode(),code);
  if (!CODE_RE.test(code)) return;
  savePref('recentRooms', [code, ...recentRooms().filter((c) => c !== code)].slice(0, 4));
}

const FALLBACK_TIPS = [
  N_('联合模拟在选择策略时可以进行一次跳过'),
  N_('调度中心即使冻结，依然可以主动刷新'),
  N_('两件同名装备可以合成一件更强力的装备'),
  N_('只有达成完美作战的队友可以进行联防'),
];
const TIP_ROTATE_MS = 5000; // matchingTipRotateInterval

/** Rotating tactical tips (config.json `tips`, weighted list of { tip, weight }). */
function TipsPanel() {
  const cfg = getConfig();
  const fallback = FALLBACK_TIPS.map((x) => t(x));
  const tips = Array.isArray(cfg?.tips)
    ? cfg.tips.map((x) => (typeof x === 'string' ? x : x?.tip)).filter((x) => typeof x === 'string' && x)
    : fallback;
  const list = tips.length ? tips : fallback;
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * list.length));
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => i + 1), TIP_ROTATE_MS);
    return () => clearInterval(id);
  }, []);
  const i = ((idx % list.length) + list.length) % list.length;
  return html`<div class="tips brackets">
    <div class="tips__head">
      <${Icon} name="info" />
      <span>${t('作战提示')}</span>
      <${MicroLabel}>TACTICAL TIPS<//>
      <span class="tips__idx num">${String(i + 1).padStart(2, '0')}<span class="t-dim">/${String(list.length).padStart(2, '0')}</span></span>
      <button type="button" class="tips__nav" onClick=${() => setIdx(i - 1 + list.length)} aria-label=${t('上一条')}><${Icon} name="chevronLeft" /></button>
      <button type="button" class="tips__nav" onClick=${() => setIdx(i + 1)} aria-label=${t('下一条')}><${Icon} name="chevronRight" /></button>
    </div>
    <p key=${i} class="tips__text">${list[i]}</p>
  </div>`;
}

/**
 * 缺人同盟: public alliance rooms still waiting for doctors, fewest empty seats first (closest to starting), joinable in
 * one click. A fixed-height card — three rows, or an empty note with a shortcut to create one.
 */
/* NODE-PING: a room lives on one node, so joining it pins you to that node's latency. Surface the
   measured value and let the closest rooms sort first. */
const nodePingOf = (id) => {
  const v = latencyStore.get().results?.[id]?.ping;
  return Number.isFinite(v) ? v : null;
};
/* REL-PING: an absolute 90ms bar misreads players whose whole region is slow. Warn when a room's
   node is clearly worse *than the nodes this player can actually reach well*. */
const bestPingOf = () => {
  const r = (latencyStore.get().results) || {};
  const vals = Object.values(r).map((v) => v && v.ping).filter((v) => Number.isFinite(v));
  return vals.length ? Math.min(...vals) : null;
};
const isFarNode = (id) => {
  const ping = nodePingOf(id);
  if (ping == null) return false;
  const best = bestPingOf();
  return best == null ? ping >= 90 : ping - best >= 25;
};
const latencyTag = (id) => {
  const ping = nodePingOf(id);
  if (ping == null) return '';
  return isFarNode(id) ? ` · ${ping}ms ⚠` : ` · ${ping}ms`;
};
const latencyOf = (id) => { const ping = nodePingOf(id); return ping == null ? 9999 : ping; };

export function recruitingRooms(rooms) {
  return (Array.isArray(rooms) ? rooms : [])
    .filter((r) => r && typeof r.code === 'string' && !r.inMatch && r.humans > 0 && r.humans < (r.maxSeats || MAX_SEATS))
    .sort((a, b) => latencyOf(a.node) - latencyOf(b.node)
      || ((a.maxSeats || MAX_SEATS) - a.humans) - ((b.maxSeats || MAX_SEATS) - b.humans)
      || b.humans - a.humans);
}

function RoomTitle({ room, name, className = '' }) {
  const profile = useAccount(room.hostPlayerId || room.hostId);
  return html`<span class=${className} title=${name}><${AccountNickname} profile=${profile} name=${name}/></span>`;
}

function RecruitCard({ rooms, online, onJoin, onAll, onCreate, onRefresh, refreshing }) {
  const open = recruitingRooms(rooms);
  return html`<section class="hub-recruit" aria-label=${t('缺人同盟')} aria-busy=${!!refreshing}>
    <header class="hub-recruit__head">
      <span class=${`hub-recruit__pulse${open.length ? ' is-live' : ''}`} aria-hidden="true"></span>
      <span class="hub-recruit__title">${t('缺人同盟')}</span>
      <span class="hub-recruit__en">RECRUITING</span>
      <span class="hub-recruit__n num">${open.length}</span>
      <button type="button" class="hub-recruit__refresh" disabled=${!online || refreshing} onClick=${onRefresh} aria-label=${refreshing ? t('正在刷新同盟列表') : t('刷新同盟列表')} title=${refreshing ? t('正在刷新同盟列表') : t('刷新同盟列表')}><${Icon} name="refresh" class=${refreshing ? 'is-spinning' : ''} /></button>
      <button type="button" class="hub-recruit__all" onClick=${onAll}>${t('全部')}<${Icon} name="chevronRight" /></button>
    </header>
    <div class="hub-recruit__list">
      ${open.length ? open.slice(0, 3).map((r) => {
        const max = r.maxSeats || MAX_SEATS;
        const name = r.name || `同盟 #${r.code}`;
        return html`<div key=${`${r.node || ''}:${r.code}`} class=${`hub-recruit__row${isCrisisRoom(r)?' is-crisis':''}`} style=${`--d-color:${DIFFICULTY_COLORS[difficultyTheme(r.difficulty)] || 'var(--mint-500)'}`}>
          <span class="hub-recruit__info">
            <${RoomTitle} room=${r} name=${name} className="hub-recruit__name"/>
            <span class=${`hub-recruit__policy${r.allowReverse === true ? ' is-on' : ''}`}>${reversePolicyLabel(r)}</span>
            <${CrisisRoomBadge} room=${r}/><span class="hub-recruit__meta">
              <${DifficultyIcon} difficulty=${r.difficulty} class="diff-glyph" />
              <span>${difficultyName(r.difficulty) || r.difficulty}</span>
              ${r.random ? html`<span class="hub-recruit__fp">无限火力</span>` : null}
              
            </span>
          </span>
          <span class="hub-recruit__seats">
            <span class="hub-recruit__pips" aria-hidden="true">${Array.from({ length: max }, (_, i) => html`<i key=${i} class=${i < r.humans ? 'is-on' : ''}></i>`)}</span>
            <span class="hub-recruit__need">${t('缺')}<b class="num">${max - r.humans}</b>${t('人')}</span>
          </span>
          <button type="button" class="hub-recruit__join" disabled=${!online} onClick=${() => onJoin(r.code, r.node)}>${t('加入')}</button>
        </div>`;
      }) : html`<div class="hub-recruit__empty">
        <span>${t('暂时没有缺人的同盟')}</span>
        <button type="button" class="hub-recruit__create" onClick=${onCreate}>${t('创建同盟')}<${Icon} name="chevronRight" /></button>
      </div>`}
    </div>
  </section>`;
}

/** 全屏 / 退出全屏 in the top bar, styled like its neighbours (hidden where the browser has no element fullscreen). */
function HubFullscreenButton() {
  const [on, setOn] = useState(() => fullscreen.active());
  const [ok] = useState(() => fullscreen.supported());
  useEffect(() => {
    const upd = () => setOn(fullscreen.active());
    document.addEventListener('fullscreenchange', upd);
    document.addEventListener('webkitfullscreenchange', upd);
    return () => { document.removeEventListener('fullscreenchange', upd); document.removeEventListener('webkitfullscreenchange', upd); };
  }, []);
  if (!ok) return null;
  const label = on ? t('退出全屏') : t('全屏');
  return html`<${Button} variant="secondary" size="sm" square=${true} icon=${on ? 'collapse' : 'expand'} class="hub-fs-btn"
    title=${label} aria-label=${label} aria-pressed=${on ? 'true' : 'false'} onClick=${() => fullscreen.toggle()} />`;
}

/** Crossed blades in a hexagon: the S.W.E.E.P. plate's glyph (original drawing). */
function SweepGlyph() {
  return html`<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M16 2.5 27.7 9.2v13.6L16 29.5 4.3 22.8V9.2z" fill="none" stroke="currentColor" stroke-width="1.5" />
    <path d="M9 9l12.5 12.5M23 9 10.5 21.5" stroke="currentColor" stroke-width="2.2" />
    <path d="M19.2 23.8l4.6-4.6M8.2 19.2l4.6 4.6M21.6 21.6l2.2 2.2M10.4 21.6l-2.2 2.2" stroke="currentColor" stroke-width="1.8" />
  </svg>`;
}

/** S.W.E.E.P.报告: opens the report (screens/sweep.js — 盟约报告 / 策略报告 / 敌方资料). */
function SweepPlate({ onClick }) {
  return html`<button type="button" class="hub-plate hub-plate--sweep" onClick=${onClick} title=${t('S.W.E.E.P.报告：盟约、策略与敌方资料')}>
    <span class="hub-plate__glyph"><${SweepGlyph} /></span>
    <span class="hub-plate__label">S.W.E.E.P.${t('报告')}</span>
    <span class="hub-plate__tag">REPORT</span>
  </button>`;
}

/** One of the four big entries at the bottom right. */
function HubEntry({ group, name, en, icon, badge, tone = 'mint', count = null, onClick, disabled = false }) {
  return html`<div class="hub-entry-wrap">
    ${group ? html`<span class="hub-entry__group"><${Icon} name=${group.icon} />${group.label}</span>` : html`<span class="hub-entry__group hub-entry__group--blank"></span>`}
    <button type="button" class=${`hub-entry hub-entry--${tone}`} onClick=${onClick} disabled=${disabled}>
      <span class="hub-entry__icon"><${Icon} name=${icon} /></span>
      <span class="hub-entry__en">${en}</span>
      <span class="hub-entry__name">${name}${badge ? html`<span class="mode-beta">${badge}</span>` : null}</span>
      ${count != null ? html`<span class="hub-entry__count"><${MatchmakingCount} count=${count} /></span>` : null}
      <span class="hub-entry__corner" aria-hidden="true"></span>
    </button>
  </div>`;
}

/** A small tile of the side column. */
function HubTile({ icon, label, en, onClick, children }) {
  return html`<button type="button" class="hub-tile" onClick=${onClick}>
    <span class="hub-tile__icon"><${Icon} name=${icon} /></span>
    <span class="hub-tile__text"><span class="hub-tile__label">${label}</span><span class="hub-tile__en">${en}</span></span>
    ${children}
  </button>`;
}

/** Shared frame of the hub's two dialogs (the start sheet, 密钥加入). */
function HubDialog({ open, micro, title, onClose, wide = false, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    addEventListener('keydown', onKey);
    // the lobby chat (z 180, ui/communityChat.js) sits above modals: it steps aside while a hub dialog is open
    document.body.classList.add('hub-dialog-open');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('hub-dialog-open'); };
  }, [open]);
  if (!open) return null;
  return html`<div class="modal hub-dialog" role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div class=${`modal__box hub-dialog__box brackets${wide ? ' hub-dialog__box--wide' : ''}`} role="dialog" aria-modal="true">
      <div class="modal__stripe" aria-hidden="true"></div>
      <header class="hub-dialog__head">
        <${MicroLabel} tone="mint">${micro}<//>
        <div class="hub-dialog__title-row">
          <h2 class="modal__title">${title}</h2>
          <button type="button" class="mm-modal__close" onClick=${onClose} aria-label="关闭"><${Icon} name="close" /></button>
        </div>
      </header>
      <div class="hub-dialog__body">${children}</div>
    </div>
  </div>`;
}

function DifficultyCard({ roomMode, difficulty, selected, onSelect, matchmaking, random = false, variant = 'blitz' }) {
  const info = difficultyInfo(roomMode, difficulty, { random, variant });
  return html`<button type="button" class=${`diff-card${selected ? ' is-selected' : ''}`}
      style=${`--d-color:${DIFFICULTY_COLORS[difficultyTheme(difficulty)]}`} onClick=${() => onSelect(difficulty)} aria-pressed=${selected ? 'true' : 'false'}>
    <span class="diff-card__bar" aria-hidden="true"></span>
    <span class="diff-card__head">
      <${DifficultyIcon} difficulty=${difficulty} class="diff-card__glyph" />
      <span class="diff-card__name">${difficultyName(difficulty)}</span>
      <span class="diff-card__code num">${info.code}</span>
      ${roomMode === 'coop' && !random ? html`<${MatchmakingCount} count=${matchmaking?.byDifficulty?.[difficulty]} />` : null}
      <span class="diff-card__meta">
        <span class="num">${info.rounds}</span> ${tc('rounds', '回合')}${info.hidden ? html`<span class="diff-card__hidden">${t('+ 隐秘核心')}</span>` : null}
      </span>
    </span>
    <span class="diff-card__desc">${info.desc}</span>
    <span class="diff-card__effects">${info.effects.map((e) => html`<span key=${e}>${e}</span>`)}${info.stageNote ? html`<span key="stage" class="diff-card__stage"><${Icon} name="rook" />${info.stageNote}</span>` : null}</span>
    <span class="diff-card__check" aria-hidden="true"><${Icon} name="check" /><span>${t('已选定')}</span></span>
  </button>`;
}

/** The hand-drawn ring of the 已选定 stamp (two loose strokes). */
function StampRing() {
  return html`<svg class="pcard__ring" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
    <path pathLength="1" d="M18 62C6 34 34 8 70 10c34 2 48 30 38 54-10 24-46 32-72 22C20 80 10 66 16 50" />
    <path pathLength="1" d="M30 20c22-14 62-12 78 10 12 18 4 44-16 54" />
  </svg>`;
}

/** 正在加入同盟…: bottom left while the room is being opened, a light running along the bottom edge (css tr-join). */
function JoinLine({ text }) {
  return html`<div class="tr-join" role="status"><span class="tr-join__mark" aria-hidden="true"></span>${text}<span class="tr-join__dots" aria-hidden="true"></span></div>`;
}

/** One difficulty of 选择模拟协议: name, text, effects; the extras (code, rounds, 隐秘核心, battlefields, queue) below. */
export function ProtoCard({ roomMode, difficulty, selected, onSelect, matchmaking, random, variant }) {
  const info = difficultyInfo(roomMode, difficulty, { random, variant });
  return html`<button type="button" class=${`pcard${selected ? ' is-on' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[difficultyTheme(difficulty)]}`}
      onClick=${() => onSelect(difficulty)} aria-pressed=${selected ? 'true' : 'false'}>
    <span class="pcard__glow" aria-hidden="true"></span>
    <span class="pcard__head">
      <${DifficultyIcon} difficulty=${difficulty} class="pcard__glyph" />
      <span class="pcard__name">${difficultyName(difficulty)}</span>
      ${roomMode === 'coop' && !random ? html`<${MatchmakingCount} count=${matchmaking?.byDifficulty?.[difficulty]} />` : null}
    </span>
    <span class="pcard__desc">${info.desc}</span>
    <span class="pcard__effects">${info.effects.map((e) => html`<span key=${e}>${e}</span>`)}</span>
    <span class="pcard__meta">
      ${info.code ? html`<span class="num">${info.code}</span>` : null}
      <span><b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? t(' + 隐秘核心') : ''}</span>
      ${info.stageNote ? html`<span>${info.stageNote}</span>` : null}
    </span>
    <span class="pcard__stamp" aria-hidden="true"><${StampRing} /><span class="pcard__tick"><${Icon} name="check" /></span><span class="pcard__ok">${t('已选定')}</span></span>
  </button>`;
}

/**
 * 选择模拟协议 (2026-10-13, the owner's request: the event's second screen after 独立模拟): full screen, the picture of
 * the selected difficulty at the left (ui/protocolScene.js, original), the difficulties down the right with the
 * 已选定 stamp, 开始模拟 at the bottom right. Kept from the old start sheet: 无限火力's variants and notes, the private
 * room, 快速匹配, the queue counts, rounds / 隐秘核心 / battlefields and the hints. Esc or ‹ returns to the hub.
 * Comes up from black over the hub (`chained`: straight after 选择同盟方式, already black) and fades back out
 * (ui/transitions.js); the picture is redrawn for each difficulty.
 */
function ProtocolSelect({ card, roomMode, random, variant, difficulty, onDifficulty, onClose, matchmaking, brief, privateRoom, onPrivate,
  online, maint, busy, isSearching, onCreate, onQueue, purpose = 'create', onSearch, onCancel, mm, onBrowse, chained = false }) {
  const [leaving, leave] = useLeave(onClose);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal, .guide')) leave(); };
    addEventListener('keydown', onKey);
    document.body.classList.add('hub-dialog-open');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('hub-dialog-open'); };
  }, []);
  const fx = `${leaving ? ' is-leaving' : ''}${chained ? ' is-chained' : ''}`;
  const search = purpose === 'search';
  const info = difficultyInfo(roomMode, difficulty, { random, variant });
  const label = store.get().testMode === true && !search && !maint?.active ? t('创建测试对局') : maint?.active ? t('维护中 · 暂停开局') : search ? t('开始搜寻') : random ? t('创建无限火力') : roomMode === 'solo' ? t('开始模拟') : t('创建同盟');
  const hint = !online ? t('正在连接服务器…') : maint?.active ? t('服务器即将停机维护，暂时停止开启新的同盟')
    : search ? t('精确搜寻：只与选择相同难度的博士组成同盟，凑齐 4 人即开始')
    : isSearching ? t('正在匹配真人队友，AI 补位已暂停') : roomMode === 'solo' ? t('独自调配阵容，按自己的节奏开始模拟') : t('创建后可邀请好友，AI 队友已暂停');
  // 搜寻队友: while the queue runs, the right column is the 搜寻中 panel (the server's elapsed / matched counts)
  if (search && isSearching) {
    const d = mm?.difficulty && DIFFICULTIES.includes(mm.difficulty) ? mm.difficulty : difficulty;
    return html`<div class=${`proto proto--searching${fx}`} style=${`--d-color:${DIFFICULTY_COLORS[difficultyTheme(d)]}`} data-difficulty=${d} role="dialog" aria-label=${t('搜寻队友')}>
      <div class="proto__bg" aria-hidden="true"></div>
      <header class="proto-top">
        <${HubNav} onBack=${leave} backLabel=${t('返回大厅（继续搜寻）')} homeLabel=${t('返回大厅')} />
      </header>
      <div class="proto-body">
        <section class="proto-stage"><${ProtocolScene} key=${d} difficulty=${difficultyTheme(d)} /></section>
        <section class="proto-side proto-side--search">
          <${SearchPanel} elapsed=${mm?.elapsed || 0} onStop=${onCancel} stopping=${busy === 'cancel'}
            note=${t('已找到 {matched}/{target} 名博士', { matched: mm?.matched || 1, target: mm?.target || 4 })}
            tags=${[{ key: 'mode', label: t('精确搜寻'), icon: html`<${Icon} name="search" />` },
              { key: 'diff', label: difficultyName(d), color: DIFFICULTY_COLORS[difficultyTheme(d)], icon: html`<${DifficultyIcon} difficulty=${d} />` }]} />
        </section>
      </div>
    </div>`;
  }
  return html`<div class=${`proto${fx}`} style=${`--d-color:${DIFFICULTY_COLORS[difficultyTheme(difficulty)]}`} data-difficulty=${difficulty} role="dialog" aria-label=${t('选择模拟协议')}>
    <div class="proto__bg" aria-hidden="true"></div>
    <header class="proto-top">
      <${HubNav} onBack=${leave} backLabel=${t('返回大厅 (Esc)')} homeLabel=${t('返回大厅')} />
      <div class="proto-title">
        <h2>${t('选择模拟协议')}</h2>
        <span class="proto-title__mode">${search ? t('搜寻队友') : t(card.name)}<i>${search ? 'FIND ALLIES' : card.en}</i></span>
      </div>
    </header>
    <div class="proto-body">
      <section class="proto-stage">
        <${ProtocolScene} key=${difficulty} difficulty=${difficulty} />
        <div class="proto-brief">
          <span class="proto-brief__code num">${info.code}</span>
          <b class="proto-brief__name">${difficultyName(difficulty)}</b>
          <p>${t(card.desc, card.params)}</p>
        </div>
        ${brief ? html`<div class="proto-fp">${brief}</div>` : null}
      </section>
      <section class="proto-side">
        <div class="proto-list" role="radiogroup" aria-label=${t('模拟难度')}>
          ${availableDifficulties(roomMode).map((d) => html`<${ProtoCard} key=${d} roomMode=${roomMode} difficulty=${d} selected=${difficulty === d} onSelect=${onDifficulty}
            matchmaking=${matchmaking} random=${random} variant=${variant} />`)}
        </div>
        <div class="proto-foot">
          ${search ? html`<div class="proto-opts">
            <span class="proto-mode-chip"><${Icon} name="search" />${t('精确搜寻')}</span>
            <${Button} variant="secondary" size="md" icon="users" onClick=${onBrowse}>${t('浏览公开同盟')}<//>
          </div>` : roomMode !== 'solo' ? html`<div class="proto-opts">
            ${roomMode !== 'solo' ? html`<label class="proto-private" title=${t('不在公开大厅显示，仅通过房间码或邀请加入')}>
              <input type="checkbox" checked=${privateRoom} onChange=${(e) => onPrivate(e.currentTarget.checked)} /><span>${t('私密房间')}</span></label>` : null}
            ${roomMode === 'coop' ? html`<${Button} variant="secondary" size="md" icon="refresh" loading=${busy === 'queue'} disabled=${!online || maint?.active || isSearching}
              onClick=${onQueue}>${t('快速匹配')}<//>` : null}
          </div>` : null}
          <p class="proto-hint">${hint}</p>
          <button type="button" class=${search ? 'proto-start proto-start--search' : 'proto-start'} disabled=${!online || maint?.active || busy === 'create' || busy === 'queue'} onClick=${search ? onSearch : onCreate}>
            <span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>
            <span class="proto-start__label">${busy === 'create' || busy === 'queue' ? html`<${Spinner} size="sm" />` : null}${label}</span>
            <span class="proto-start__deco" aria-hidden="true"></span>
          </button>
        </div>
      </section>
    </div>
    ${busy === 'create' ? html`<${JoinLine} text=${roomMode === 'solo' ? t('正在进入模拟') : t('正在建立同盟')} />` : null}
  </div>`;
}

/**
 * 选择同盟方式 (2026-10-13, the owner's request: the event's screen after 同盟模拟, video 5:22–6:29): the radar at the
 * left (ui/matchFlow.js), 创建同盟 (a room at the remembered difficulty — it is changed in the room) and 加入同盟 (the
 * key field, 观战, recent keys) at the right, 模拟邀约 (the public alliances) between them, 入门协议 (玩法说明)
 * at the bottom left (搜寻队友 beside it since item 9, off the cards). Esc or ‹ returns to the hub.
 */
function AllianceSelect({ onClose, code, onCode, codeOk, recent, online, maint, busy, onCreate, onJoin, onSpectate, onBrowse, onSearch, recruiting = 0, difficulty }) {
  const [leaving, leave] = useLeave(onClose);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal, .guide')) leave(); };
    addEventListener('keydown', onKey);
    document.body.classList.add('hub-dialog-open');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('hub-dialog-open'); };
  }, []);
  const joining = busy === 'create' ? t('正在建立同盟') : busy === 'join' ? t('正在加入同盟') : busy === 'spectate' ? t('正在进入观战') : null;
  return html`<div class=${`proto ally${leaving ? ' is-leaving' : ''}`} role="dialog" aria-label=${t('选择同盟方式')}>
    <div class="proto__bg ally__bg" aria-hidden="true"></div>
    <header class="proto-top">
      <${HubNav} onBack=${leave} backLabel=${t('返回大厅 (Esc)')} homeLabel=${t('返回大厅')} />
      <div class="proto-title"><h2>${t('选择同盟方式')}</h2><span class="proto-title__mode ally__mode">${t('同盟模拟')}<i>ALLIANCE SIMULATION</i></span></div>
    </header>
    <div class="proto-body ally-body">
      <section class="ally-stage"><${RadarScene} />
        <button type="button" class="ally-guide" onClick=${() => openGuide(0)}><span class="ally-guide__icon"><${Icon} name="book" /></span>${t('入门协议')}</button>
        <button type="button" class="ally-pill ally-pill--search" onClick=${onSearch}><${Icon} name="search" />${t('搜寻队友')}</button>
      </section>
      <section class="ally-side">
        <button type="button" class="ally-card ally-card--create" disabled=${!online || maint?.active || busy === 'create'} onClick=${onCreate}>
          <span class="ally-card__art"><${CreateArt} /></span>
          <span class="ally-card__bar"><span class="ally-card__icon"><${Icon} name="plus" /></span>${maint?.active ? t('维护中 · 暂停开局') : t('创建同盟')}
            ${busy === 'create' ? html`<${Spinner} size="sm" />` : html`<small>${t('难度：{name}（可在同盟内更改）', { name: difficultyName(difficulty) })}</small>`}</span>
        </button>
        <div class="ally-links">
          <button type="button" class="ally-pill ally-pill--invite" onClick=${onBrowse}>${t('模拟邀约')}${recruiting ? html`<b class="num">${recruiting}</b>` : null}<span class="ally-pill__mark" aria-hidden="true"></span></button>
        </div>
        <div class="ally-card ally-card--join">
          <span class="ally-card__art"><${JoinArt} /></span>
          <label class="ally-key"><${Icon} name="search" />
            <input type="text" value=${code} placeholder=${t('输入同盟密钥')} maxlength="64" autocomplete="off" spellcheck="false"
              onInput=${(e) => onCode(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter') onJoin(); }}
              onPaste=${(e) => {
                // 业主 2026-11-21「粘贴邀请适配」：整段邀请里只取网址的 ?room=，填进密钥并直接进房
                const text = e && e.clipboardData ? e.clipboardData.getData('text') : '';
                const pasted = codeFromPastedText(text);
                if (!pasted) return;              // 不是邀请：交给浏览器正常粘贴（onInput 还会再过滤一次）
                e.preventDefault();
                onCode(pasted);
                onJoin(pasted);
              }} />
            ${codeOk ? html`<button type="button" class="ally-key__spec" disabled=${!online || busy === 'spectate'} onClick=${onSpectate}
              title=${t('以观战者身份进入：不占博士席位，只能观看（每个同盟最多 {MAX_SPECTATORS} 名，模拟进行中也可进入）', { MAX_SPECTATORS })}><${Icon} name="eye" />${t('观战')}</button>` : null}
          </label>
          ${recent.length ? html`<span class="ally-recent">${recent.map((c) => html`<button key=${c} type="button" class="code-chip num" title=${t('填入密钥（不会直接加入）')} onClick=${() => onCode(c)}>${c}</button>`)}</span>` : null}
          <button type="button" class="ally-card__bar ally-card__bar--join" disabled=${!codeOk || !online || busy === 'join'} onClick=${() => onJoin()}>
            <span class="ally-card__icon"><${Icon} name="users" /></span>${t('加入同盟')}${busy === 'join' ? html`<${Spinner} size="sm" />` : null}
          </button>
        </div>
      </section>
    </div>
    ${joining ? html`<${JoinLine} text=${joining} />` : null}
  </div>`;
}

function MatchmakingModal({ open, onClose, onJoin, onSpectate }) {
  const lobbyStats = useStore((s) => s.lobbyStats, shallowEqual);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(() => ({
    online: lobbyStats?.online ?? null,
    activeRoomsCount: lobbyStats?.activeRoomsCount,
    activeMatchesCount: lobbyStats?.activeMatchesCount,
    retainedMatchesCount: lobbyStats?.retainedMatchesCount,
    roomsCount: lobbyStats?.roomsCount ?? 0,
    matchesCount: lobbyStats?.matchesCount ?? 0,
    rooms: lobbyStats?.rooms ?? [],
  }));

  useEffect(() => {
    if (federationEnabled) {net.request('room.list').then(r=>setData(r)).catch(()=>{});return;}
    if (lobbyStats && typeof lobbyStats.online === 'number') {
      setData({
        online: lobbyStats.online,
        activeRoomsCount: lobbyStats.activeRoomsCount,
        activeMatchesCount: lobbyStats.activeMatchesCount,
        retainedMatchesCount: lobbyStats.retainedMatchesCount,
        roomsCount: lobbyStats.roomsCount,
        matchesCount: lobbyStats.matchesCount,
        rooms: lobbyStats.rooms,
      });
    }
  }, [lobbyStats]);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const res = await net.request('room.list');
      if (res && res.ok) {
        setData(res);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    fetchRooms();
    const timer = setInterval(() => { if (!document.hidden) fetchRooms(); }, 8000);
    return () => clearInterval(timer);
  }, [open]);

  if (!open) return null;

  return html`<div class="modal mm-modal" role="presentation"
      onMouseDown=${(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
    <div class="modal__box mm-modal__box brackets" role="dialog" aria-modal="true">
      <div class="modal__stripe" aria-hidden="true"></div>
      <header class="modal__head mm-modal__head">
        <${MicroLabel} tone="mint">LOBBY<//>
        <div class="mm-modal__title-row">
          <h2 class="modal__title mm-modal__title">大厅</h2>
          <button type="button" class="mm-modal__close" onClick=${onClose} aria-label="关闭">
            <${Icon} name="close" />
          </button>
        </div>
      </header>

      <div class="mm-modal__body">
        <div class="mm-stats-bar">
          <div class="mm-stats-col">
            <span class="mm-stats-num mm-stats-num--mint num">${data.online ?? '—'}</span>
            <span class="mm-stats-label">在线博士</span>
          </div>
          <div class="mm-stats-col">
            <span class="mm-stats-num num">${data.activeRoomsCount ?? '—'}</span>
            <span class="mm-stats-label">活跃房间</span>
          </div>
          <div class="mm-stats-col">
            <span class="mm-stats-num num">${data.activeMatchesCount ?? '—'}</span>
            <span class="mm-stats-label">进行中对局</span>
          </div>
          <div class="mm-stats-col" title="所有真人均已断线、仍可重连的未结束对局；不计入前两项房间与对局数">
            <span class="mm-stats-num num">${data.retainedMatchesCount ?? '—'}</span>
            <span class="mm-stats-label">断线保留对局</span>
          </div>
          <button type="button" class="mm-refresh-btn" onClick=${fetchRooms} disabled=${loading}>
            <${Icon} name="refresh" class=${loading ? 'is-spinning' : ''} />
            <span>刷新</span>
          </button>
        </div>

        ${data.partial ? html`<p>部分节点暂未连通，当前列表可能不完整。</p>` : null}
        <div class="mm-room-list">
          ${data.rooms && data.rooms.length > 0
            ? data.rooms.map((r) => html`<div key=${`${r.node || ''}:${r.code}`} class=${`mm-room-card${isCrisisRoom(r)?' is-crisis':''}`}>
                <div class="mm-room-code num">${r.publicCode || r.code}</div>
                <div class="mm-room-info">
                  <div class="mm-room-name"><${RoomTitle} room=${r} name=${r.name || `同盟 #${r.code}`} className="mm-room-title"/>${isOwnerName(r.hostName || r.name) ? html`<span class="mm-owner-badge" title="服主" style="display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding:2px 6px;border:1px solid #e4bd60;color:#e4bd60;font-size:11px;line-height:1.4;white-space:nowrap;vertical-align:middle"><${Icon} name="crown" />服主</span>` : null}</div>
                  <div class=${`mm-room-policy${r.allowReverse === true ? ' is-on' : ''}`}>${reversePolicyLabel(r)}</div>
                  <${CrisisRoomBadge} room=${r}/><div class="mm-room-meta">
                    <span class="mm-room-diff" style=${`--d-color:${DIFFICULTY_COLORS[difficultyTheme(r.difficulty)] || 'var(--mint)'}`}>
                      <${DifficultyIcon} difficulty=${r.difficulty} class="diff-glyph" />
                      <span>${difficultyName(r.difficulty) || r.difficulty}</span>
                    </span>
                    ${r.random ? html`<span class="mm-room-rm">无限火力 · 1.1 · ${r.variant === 'endurance' ? '持久鏖战' : r.variant === 'marathon' ? '最长时赛' : '快速突袭'}</span>` : null}
                    <span class="mm-room-players">
                      <${Icon} name="users" />
                      <span class="num">${r.humans} / ${r.maxSeats || MAX_SEATS}</span>
                    </span>
                    <span class=${`mm-room-status ${r.inMatch ? 'is-in-match' : 'is-waiting'}`}>
                      ${r.inMatch ? '进行中' : '等待中'}
                    </span>
                  </div>
                </div>
                <div class="mm-room-actions">
                  <${Button}
                    variant="primary"
                    size="md"
                    icon="users"
                    class=${`mm-btn-join ${r.inMatch ? 'is-disabled-match' : ''}`}
                    disabled=${r.inMatch}
                    onClick=${() => { onClose(); onJoin(r.code,r.node); }}>
                    加入
                  <//>
                  <${Button}
                    variant="secondary"
                    size="md"
                    icon="eye"
                    class="mm-btn-spectate"
                    onClick=${() => { onClose(); onSpectate(r.code,r.node); }}>
                    观战
                  <//>
                </div>
              </div>`)
            : html`<div class="mm-room-empty">
                <${Icon} name="search" />
                <span>暂无公开同盟房间，可创建同盟或使用快速匹配</span>
              </div>`
          }
        </div>

        <footer class="mm-modal__foot">
          <div class="mm-foot-tag"><${MicroLabel}>AUTO-REFRESH 8S<//></div>
          <div class="mm-foot-text">列表每 8 秒自动刷新；断线保留对局不计入活跃房间及进行中对局，观战不占博士席位。</div>
        </footer>
      </div>
    </div>
  </div>`;
}

/** Lobby screen component. */
export function LobbyScreen() {
  const localMatchmakingCounts = useStore(s => s.presence.matchmaking);
  const [unifiedMatchmaking,setUnifiedMatchmaking]=useState(null);
  const matchmakingCounts=federationEnabled?unifiedMatchmaking:localMatchmakingCounts;
  const me = useStore((s) => s.me, shallowEqual);
  const testModeOn = useStore((s) => s.testMode === true);
  const conn = useStore((s) => s.connection, shallowEqual);
  useData('config');
  const [simulation, setSimulation] = useState(lobbySimulationPreference);
  const [preferredLevel, setDifficulty] = useState(() => preferredDifficulty(lobbySimulationPreference()));
  const [fpVariant, setFpVariant] = useState(firepowerVariantPreference);
  const roomMode = simulation === 'solo' ? 'solo' : 'coop';
  const offered = availableDifficulties(roomMode);
  const difficulty = offered.includes(preferredLevel) ? preferredLevel : offered[0];
  const randomMode = simulation === 'firepower';
  const variant = randomMode ? fpVariant : 'blitz';
  const [code, setCode] = useState('');
  const [privateRoom, setPrivateRoom] = useState(false);
  const [busy, setBusy] = useState(null);
  const [recent] = useState(recentRooms);
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  useEffect(() => () => { alive.current = false; }, []);

  const resourcesReady = useStore((s) => !s.session.preloadRequired || s.session.preloadReady);
  const restoring = useStore((s) => !!s.ui.restoring);
  const online = conn.status === 'online' && resourcesReady && !restoring;
  useEffect(()=>{
   if(!federationEnabled||!online)return;
   let cancelled=false,busy=false;
   const poll=async()=>{if(document.hidden||busy)return;busy=true;try{const d=await federationCounts();if(!cancelled)setUnifiedMatchmaking(d.unifiedQueue||null);}catch{if(!cancelled)setUnifiedMatchmaking(null);}finally{busy=false;}};
   poll();const timer=setInterval(poll,3000);return()=>{cancelled=true;clearInterval(timer);};
  },[online]);
  const codeOk = CODE_RE.test(code);
  const mm = useStore((s) => s.matchmaking, shallowEqual);
  const maint = useStore((s) => s.maintenance, shallowEqual);
  const [modalOpen, setModalOpen] = useState(() => new URLSearchParams(location.search).has('modal'));
  const lobbyStats = useStore((s) => s.lobbyStats, shallowEqual);
  const [onlineCount, setOnlineCount] = useState(() => lobbyStats?.online ?? 1);
  const [rooms, setRooms] = useState(() => (federationEnabled ? [] : lobbyStats?.rooms ?? []));
  const [roomsRefreshing, setRoomsRefreshing] = useState(false);
  const roomsRequest = useRef(false);
  const bg = useHubBackdrop();
  const [bgOpen, setBgOpen] = useState(false);
  const [sweepOpen, setSweepOpen] = useState(false);
  // The Android shell can ask the local network who hosts a key, so a guest never types an address: the code is enough.
  const nativeShell = globalThis.AndroidNative?.isNativeApp?.() ? globalThis.AndroidNative : null;
  const [lanRoom, setLanRoom] = useState(null);
  const [lanNote, setLanNote] = useState('');
  useEffect(() => {
    if (!nativeShell || roomMode !== 'coop' || !codeOk) { setLanRoom(null); return undefined; }
    let cancelled = false;
    setLanRoom(null);
    setLanNote('正在局域网中查找该房间…');
    globalThis.__onRoomFound = (list) => {
      if (cancelled) return;
      const host = (list || []).find((h) => !h.self);
      if (host) { setLanRoom(host); setLanNote(`已找到房主 ${host.ip}（${host.humans || 0} 人在房）· 点「加入同盟」进入`); }
      else setLanNote('局域网里没有这个房间：确认房主已创建同盟模拟房间，且两台设备在同一网络');
    };
    nativeShell.findRoom(code);
    return () => { cancelled = true; delete globalThis.__onRoomFound; };
  }, [code, roomMode]);
  const isSearching = mm?.status === 'searching';

  useEffect(() => {
    if (!federationEnabled && lobbyStats && Number.isFinite(lobbyStats.online)) {
      setOnlineCount(lobbyStats.online);
    }
  }, [lobbyStats?.online]);
  useEffect(() => {
    if (!federationEnabled && Array.isArray(lobbyStats?.rooms)) setRooms(lobbyStats.rooms);
  }, [lobbyStats?.rooms]);

  const refreshRecruitRooms = async (manual = false, isCurrent = () => true) => {
    if (!online || roomsRequest.current) return;
    roomsRequest.current = true;setRoomsRefreshing(true);
    try {
      // Explicit refresh bypasses the federation's short-lived browser cache.
      const res = manual && federationEnabled ? await federationRooms(true) : await net.request('room.list');
      if (!res?.ok || !Array.isArray(res.rooms)) throw new Error(t('同盟列表刷新失败，请稍后重试'));
      if (!alive.current || !isCurrent()) return;
      if (Number.isFinite(res.online)) setOnlineCount(res.online);
      setRooms(res.rooms);
      if (manual) toast(t(res.partial ? '部分节点暂不可用，已更新可用同盟' : '同盟列表已刷新'), res.partial ? 'warn' : 'info');
    } catch (error) {
      // Keep the previous list visible on transient failures.
      if (manual && alive.current && isCurrent()) toastError(error);
    } finally {
      roomsRequest.current = false;
      if (alive.current) setRoomsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!online) return undefined;
    let cancelled = false;
    const poll = () => { if (!document.hidden) refreshRecruitRooms(false, () => !cancelled); };
    poll();
    const timer = setInterval(poll, 15000);
    document.addEventListener('visibilitychange', poll);
    return () => { cancelled = true;clearInterval(timer);document.removeEventListener('visibilitychange', poll); };
  }, [online]);

  const pickMode = (m) => {
    if (!MODE_CARDS.some((c) => c.id === m)) return;
    // Normal modes share their difficulty; firepower remembers its own explicitly chosen difficulty.
    if ((m === 'firepower') !== randomMode) setDifficulty(preferredDifficulty(m));
    setSimulation(m);
    savePref('lobby.simulation', m);
    savePref('lobby.mode', m === 'solo' ? 'solo' : 'coop');
    savePref('lobby.random', m === 'firepower');
  };
  const pickDifficulty = (d) => {
    setDifficulty(d);
    savePref(randomMode ? 'lobby.firepowerDifficulty' : 'lobby.difficulty', d);
  };

  const run = async (kind, fn) => {
    if (inFlight.current) return;
    if (!online) { toast(t('尚未连接到服务器，请稍候'), 'warn'); return; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };
  const pickVariant = (v) => {
    setFpVariant(v);
    savePref('lobby.firepowerVariant', v);
  };

  // SP-TESTMODE-20261102: only the test node sends welcome.testMode; then every room is a test room on this node.
  const create = () => run('create', () => net.request('room.create', { mode: roomMode, difficulty, version: lobbyVersion(store.get()), random: randomMode, private: roomMode !== 'solo' && privateRoom, ...(randomMode ? { variant } : {}), ...(store.get().testMode === true ? { test: true, federationDirect: true } : {}) }));
  const queueMatch = () => run('queue', () => net.request('match.queue', { mode: roomMode, difficulty, version: lobbyVersion(store.get()), random: randomMode, ...(randomMode ? { variant } : {}), fillBots: false }));
  const cancelMatch = () => run('cancel', () => net.request('match.cancel'));
  const join = (c = code, federationNode) => {
    // `onClick=${join}` hands the click EVENT as the first argument, and a default parameter only applies to
    // `undefined` — codeArg keeps an event target out of the key and falls back to the input field
    const k = codeArg(c, code);
    if (!CODE_RE.test(k)) { toast(`请输入 5 位统一房间码（兼容旧的 4 位密钥）`, 'warn'); return; }
    // A room found on another phone is a different origin: hand the WebView over to it instead of asking the
    // server we are on, which by definition does not have that room.
    if (nativeShell && lanRoom) {
      nativeShell.connectToHost(lanRoom.ip, k);
      setLanNote(`正在进入 ${lanRoom.ip} 的房间…`);
      return;
    }
    run('join', () => net.request('room.join', { code: k, ...(federationNode ? { federationNode } : {}) }));
  };
  // a spectator seat: no player seat taken, nothing to do but watch (also a match already running)
  const spectate = (c = code, federationNode) => {
    // same guard as join: `onClick=${spectate}` passes the click event, not a code
    const k = codeArg(c, code);
    if (!k) { toast(`请输入 5 位统一房间码（兼容旧的 4 位密钥）`, 'warn'); return; }
    run('spectate', () => net.request('room.spectate', { code: k, ...(federationNode ? { federationNode } : {}) }).catch((err) => {
      // Clearer than the bare ERR_TEXT: the usual cause is a code that is not the host's (a remembered one from an
      // earlier room, or another machine's) — the server can only answer "no such room".
      if (err?.code === ERR.ROOM_NOT_FOUND) {
        toast(t('没有找到密钥 {k} 对应的同盟：请和房主核对密钥（同盟结束后密钥即失效）', { k }), 'warn');
        return;
      }
      if (err?.code === ERR.ALREADY) {
        toast(t('你已经是该同盟的博士：先离开同盟，才能以观战身份进入'), 'warn');
        return;
      }
      throw err;
    }));
  };
  // 业主 2026-11-21「粘贴邀请即进房」：主题化后密钥输入框被收进「密钥加入」弹层，先粘贴、再找输入框很别扭。
  // 所以大厅里直接 Ctrl+V 也走同一条路：焦点不在输入框时接管，取到 ?room= 就进房。输入框那两处自己处理。
  const joinRef = useRef(join);
  joinRef.current = join;
  useEffect(() => {
    const onPaste = (e) => {
      const tgt = e.target;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      const text = e.clipboardData ? e.clipboardData.getData('text') : '';
      if (!looksLikeInviteLink(text)) return;   // 背景粘贴只认邀请链接，免得把普通 4 字词当成密钥
      const pasted = codeFromPastedText(text);
      if (!pasted) return;                      // 有链接但没有 room=：不接管这次粘贴
      e.preventDefault();
      setCode(pasted);
      joinRef.current(pasted);
    };
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
  }, []);
  const backToTitle = () => {
    identity.setEntered(false);
    store.set((s) => ({ session: { ...s.session, entered: false } }));
  };
  // hub dialogs: the start sheet of a picked mode, 密钥加入 (opened by an invite code in the URL too)
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetPurpose, setSheetPurpose] = useState('create'); // 'create' | 'search' (搜寻队友)
  const [allyOpen, setAllyOpen] = useState(false);            // 选择同盟方式
  const [sheetChained, setSheetChained] = useState(false);    // opened from 选择同盟方式: no darkening of the hub between
  const [joinOpen, setJoinOpen] = useState(false);
  const [achOpen, setAchOpen] = useState(false);
  const prog = useHubProgress();
  const barRef = useRef(null);
  const toolsFolded = useToolsFold(barRef);
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => {
    if (!toolsOpen) return undefined;
    const away = (e) => { if (!barRef.current?.contains(e.target)) setToolsOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setToolsOpen(false); };
    document.addEventListener('pointerdown', away, true); addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away, true); removeEventListener('keydown', esc); };
  }, [toolsOpen]);
  // 同盟模拟 → 选择同盟方式; 独立模拟 / 无限火力 → 选择模拟协议
  const openMode = (m) => { pickMode(m); if (m === 'coop') setAllyOpen(true); else { setSheetPurpose('create'); setSheetChained(false); setSheetOpen(true); } };
  const openSearch = () => { pickMode('coop'); setSheetChained(allyOpen); setAllyOpen(false); setSheetPurpose('search'); setSheetOpen(true); };
  const modeCard = MODE_CARDS.find((c) => c.id === simulation) || MODE_CARDS[0];

  // 独立模拟停放（业主 2026-11-14）：进大厅查一次「24 小时内可继续」的房间；
  // 有的话开始界面只剩「继续游戏」「结束模拟」，并藏掉所有别的开局入口。
  const [parked, setParked] = useState(null);
  const loadParked = () => {
    fetch('/api/solo/parked', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setParked((j && j.parked) || null))
      .catch(() => {});
  };
  useEffect(() => { loadParked(); }, []);
  const resumeParked = async () => {
    if (!parked) return;
    // 暂离（kind=away）：服务端还留着座位与对局，发 room.unpark 回到那一局。
    // 之后**主动重载页面**：新连接用同一身份令牌 hello，服务端走 resumed 分支做完整 resync
    // （match.onReconnect + m.public + m.private）—— 直接切视图时战斗/选策略界面会一直等状态而卡在加载
    // （业主 2026-11-14「在选择策略界面退出重进会卡死在加载」）。
    if (parked.kind === 'away') {
      try { await net.request('room.unpark', {}); } catch (e) { toastError(e); loadParked(); return; }
      try { globalThis.location.reload(); } catch { /* ignore */ }
      return;
    }
    // 备战阶段停放（kind=parked）：按房间号回房
    try { await net.request('room.join', { code: parked.code }); setParked(null); }
    catch (e) { toastError(e); loadParked(); }
  };
  const endParked = async () => {
    if (!parked) return;
    // 结束模拟要确认（业主 2026-11-14）：以当前进度结算，结果记为失败。
    // 业主 2026-11-17：**只弹一次**（上一版加的第二道确认看起来像"又出现一次结束模拟"，撤掉），
    // 但把标题/按钮写清楚是"判负"，避免和「继续游戏」误触。
    const ok = await confirmDialog({
      title: t('结束模拟（判负）'),
      text: t('将以当前进度结算本局，结果记为失败，房间会被关闭且无法恢复。确定结束模拟吗？'),
      okText: t('结束并判负'),
      danger: true,
    });
    if (!ok) return;
    try {
      // 留在 lobby 接服务端推来的结算帧（实测这条能弹出结算界面）；
      // 不切回对局视图 —— 那会先进战斗加载页，反而卡住。
      await net.request('room.endParked', {});
      setParked(null);
    } catch (e) { toastError(e); loadParked(); }
  };

  // 卫戍协议：盟约 主界面 (2026-10-27, owner: 「完全复刻」 the event recording): ui/officialHub.js draws the official lobby;
  // the page's own tools (设置 / 录像 / 背景 / 全屏 / 音乐 / 反馈 / 公告 / 密钥 / 好友 / 账号) sit in rows at the top right.
  // Left out on the owner's word (same day): 首页 / ⓘ / the 关键目标 medal / the 防卫目标刷新 clock / 报酬说明 /
  // 每日防卫目标 / 关键目标 / 功勋兑换处 (this server has no 卫戍认证 rewards).
  return html`<div class="screen lobby-screen lobby-hub lobby-hub--official" data-hub-theme=${backdropTheme(bg)}>
      ${testModeOn ? html`<div class="sp-testmode-banner" data-testid="testmode-banner" role="status" style="position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:50;padding:6px 14px;border:1px solid #e4bd60;background:rgba(20,16,8,.88);color:#e4bd60;font-size:13px;letter-spacing:.04em;pointer-events:none"><${Icon} name="crown" /> ${t('测试模式 · 仅服主账号')} · ${t('房间均为测试对局，不计入等级与排行；对局内按 ` 打开「测试」面板设置资金（上限 99999）')}</div>` : null}
    <${HubBackdrop} bg=${bg} />
    <header ref=${barRef} class=${`topbar hub-topbar oh-topbar${toolsFolded ? ' oh-topbar--folded' : ''}${toolsFolded && toolsOpen ? ' oh-topbar--open' : ''}`}>
      <div class="topbar__left">
        <span class="lobby-connection" role="status" title=${t('网络延迟')}><${Icon} name="signal"/>${online ? Number.isFinite(conn.ping) ? `${Math.round(conn.ping)} ms` : t('已连接') : t('连接中')}</span>
        <${Button} variant="secondary" size="sm" square=${true} icon="dots" class="oh-tools-toggle" aria-expanded=${toolsOpen ? 'true' : 'false'}
          onClick=${() => setToolsOpen((v) => !v)} title=${t('更多')} aria-label=${t('更多')} />
        <div class="topbar__tools">
          <${SettingsButton} class="lobby-settings" variant="secondary" square=${true} />
          <${DemoButton} class="lobby-guide" variant="secondary" square=${true} />
          <${Button} variant="secondary" size="sm" square=${true} class="hub-bg-btn" onClick=${() => setBgOpen(true)}
            title=${t('大厅背景')} aria-label=${t('大厅背景')}><${BackdropGlyph} /><//>
          <${HubFullscreenButton} />
          <${LobbyMusicButton} />
          <${FeedbackButton} /><${NoticeButton} />
          <${Button} variant="secondary" size="sm" square=${true} icon="key" onClick=${() => setJoinOpen(true)} title=${t('密钥加入')} aria-label=${t('密钥加入')} />
          <${PwaInstallButton} class="lobby-pwa" square=${true} />
        </div>
      </div>
      <div class="topbar__right">
        <div class="ui-theme-friend-stack"><${FriendsTile} /><${UIThemeButton} /></div>
        <${VersionSwitch} /><${Button} variant="secondary" size="sm" onClick=${() => window.open('/minigames/wisadel-bowling/index.html','_blank','noopener')}>娱乐小游戏<//>
        <span class="hub-online"><span class="online-pill__dot"></span><span class="num">${onlineCount}</span><span>${t('名博士在线')}</span></span>
        <${ResumeMatchButton} />
        <${AccountMeChip} player=${me} onStats=${openStats} />
      </div>
    </header>

    <main class="oh-layer">
      <${HubNav} onBack=${backToTitle} home=${false} backLabel=${t('返回标题')} />
      <${HubLogo} />

      <${HubAchCard} trophies=${prog.trophies} guest=${prog.source !== 'account'} onOpen=${() => setAchOpen(true)} />
      <div class="oh-extra"><${CrisisEventCard} /></div>

      <${HubPlate} kind="sweep" label="S.W.E.E.P.报告" onClick=${() => setSweepOpen(true)} />
      <${HubPlate} kind="pool" label=${t('物资调配处')} onClick=${() => openLoadout('lobby')} />
      <${HubInvite} count=${recruitingRooms(rooms).length} onClick=${() => setModalOpen(true)} />
      <button type="button" class="oh-fire" onClick=${() => openMode('firepower')} title="无限火力">无限火力<b class="num">1.1</b></button>

      <div class="oh-status">
        ${isSearching ? html`<div class="matchmaking-hud brackets hub-searching">
            <div class="matchmaking-hud__info">
              <${Spinner} size="sm" />
              <span class="matchmaking-hud__text">正在匹配同盟 (${mm?.matched || 1}/${mm?.target || 4})...</span>
              <span class="matchmaking-hud__time num">${String(Math.floor((mm?.elapsed || 0) / 60)).padStart(2, '0')}:${String((mm?.elapsed || 0) % 60).padStart(2, '0')}</span>
            </div>
            <${Button} variant="danger" size="md" loading=${busy === 'cancel'} onClick=${cancelMatch}>取消匹配<//>
          </div>` : null}
        ${maint?.active ? html`<div class="hub-maint">${t('服务器即将维护，暂停开启新的模拟')}</div>` : null}
      </div>
      ${parked ? html`<${ParkedSoloEntries} parked=${parked} busy=${busy} onResume=${resumeParked} onEnd=${endParked} />`
        : html`<${HubEntries} onSolo=${() => openMode('solo')} onCoop=${() => openMode('coop')} onSearch=${openSearch} coopCount=${matchmakingCounts?.total} />`}
    </main>

    ${sheetOpen ? html`<${ProtocolSelect} card=${modeCard} roomMode=${roomMode} random=${randomMode} variant=${variant} difficulty=${difficulty}
      onDifficulty=${pickDifficulty} onClose=${() => setSheetOpen(false)} matchmaking=${matchmakingCounts}
      brief=${randomMode ? html`<${FirepowerBrief} variant=${fpVariant} onVariant=${pickVariant} />` : null}
      privateRoom=${privateRoom} onPrivate=${setPrivateRoom} online=${online} maint=${maint} busy=${busy} isSearching=${isSearching}
      onCreate=${create} onQueue=${async () => { await queueMatch(); setSheetOpen(false); }}
      purpose=${sheetPurpose} onSearch=${queueMatch} onCancel=${cancelMatch} mm=${mm} onBrowse=${() => setModalOpen(true)} chained=${sheetChained} />` : null}

    ${allyOpen ? html`<${AllianceSelect} onClose=${() => setAllyOpen(false)} code=${code} onCode=${(v) => setCode(normalizeCode(v))} codeOk=${codeOk}
      recent=${recent} online=${online} maint=${maint} busy=${busy} difficulty=${difficulty} recruiting=${recruitingRooms(rooms).length}
      onCreate=${create} onJoin=${(c) => join(typeof c === 'string' ? c : undefined)} onSpectate=${() => spectate()} onBrowse=${() => setModalOpen(true)} onSearch=${openSearch} />` : null}

    <${HubDialog} open=${joinOpen} micro="JOIN WITH ALLIANCE KEY" title=${t('密钥加入')} onClose=${() => setJoinOpen(false)}>
      <div class="join-row">
        <${TextField} size="code" icon="key" value=${code} placeholder=${t('输入同盟密钥 / 粘贴邀请链接')}
          transform=${normalizeCode} onInput=${(v) => setCode(normalizeCode(v))} onEnter=${() => join()}
          onPaste=${(e) => {
            // 粘贴整段邀请链接 → 取出 ?room= → 直接进房（业主 2026-11-21 的口径，主题化时丢了，2026-11-28 补回）
            const text = e && e.clipboardData ? e.clipboardData.getData('text') : '';
            const pasted = codeFromPastedText(text);
            if (!pasted) return;
            e.preventDefault();
            setCode(pasted);
            join(pasted);
          }} />
      </div>
      <div class="join-row hub-join__buttons">
        <${Button} variant="amber" size="lg" icon="users" loading=${busy === 'join'} disabled=${!codeOk || !online} onClick=${() => join()}>${t('加入同盟')}<//>
        <${Tooltip} text=${t('以观战者身份进入：不占博士席位，只能观看（每个同盟最多 {MAX_SPECTATORS} 名，模拟进行中也可进入）', { MAX_SPECTATORS })}>
          <${Button} variant="secondary" size="lg" icon="eye" class="join-spectate" loading=${busy === 'spectate'} disabled=${!codeOk || !online} onClick=${spectate}>${t('观战')}<//>
        <//>
      </div>
      ${lanNote && nativeShell ? html`<p class="t-dim">${lanNote}</p>` : null}
      <div class="join-foot">
        ${recent.length ? html`<span class="t-lo">${t('最近的同盟')}</span>
          ${recent.map((c) => html`<button key=${c} type="button" class="code-chip num" title=${t('填入密钥（不会直接加入）')}
            onClick=${() => setCode(c)}>${c}</button>`)}`
          : html`<span class="t-dim">${t('向同伴索取 {ROOM_CODE_LEN} 位同盟密钥，或直接打开邀请链接', { ROOM_CODE_LEN })}</span>`}
      </div>
    <//>

    <${HubDialog} open=${bgOpen} micro="LOBBY BACKDROP" title=${t('大厅背景')} onClose=${() => setBgOpen(false)}>
      <${BackdropSettings} bg=${bg} />
    <//>

    <${MatchmakingModal} open=${modalOpen} onClose=${() => setModalOpen(false)} onJoin=${join} onSpectate=${spectate} />
    ${achOpen ? html`<${AchievementPanel} me=${me} onClose=${() => setAchOpen(false)} />` : null}
    ${sweepOpen ? html`<${SweepReport} onClose=${() => setSweepOpen(false)} />` : null}
  </div>`;
}

export async function joinKnown(type,key){return net.request(type,{code:key});}
