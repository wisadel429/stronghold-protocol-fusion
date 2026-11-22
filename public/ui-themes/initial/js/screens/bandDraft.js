// Band draft — BAND_DRAFT "2/2 选择策略" (research 06 §4.2, D1): left = draft order (avatar, name, state:
// … waiting / ⌛ 决策中 / chosen band ✓), current picker highlighted; centre = grid of every band allowed
// for the mode type; a band a teammate already picked is marked 已被选择 — it cannot be chosen again (research 09 §5,
// guidebook 策略与轮选; the server refuses it too); right = detail pane (icon, 初始生命值, name, effect name + rich
// description) with 确认选择; 跳过选择 (co-op, once) in the header.
// One countdown (user playtest #4 item 4): every turn has the same clock (Match BAND_TURN_SECONDS, m.public.draft
// turnSeconds) and the step header counts it down — m.public.deadline IS the turn's end. The highlighted band is what a
// turn that runs out takes: every change of it is reported (g.bandFocus) and the server assigns it while it is free, else
// 「华法琳」, else the first free strategy (timeoutBand). It starts on that default, so the tip under the order list always
// names what a timeout gives.
// Solo, and a co-op match with a single human (the server's soloUntimed: draft.untimed): no clock at all.
// A strategy built around a bond the mode switches off (bands.json bondIds ∩ the mode's inactive bonds — 标准: 潘格尼尼
// 拉特兰, 克莱门莎 阿戈尔, 玛恩纳 卡西米尔; the bot never picks one) reads 本局禁用 on its card and in the detail pane
// (BandOffTag / BandOffNote, DESIGN §21.26, §21.7's look); it stays selectable — information only.
// 本局信息 (GitHub issue #8 item 1, "选策略时没法返回查看禁用的干员和盟约"): the header's 本局信息 opens the briefing's bond
// rows, legend and 本局禁用干员 again, read-only (ui/matchInfo.js MatchInfoDialog — the very blocks of the briefing). The
// draft runs on underneath: its status line repeats the current turn and the countdown (draftInfoStatus), a turn change
// (a pick, a skip, a turn that runs out, an AI pick) closes it, the end of the draft unmounts it, and it never touches the
// highlighted band or the buttons.
// 2026-10-13 (the owner's request: the event's pre-game, video 6:29–7:51): the event's layout and motion. The header
// says whose turn it is (👆 请选择策略 over 跳过选择 / 无法跳过, X 正在选择策略…, 策略选择完成 · 正在进入模拟…); the order
// rows are name cards (the doctor's 名片干员 art — screens/room.js seatPortrait — avatar, name #tag) with the strategy box
// beside them (⌛ 决策中, •••, or the picked strategy with 🔍 — it opens that strategy) and ✓ outside; the grid is a 4-wide
// wall of portraits (已被选择 across a taken one, an orange mark on a strategy this browser has cleared a run with —
// ui/stats.js); the detail pane slides in only once a portrait is tapped (the order list narrows); after the pick the
// grid gives way to 已选定策略 and a beam runs along the picker's row. Each time a pick becomes the player's, the
// 「请选择策略」 band sweeps across (ui/turnBanner.js TurnBanner; until 2026-10-27 ui/matchIntro.js's drawn one, whose
// .tbanner* classes collided with protocol-boot.css's — the grey slab with a dark box and no art).

import { useEffect, useMemo, useRef, useState } from '/vendor/hooks.module.js';
import { html, Button, Icon, useTicker, secondsLeft } from '/js/ui/components.js';
import { useGameData, BandIcon, RichText, PlayerAvatar, Sprite } from '/js/ui/gameComponents.js';
import { StepHeader, ExitModal } from '/js/ui/matchChrome.js';
import { MatchInfoDialog, matchInfoModel } from '/js/ui/matchInfo.js';
import { TurnBanner } from '/js/ui/turnBanner.js'; // round 6: the sprite band (protocol-boot.css .tbanner), not matchIntro.js's drawing
import { useRise } from '/js/ui/transitions.js';
import { AccountTag, useAccount } from '/js/ui/accounts.js';
import { NameCardLayer } from '/js/ui/namecards.js';
import { TrophyBadge } from '/js/ui/trophies.js';
import { cardOperators, seatPortrait, CARD_PREF } from '/js/ui/seatArt.js';
import { aggregateStats } from '/js/ui/stats.js';
import { currentRecords } from '/js/ui/cloudStats.js';
import { actions, act } from '/js/ui/gameActions.js';
import { normalizeDraft, pendingDraftPlayers, sortedPlayers } from '/js/ui/gameLogic.js';
// 官方 / 炸惊 / 湮灭 三态的盟约过滤（本局信息弹窗）
import { officialBonds } from '/js/ui/zjView.js';
import { useStore, loadPref } from '/js/store.js';
import { data } from '/js/data.js';
import { audio } from '/js/audio.js';
import { modeOffBonds, bandOffBonds, bandOffLine } from '/js/ui/gameLogic.js';
import { t, tParts } from '/shared/i18n.js';
import { officialBands } from '/js/ui/zjView.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** 本局禁用 on a strategy card whose bonds `names` the mode switches off (bandOffBonds); nothing otherwise. */
export function BandOffTag({ names = [] }) {
  return names.length ? html`<span class="dband__off" title=${bandOffLine(names)}>${t('本局禁用')}</span>` : null;
}

/** The detail pane's note for such a strategy: "本局禁用【拉特兰】盟约，此策略效果可能无法发挥" (the bond names struck through). */
export function BandOffNote({ names = [] }) {
  if (!names.length) return null;
  return html`<p class="draft-detail__off" role="note" aria-label=${bandOffLine(names)}><${Icon} name="info" /><span>${tParts('本局禁用{names}盟约，此策略效果可能无法发挥', { names: names.map((n, i) => html`<span key=${i}>${tParts('【{name}】', { name: html`<s class="draft-detail__offname">${n}</s>` })}</span>`) })}</span></p>`;
}

/**
 * Bands selectable in a mode (modeTypeList contains the mode's type), sorted by sortId.
 * @param {any[]} bands
 * @param {string|null} modeType 'SINGLE'|'MULTI'
 */
export function allowedBands(bands, modeType) {
  const sid = (b) => (Number.isFinite(b.sortId) ? b.sortId : 99);
  return (Array.isArray(bands) ? bands : [])
    .filter((b) => b && (!modeType || !Array.isArray(b.modeTypeList) || b.modeTypeList.includes(modeType)))
    .sort((a, b) => sid(a) - sid(b) || (a.bandId < b.bandId ? -1 : a.bandId > b.bandId ? 1 : 0));
}

/** The official default strategy of an automatic assignment (data/config.json bandDraft.timeoutBandId). */
export const DEFAULT_TIMEOUT_BAND = 'band_bldsk';

/**
 * The strategy the server assigns me when my turn times out (server/match/match/phases.js defaultBand): the official default
 * 「华法琳」 while no teammate holds it, else the first free strategy in draft order (sortId) — never one a teammate
 * already picked (队友已选).
 * @param {any[]} bands allowedBands(...) (sortId order)
 * @param {Map<string, any>} taken teammateBands(...)
 * @param {string} [defaultId]
 * @returns {string|null}
 */
export function timeoutBand(bands, taken, defaultId = DEFAULT_TIMEOUT_BAND) {
  const list = Array.isArray(bands) ? bands : [];
  const has = (id) => !!(taken && typeof taken.has === 'function' && taken.has(id));
  if (defaultId && !has(defaultId) && (!list.length || list.some((b) => b.bandId === defaultId))) return defaultId;
  return list.find((b) => !has(b.bandId))?.bandId || defaultId || null;
}

/**
 * Bands taken by teammates (队友已选): bandId → the picking players (never the viewer).
 * 随机模式: both pick rounds count; the viewer's own second pick shows on the card too (never blocking).
 * @param {Map<string, string>} picks normalizeDraft(...).picks (playerId → bandId)
 * @param {Map<string, string>} picks2 normalizeDraft(...).picks2 (随机模式 second round; may be empty)
 * @param {string} myId
 * @param {boolean} [selfSecond] include my own picks in the map (随机模式 shows them, nothing is taken)
 */
export function teammateBands(picks, myId, picks2 = new Map(), selfSecond = false) {
  const out = new Map();
  const add = (pid, bid) => {
    if (typeof bid !== 'string') return;
    if (pid === myId && !selfSecond) return;
    if (!out.has(bid)) out.set(bid, []);
    out.get(bid).push(pid);
  };
  for (const [pid, bid] of picks instanceof Map ? picks : []) add(pid, bid);
  for (const [pid, bid] of picks2 instanceof Map ? picks2 : []) add(pid, bid);
  return out;
}

/**
 * The band the detail pane shows (= the highlighted band a turn that runs out takes): the current one, else my pick,
 * else the band a timeout would give me (timeoutBand: 「华法琳」 while free, else the first free one). When it is my
 * turn and the shown band was taken meanwhile (队友已选), that default instead (confirm would be disabled).
 * @param {string|null} sel
 * @param {{ bands: any[], taken: Map<string, any>, myPick: string|null, myTurn: boolean, defaultId?: string }} o
 */
export function draftSelection(sel, { bands, taken, myPick, myTurn, defaultId = DEFAULT_TIMEOUT_BAND }) {
  if (!Array.isArray(bands) || !bands.length) return sel;
  const free = timeoutBand(bands, taken, defaultId) || bands[0].bandId;
  if (!sel) return myPick || free;
  if (!myPick && myTurn && taken.has(sel)) return free;
  return sel;
}

/**
 * The strategy a turn that runs out assigns me (server Match.timeoutBand): the highlighted band while it is one of
 * the mode's and no teammate holds it, else timeoutBand. Null after my pick.
 * @param {string|null} sel the highlighted band
 * @param {{ bands: any[], taken: Map<string, any>, myPick?: string|null, defaultId?: string }} o
 */
export function autoPickBand(sel, { bands, taken, myPick = null, defaultId = DEFAULT_TIMEOUT_BAND }) {
  if (myPick) return null;
  const list = Array.isArray(bands) ? bands : [];
  const has = (id) => !!(taken && typeof taken.has === 'function' && taken.has(id));
  if (sel && !has(sel) && list.some((b) => b.bandId === sel)) return sel;
  return timeoutBand(list, taken, defaultId);
}

/**
 * The tip under the co-op draft order: the one skip, the turn clock and what a turn that runs out assigns me (the
 * highlighted band while free — autoPickBand). Untimed drafts (a single human) name no clock.
 * 随机模式: two picks named (第 1/2 个策略), no strategy is ever off-limits (队友已选 does not apply).
 * @param {{ timed: boolean, turnSeconds?: number|null, autoName?: string|null, selected?: boolean, round?: number,
 *   rounds?: number, random?: boolean }} o
 *   selected: the auto pick is the highlighted band (not the default standing in for a band a teammate holds)
 */
export function draftTip({ timed, turnSeconds = null, autoName = null, selected = true, round = 1, rounds = 1, random = false }) {
  const skip = '联合模拟在选择策略时可以进行一次跳过';
  const which = random && rounds > 1 ? `（第 ${Math.min(round, rounds)}/${rounds} 个策略，可选重复叠加）` : '';
  if (!timed) return `${skip}${which}；本局不限时`;
  const clock = Number(turnSeconds) > 0 ? `每位博士有 ${Math.round(turnSeconds)} 秒` : '每位博士限时决策';
  if (!autoName) return `${skip}${which}；${clock}`;
  return `${skip}${which}；${clock}，超时将自动选择${selected ? '当前选中的' : ''}「${autoName}」`;
}

/**
 * The step header's countdown during the draft: the current turn's (m.public.deadline = draft.turnDeadline) with a
 * turn's length as the gauge total — null when the draft is untimed.
 * @param {any} pub m.public
 * @returns {{ deadline: number, total: number|null } | null}
 */
export function draftClock(pub) {
  const d = pub && typeof pub.draft === 'object' ? pub.draft : null;
  if (!d || d.untimed) return null;
  const deadline = Number(pub.deadline) > 0 ? Number(pub.deadline) : Number(d.turnDeadline) || 0;
  if (!(deadline > 0)) return null;
  return { deadline, total: Number(d.turnSeconds) > 0 ? Number(d.turnSeconds) : null };
}

/**
 * The status line of the 本局信息 dialog: what the draft does while the dialog covers it — my pick, else whose turn it is
 * with the turn's seconds left (the step header's number; none when untimed), warning at ≤ 10 s like the countdown.
 * @param {{ myPick?: string|null, pickName?: string|null, myTurn: boolean, turnName?: string|null, secs?: number|null,
 *   waiting?: boolean }} o waiting: teammates still have to pick after my pick
 * @returns {{ text: string, secs: number|null, tone: 'mint'|'gold'|'warn'|'dim' }}
 */
export function draftInfoStatus({ myPick = null, pickName = null, myTurn, turnName = null, secs = null, waiting = false }) {
  if (myPick) return { text: `${t('已选择「{name}」', { name: pickName || '' })}${waiting ? t('，等待其他博士') : ''}`, secs: null, tone: 'mint' };
  const s = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : null;
  const tone = s != null && s <= 10 ? 'warn' : 'gold';
  if (myTurn) return { text: t('轮到你决策'), secs: s, tone };
  return { text: turnName ? t('{turnName} 决策中', { turnName }) : t('等待轮到你'), secs: s, tone: s != null ? tone : 'dim' };
}

/** 已通过模拟 N 次: the runs won with each strategy (the account's records when logged in, else this browser's) — bandId → wins. */
function clearedByBand() {
  try {
    const bands = aggregateStats(currentRecords().records).bands || {};
    return Object.fromEntries(Object.entries(bands).map(([id, b]) => [id, b.wins | 0]).filter(([, n]) => n > 0));
  } catch { return {}; }
}

/** 「【effect】 description」 of a strategy (the data's description usually opens with the 【effect】 already). */
function BandText({ band, class: cls }) {
  const text = band.descRaw || band.desc || '';
  const head = band.effectName && !String(text).includes(`【${band.effectName}】`) ? `【${band.effectName}】` : '';
  return html`<p class=${cls}>${head}<${RichText} text=${text} /></p>`;
}

/**
 * One doctor of the draft order: the name card (the account's 名片 when it has one — the owner, 2026-10-14: the room's
 * 名片干员 art covered it, so it shows only without one —, avatar, name #tag, state), the strategy box (⌛ 决策中 / •••
 * / the pick with 🔍, which opens it) and ✓ outside it; a beam runs along the row when the pick lands (useRise).
 * @param {{ p: any, i: number, picks: string[], rounds: number, random: boolean, cur: boolean, self: boolean,
 *   art: string|null, gd: any, onPeek: (bandId: string) => void }} props
 */
function OrderRow({ p, i, picks, rounds, random, cur, self, art, gd, onPeek, intent, intentTaken }) {
  const picked = picks[0] || p.bandId || null;
  const shown = picks[picks.length - 1] || picked;
  const flash = useRise(!!picked, 1100);
  const pband = picked ? gd.band(picked) : null;
  const pband2 = picks[1] ? gd.band(picks[1]) : null;
  const acct = useAccount(p.isBot ? null : p.playerId);
  return html`<div class=${cx('dorder', cur && 'is-cur', picked && 'is-done', self && 'is-self', flash && 'is-flash')} style=${`--i:${i}`}>
    <div class=${cx('dorder__card', acct?.card && 'has-nc')}>
      <${NameCardLayer} card=${acct?.card} />
      ${art && !acct?.card ? html`<span class="dorder__art" style=${`background-image:url("${art}")`} aria-hidden="true"></span>` : null}
      <span class="dorder__face"><${PlayerAvatar} player=${p} self=${self} />${self ? html`<span class="dorder__me" title=${t('我')}><${Icon} name="user" /></span>` : null}</span>
      <div class="dorder__text">
        <b class=${`dorder__name${p.admin ? ' is-admin-name' : ''}`}>${p.admin ? html`<i class="admin-star" title=${t('管理员')} aria-hidden="true">★</i>` : null}<${TrophyBadge} count=${acct?.trophies} class="tbadge--inline" /><span>${p.name || t('博士')}</span><${AccountTag} playerId=${p.isBot ? null : p.playerId} />${p.isBot ? html`<span class="dorder__ai">AI</span>` : null}</b>
        <span class="dorder__state">${picked ? html`<span class="t-mint">${pband?.name || t('已选择')}${pband2 ? `、${pband2.name || ''}` : picks.length < rounds && random ? `（${picks.length}/${rounds}）` : ''}</span>`
          : intent ? html`<span class="t-gold">想玩：${gd.band(intent)?.name || intent}${intentTaken ? '（已被选走）' : ''}</span>`
          : cur ? html`<span class="t-gold">${t('决策中')}</span>` : html`<span class="t-dim">${t('等待中')}</span>`}</span>
      </div>
    </div>
    ${shown ? html`<button type="button" class="dorder__box is-band" onClick=${() => onPeek(shown)} title=${t('查看「{name}」', { name: gd.band(shown)?.name || '' })}>
        <${BandIcon} bandId=${shown} size="md" /><${Icon} name="search" class="dorder__zoom" />${picks.length > 1 ? html`<span class="dorder__n num">×${picks.length}</span>` : null}
      </button>`
      : intent ? html`<button type="button" class="dorder__box is-band is-intent" title=${`想玩：${gd.band(intent)?.name || intent}（预标记，不占用）`} onClick=${() => onPeek(intent)} style="outline:1px dashed #e6bc59;opacity:.8"><${BandIcon} bandId=${intent} size="md" /><span style="position:absolute;bottom:0;background:#10221f;font-size:12px">想玩</span></button>`
      : cur ? html`<span class="dorder__box is-cur">${p.isBot ? null : html`<${Icon} name="hourglass" />`}<span>${t('决策中')}</span></span>`
      : html`<span class="dorder__box is-wait"><${Icon} name="dots" /></span>`}
    <span class="dorder__check" aria-hidden="true">${picked ? html`<${Icon} name="check" />` : null}</span>
  </div>`;
}

const SEEN_KEY = 'sp.bandSeen';
function readSeenBands() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}
function markSeenBand(id) {
  const s = readSeenBands(); s.add(id);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s])); } catch { /* private mode: NEW just stays */ }
  return s;
}

/** BAND_DRAFT screen. */
export function BandDraftScreen({ held = null } = {}) {
  // `held`: the draft as it ended, while screens/game.js keeps this screen on 已选定策略 after the draft (heldDraftPub)
  const livePub = useStore((s) => s.match.public);
  const pub = held || livePub;
  const priv = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  const roomSolo = useStore((s) => s.room?.mode === 'solo');
  const roomSeats = useStore((s) => s.room?.seats);
  const gd = useGameData();
  const [sel, setSel] = useState(null);
  const [open, setOpen] = useState(false);   // the detail pane: only once a portrait (or a row's pick) is tapped
  const [peek, setPeek] = useState(null);    // a teammate's / my own pick opened from its row (read-only)
  const [busy, setBusy] = useState(null);
  const [exit, setExit] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [banner, setBanner] = useState(null);

  const mode = gd.config?.modes?.[pub?.modeId];
  const offBonds = modeOffBonds(mode); // the bonds this mode never activates (标准: 10 of 23)
  const solo = roomSolo || mode?.type === 'SINGLE' || String(pub?.modeId || '').includes('single');
  const bands = useMemo(() => allowedBands(officialBands(gd.list('bands'), pub?.modeId ?? pub?.difficulty ?? null), mode?.type || (solo ? 'SINGLE' : 'MULTI')), [gd.ready, mode?.type, solo, data.locale(), pub?.modeId, pub?.difficulty]); /* patched: zjOnly 策略不进普通模式 */
  const players = sortedPlayers(pub);
  const draft = normalizeDraft(pub?.draft, players);
  // 随机模式: two picks per player; the draft view carries round/rounds/picks2 (Match.js publicView)
  const random = !!pub?.randomMode || draft.rounds > 1;
  const repeat = random || pub?.draft?.repeat === true;
  const picksOf = (pid) => [
    ...(draft.picks.has(pid) ? [draft.picks.get(pid)] : []),
    ...(draft.rounds > 1 && draft.picks2.has(pid) ? [draft.picks2.get(pid)] : []),
  ].filter(Boolean);
  const myPicks = random ? picksOf(myId) : [draft.picks.get(myId) || priv?.bandId].filter(Boolean);
  const myPick = myPicks[0] || null; // the primary (also what g.bandFocus / the info dialog read)
  const inOrder = solo || draft.order.includes(myId);
  const myTurn = myPicks.length < draft.rounds && (solo || draft.turnPid === myId);
  const skipsLeft = draft.skipsLeft.has(myId) ? draft.skipsLeft.get(myId) : (skipped ? 0 : 1);
  const canSkip = !solo && myTurn && skipsLeft > 0 && pendingDraftPlayers(draft).length > 1;
  // 随机模式: nothing is 队友已选 — the map only feeds the card badges (selfSecond keeps my own picks visible)
  const taken = solo ? new Map() : teammateBands(draft.picks, myId, draft.picks2, random);
  const pickers = new Map(); // bandId → players
  const addPicker = (pid, bid) => {
    if (typeof bid !== 'string') return;
    if (!pickers.has(bid)) pickers.set(bid, []);
    pickers.get(bid).push(players.find((x) => x.playerId === pid) || { playerId: pid, name: '?' });
  };
  for (const [pid, bid] of draft.picks) addPicker(pid, bid);
  if (draft.rounds > 1) for (const [pid, bid] of draft.picks2) addPicker(pid, bid);

  // default selection: my pick, else what a timeout gives me (华法琳 while free); when my turn comes while the selected
  // band has been taken by a teammate meanwhile (队友已选), move the selection back to that default
  // 随机模式: nothing is ever taken, and my first pick only seeds the highlight while the second round runs
  const defaultId = gd.config?.bandDraft?.timeoutBandId || DEFAULT_TIMEOUT_BAND;
  const donePicking = myPicks.length >= draft.rounds;
  const intents = pub?.draft?.intents || {};
  const myIntent = intents[myId] || null;
  const intentSupported = !!pub?.draft?.intentSupported;
  const markIntent = async (bandId) => {
    if (busy || !inOrder || donePicking || !intentSupported) return;
    setBusy('intent');
    try { await act('g.bandFocus', { bandId, preview: true }, { sfx: false }); }
    finally { setBusy(null); }
  };
  useEffect(() => {
    if (myTurn && myIntent && (repeat || !taken.has(myIntent))) { setSel(myIntent);setOpen(true);setPeek(null); }
  }, [myTurn]);
  const myPickKey = myPicks.join('+');
  const takenKey = [...taken.keys()].sort().join(',');
  useEffect(() => {
    const next = draftSelection(sel, { bands, taken: repeat ? new Map() : taken, myPick: donePicking ? myPickKey : null, myTurn, defaultId });
    if (next !== sel) setSel(next);
  }, [bands.length, myPickKey, donePicking, myTurn, takenKey]);
  // "your turn" cue: the sound and the 「请选择策略」 band, once per pick that becomes mine
  const bannerKey = myTurn ? `${draft.turnPid || 'self'}|${myPicks.length}` : null;
  useEffect(() => {
    if (!bannerKey) return;
    if (!solo) audio.sfx('yourTurn');
    setBanner(bannerKey);
    setPeek(null);
  }, [bannerKey]);
  // the 本局信息 dialog never outlives the turn it was opened in: a turn change (a pick, a skip, a turn that ran out, an
  // AI pick) or my pick closes it, so whoever's turn begins sees the draft
  const turnKey = `${draft.turnPid || ''}|${myPickKey}`;
  useEffect(() => { setInfoOpen(false); }, [turnKey]);

  // one countdown (user playtest #4 item 4): the current turn's — m.public.deadline
  const clock = solo ? null : draftClock(pub);
  // the highlighted band is what a turn that runs out takes (Match.timeoutBand): report every change before my pick
  const timed = !solo && !!pub?.draft && !pub.draft.untimed;
  const focusSent = useRef(null);
  useEffect(() => {
    // (a spectator seat — community report #26 — is in no draft order: it never reports)
    if (!timed || donePicking || !sel || focusSent.current === sel || !draft.order.includes(myId)) return;
    focusSent.current = sel;
    act('g.bandFocus', { bandId: sel }, { sfx: false, quiet: true });
  }, [sel, timed, donePicking]);

  // what a timeout gives me: the highlighted band while free, else the default (never 队友已选 — Match.js timeoutBand;
  // 随机模式: no strategy is taken, the highlight is always assignable)
  const autoId = autoPickBand(sel, { bands, taken: repeat ? new Map() : taken, myPick: donePicking ? myPickKey : null, defaultId });
  const autoName = (autoId && gd.band(autoId)?.name) || gd.band(defaultId)?.name || '华法琳';

  const band = sel ? gd.band(sel) : null;
  const selTaken = !!band && !repeat && taken.has(band.bandId);
  const confirm = async () => {
    if (!band || busy || !myTurn || selTaken) return;
    setBusy('pick');
    await actions.band(band.bandId);
    setBusy(null);
  };
  const skip = async () => {
    if (busy || !canSkip) return;
    setBusy('skip');
    if (await actions.bandSkip()) setSkipped(true);
    setBusy(null);
  };
  // NEW (round 6, the recording 6:50–7:00: new_inner on the cell's top edge): a strategy this browser has never opened —
  // the game's own rule is not in the data, so «never opened here» (localStorage) is OUR stand-in; opening one clears it
  const [seen, setSeen] = useState(readSeenBands);
  const pickTile = (id) => { setSel(id); setOpen(true); setPeek(null); setSeen(markSeenBand(id)); audio.sfx('tab', { volume: 0.5 }); };
  const peekBand = (id) => { setPeek(id); setOpen(true); audio.sfx('tab', { volume: 0.5 }); };
  const turnName = players.find((p) => p.playerId === draft.turnPid)?.name;
  useTicker(clock ? 250 : 0);
  const turnSecs = clock ? secondsLeft(clock.deadline) : null;
  const turnLen = Number(pub?.draft?.turnSeconds) > 0 ? Math.round(pub.draft.turnSeconds) : null;
  // 本局信息: the briefing's blocks (built only while the dialog is open) and the draft's state under it
  const info = infoOpen ? matchInfoModel(pub, { bonds: officialBonds(gd.list('bonds'), pub?.modeId ?? pub?.difficulty), chess: gd.chess, mode, priv, diyData: { chess: data.get('chess'), backups: data.get('backups') } }) : null;
  const infoStatus = infoOpen ? draftInfoStatus({ myPick: myPicks[myPicks.length - 1] || null,
    pickName: myPicks.length ? myPicks.map((id) => gd.band(id)?.name).filter(Boolean).join('、') : null,
    myTurn, turnName, secs: turnSecs, waiting: !solo && !draft.done }) : null;

  // 名片干员 art of the order rows (screens/room.js: the doctor's pick, else one chosen by the player id)
  const cardList = useMemo(() => cardOperators(data.list('chess')), [gd.ready]);
  const portraits = useMemo(() => {
    const v = loadPref(CARD_PREF, '');
    return { pool: cardList.filter((c) => (c.rarity ?? 0) >= 5).sort((a, b) => (a.charId < b.charId ? -1 : 1)),
      byChar: new Map(cardList.map((c) => [c.charId, c])), m: data.get('assets'), myId, myCard: typeof v === 'string' ? v : '' };
  }, [cardList, myId]);
  const artOf = (p) => (p.isBot ? null : seatPortrait((Array.isArray(roomSeats) && roomSeats.find((s) => s && s.playerId === p.playerId)) || { playerId: p.playerId }, portraits));
  const cleared = useMemo(clearedByBand, []);

  // what the right side shows: 已选定策略 after my pick(s), else the detail pane once opened, else only the wall
  const allPicked = !!draft.done || (draft.order.length > 0 && draft.order.every((pid) => picksOf(pid).length >= draft.rounds));
  const view = peek ? 'detail' : inOrder && donePicking && myPicks.length ? 'done' : open && band ? 'detail' : 'grid';
  const shownBand = peek ? gd.band(peek) : band;
  const rows = solo ? players.filter((p) => p.playerId === myId) : draft.order.map((pid) => players.find((p) => p.playerId === pid)).filter(Boolean);

  const head = allPicked ? html`<div class="dturn is-done"><span class="dturn__txt"><b>${t('策略选择完成')}</b><span>${t('正在进入模拟…')}</span></span><${Icon} name="hourglass" class="dturn__glass" /></div>`
    : myTurn ? html`<div class="dturn is-turn">
        <span class="dturn__go"><${Sprite} k="bandChoose/youturn_finger" class="dturn__finger" fallback=${html`<${Icon} name="chevronLeft" class="dturn__finger" />`} />
          <b>${random && draft.rounds > 1 ? t('请选择第 {n} 个策略', { n: Math.min(myPicks.length + 1, draft.rounds) }) : t('请选择策略')}</b></span>
        ${!solo ? html`<button type="button" class="draft-skip" disabled=${!canSkip || !!busy} aria-busy=${busy === 'skip' ? 'true' : undefined} onClick=${skip}
            title=${skipsLeft > 0 ? t('跳过本轮，稍后再选') : t('跳过次数已用完')}>
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19v-5a7 7 0 0 1 7-7h7V3.5L22.5 9 17 14.5V11h-7a3 3 0 0 0-3 3v5z" /></svg>
          <span>${skipsLeft > 0 ? t('跳过选择') : t('无法跳过')}</span></button>` : null}
      </div>`
    : turnName ? html`<div class="dturn"><span class="dturn__txt"><b>${turnName}</b><span>${t('正在选择策略…')}</span></span><${Icon} name="hourglass" class="dturn__glass" /></div>`
    : null;

  return html`<div class=${cx('screen draft', `draft--${view}`, held && 'is-held')}>
    <div class="brief__bg" aria-hidden="true"></div>
    <${StepHeader} step=${2} of=${2} title=${random && draft.rounds > 1 ? t('选择策略（第 {n}/{rounds} 个）', { n: Math.min(draft.round, draft.rounds), rounds: draft.rounds }) : t('选择策略')}
      micro=${random && draft.rounds > 1 ? `STRATEGY // BAND CHECK ${Math.min(draft.round, draft.rounds)}/${draft.rounds}` : 'STRATEGY // BAND CHECK'} pub=${clock ? { ...pub, deadline: clock.deadline } : { ...pub, deadline: 0 }}
      total=${clock ? clock.total : null} onExit=${() => setExit(true)}
      extra=${html`<button type="button" class="stephead__info" data-testid="match-info-open" aria-haspopup="dialog" onClick=${() => setInfoOpen(true)}
        title=${t('查看禁用盟约与干员')}><${Icon} name="search" /><span>${t('本局信息')}</span></button>`}
      status=${head} />
    <main class="draft__main">
      <aside class="draft-order">
        <div class="draft-order__deco" aria-hidden="true"><i></i><i></i><span>STRONGHOLD PROTOCOL<br />${solo ? 'SINGLE OPERATOR' : 'COLLABORATIVE SYSTEM'}</span></div>
        <div class="draft-order__rows">
          ${rows.map((p, i) => {
            const picks = p.playerId === myId ? myPicks : picksOf(p.playerId);
            const cur = picks.length < draft.rounds && (solo || draft.turnPid === p.playerId);
            return html`<${OrderRow} key=${p.playerId} p=${p} i=${i} picks=${picks} rounds=${draft.rounds} random=${random} cur=${cur && !allPicked}
              self=${p.playerId === myId} art=${artOf(p)} gd=${gd} onPeek=${peekBand} intent=${picks.length >= draft.rounds ? null : intents[p.playerId]} intentTaken=${!repeat && taken.has(intents[p.playerId])} />`;
          })}
        </div>
        ${!solo ? html`<p class="draft-order__tip" data-testid="draft-tip">${draftTip({ timed, turnSeconds: turnLen, autoName: donePicking ? null : autoName, selected: open && autoId === sel, round: draft.round, rounds: draft.rounds, random })}</p>` : null}
      </aside>
      <i class="draft__link" aria-hidden="true"></i>

      ${view === 'done' ? (() => {
        const first = gd.band(myPicks[0]);
        return html`<section class="draft-done" key=${myPickKey} aria-live="polite">
          <div class="draft-done__art"><${BandIcon} bandId=${myPicks[0]} size="xl" /></div>
          <div class="draft-done__head">
            <span class="draft-tag">STRATEGY</span>
            <h2 class="draft-done__title">${t('已选定策略')}</h2>
            <b class="draft-done__name">${myPicks.map((id) => gd.band(id)?.name).filter(Boolean).join('、')}</b>
          </div>
          <div class="draft-done__hp">${t('初始生命值')}<b class="num">${first?.totalHp ?? '--'}</b></div>
          ${first ? html`<${BandText} band=${first} class="draft-done__desc" />` : null}
          <p class="draft-detail__status t-mint"><${Icon} name="check" />${t('已选择「{name}」', { name: myPicks.map((id) => gd.band(id)?.name).filter(Boolean).join('、') })}${!solo && !allPicked ? t('，等待其他博士') : ''}</p>
        </section>`;
      })() : html`
        <section class="draft-grid" role="listbox" aria-label=${t('策略')}>
          ${bands.map((b, i) => {
            const who = pickers.get(b.bandId) || [];
            const isTaken = !repeat && taken.has(b.bandId);
            const isMine = myPicks.includes(b.bandId); // 随机模式: both of mine highlight
            const mineN = myPicks.filter((id) => id === b.bandId).length; // 2 = 选了两次 (叠加)
            const offNames = bandOffBonds(b, offBonds).map((id) => gd.bond(id)?.name || id); // 本局禁用 (still selectable)
            const on = view === 'detail' && !peek && sel === b.bandId;
            const wins = cleared[b.bandId] || 0;
            return html`<button key=${b.bandId} type="button" role="option" aria-selected=${on ? 'true' : 'false'} data-band=${b.bandId}
                aria-disabled=${isTaken ? 'true' : 'false'} title=${isTaken ? t('已被选择') : offNames.length ? bandOffLine(offNames) : b.name}
                class=${cx('dband', on && 'is-sel', isMine && 'is-mine', isTaken && 'is-taken', offNames.length && 'is-off')} style=${`--n:${Math.min(i, 15)}`}
                onClick=${() => pickTile(b.bandId)}>
              <span class="dband__frame"><${BandIcon} bandId=${b.bandId} size="lg" /></span>
              <span class="dband__name">${b.name}${mineN > 1 ? ' ×2' : ''}</span>
              ${!seen.has(b.bandId) && !isTaken ? html`<span class="dband__new" aria-label="NEW"></span>` : null}
              ${wins ? html`<span class="dband__medal" title=${t('已通过模拟{n}次', { n: wins })}><${Icon} name="rook" /></span>` : null}
              <${BandOffTag} names=${offNames} />
              ${random && who.length ? html`<span class="dband__who">${who.slice(0, 4).map((p) => html`<${PlayerAvatar} key=${p.playerId} player=${p} size="sm" />`)}</span>` : null}
              ${isTaken ? html`<span class="dband__taken">${t('已被选择')}</span>` : null}
              ${on ? html`<span class="dband__selmark" aria-hidden="true">SELECTED</span>` : null}
            </button>`;
          })}
        </section>
        ${view === 'detail' && shownBand ? html`<aside class="draft-detail" key="detail">
          <div class="draft-detail__body" key=${shownBand.bandId}>
            <div class="draft-detail__art"><${BandIcon} bandId=${shownBand.bandId} size="xl" /></div>
            ${cleared[shownBand.bandId] ? html`<span class="draft-detail__medal">${t('已通过模拟{n}次', { n: cleared[shownBand.bandId] })}</span>` : null}
            <div class="draft-detail__hp">${t('初始生命值')}<b class="num">${shownBand.totalHp ?? '--'}</b></div>
            <span class="draft-tag">STRATEGY</span>
            <h2 class="draft-detail__name">${shownBand.name}</h2>
            <${BandOffNote} names=${bandOffBonds(shownBand, offBonds).map((id) => gd.bond(id)?.name || id)} />
            <span class="draft-tag">INTRO</span>
            <div class="draft-detail__eff"><${BandText} band=${shownBand} class="draft-detail__desc" /></div>
          </div>
          <div class="draft-detail__actions">
            ${peek ? html`<p class="draft-detail__status"><${Icon} name="search" />${myPicks.includes(peek) ? t('你选择的策略') : t('{names} 选择的策略', { names: (pickers.get(peek) || []).map((x) => x.name).join('、') || t('博士') })}</p>
              <div class="draft-detail__btns"><${Button} variant="secondary" size="lg" icon="chevronLeft" onClick=${() => setPeek(null)}>${t('返回')}<//></div>`
            : html`${myPicks.length && !donePicking ? html`<p class="draft-detail__status t-mint"><${Icon} name="check" />${t('已选「{name}」，继续选第 2 个策略', { name: gd.band(myPicks[0])?.name || '' })}${random ? t('（可重复叠加）') : ''}</p>`
                : selTaken ? html`<p class="draft-detail__status draft-detail__status--taken"><${Icon} name="close" />${t('已被选择，请选择其他策略')}</p>`
                : !myTurn ? html`<p class="draft-detail__status"><${Icon} name="hourglass" />${!inOrder ? t('观战中') : turnName ? t('{turnName} 正在决策…', { turnName }) : t('等待轮到你')}</p>` : null}
              <div class="draft-detail__btns">
                ${!myTurn && inOrder && !donePicking && intentSupported ? html`<${Button} variant="secondary" size="lg" disabled=${!band || selTaken || !!busy} loading=${busy === 'intent'} onClick=${() => markIntent(band.bandId)}>${myIntent === band?.bandId ? '已标记想玩' : '标记想玩'}<//>${myIntent ? html`<${Button} variant="secondary" size="lg" disabled=${!!busy} onClick=${() => markIntent(null)}>取消标记<//>` : null}` : null}
                <${Button} variant="primary" size="lg" icon="check" class="draft-confirm" disabled=${!myTurn || !band || selTaken} loading=${busy === 'pick'} onClick=${confirm}>${selTaken ? t('已被选择') : t('确认选择')}<//>
              </div>`}
          </div>
        </aside>` : null}`}
    </main>
    ${banner ? html`<${TurnBanner} key=${banner} text=${t('请选择策略')} onDone=${() => setBanner(null)} />` : null}
    <${ExitModal} open=${exit} onClose=${() => setExit(false)} solo=${solo} />
    <${MatchInfoDialog} open=${infoOpen} onClose=${() => setInfoOpen(false)} model=${info}
      status=${infoStatus ? html`<span class=${cx('minfo-dlg__turn', `is-${infoStatus.tone}`)}>
        <${Icon} name=${infoStatus.tone === 'mint' ? 'check' : 'hourglass'} />${infoStatus.text}${infoStatus.secs != null ? html`<b class="num">${infoStatus.secs}s</b>` : null}
      </span>` : null} />
  </div>`;
}
