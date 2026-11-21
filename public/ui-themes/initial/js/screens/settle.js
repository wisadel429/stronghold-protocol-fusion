export const LV_EXP = 300;
export const LV_MAX = 60;
import { PlayerName, AccountTag, useAccount, useCurrentAccount } from '/js/ui/accounts.js';
import { TrophyBadge } from '/js/ui/trophies.js';
import { currentRecords, ensureUploaded, accountApi } from '/js/ui/cloudStats.js';
import { friendsStore, requestFriend, Glyph, THUMB, ADD_FRIEND } from '/js/ui/friends.js';
import { NameCardLayer } from '/js/ui/namecards.js';
import { toast } from '/js/ui/toasts.js';
import { blacklistStore, refreshBlacklist, isBlacklisted, addBlacklist } from '/js/ui/blacklist.js';
import { useRosterScroll } from '/js/ui/rosterScroll.js';
import { RANDOM_MODE_NAME } from '/shared/randomMode.js';
// The settlement flow of the match on screen (research 06 §10.6; the official act's settlement): a radar intro, then
// two pages, drawn with the official settlement sprites (assets `settle/*`, `elite/*`, `entry/season_logo_settle`;
// docs/ASSETS.md) — every sprite falls back to text / plain CSS when the resource pack is not there.
//   个人战报 (SelfPage): my own outcome (模拟完成, or 模拟中断 when the team lost or I was out before the end) over the
//     terrain and its target point, the rounds I passed, the leaders I helped defeat, my final lineup (ten slots: tier,
//     elite level and gear of each operator), my bonds and their layers, my plate with the trophies, the level
//     settlement — 获得卫戍认证 +N and 每日防卫目标 (data/config.json rewards) filling the LV bar — then 下一步.
//   同盟 (TeamPage): one card per seat (its ace operator's art, the 评语, the rounds passed, the player plate, the
//     trophies), the team's outcome and rounds, the match time and date, 数据详情 (the full report: screens/result.js
//     ResultView) and 返回同盟 / 返回大厅. A match with gameplay plugins carries the 「非官方」 mark (DESIGN §32.6) and
//     leaves the level alone; the 结算 tab plugin slot (result.tab) sits on this page.
// The LV is counted from this device's match records (ui/stats.js): the 卫戍认证 of each settled official match (its
// settlement row's `reward`) and the 每日防卫目标 bonus of each day that reached it, against the levels of
// config.rewards.milestones. [ASSUMED] the official game keeps the total on the account; this project has no accounts,
// so a device counts what it recorded (cleared browser data starts again at LV 0). A spectator seat (no row of its own)
// opens on the team page. The stats page re-views a stored match with ResultView.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from '/vendor/hooks.module.js';
import { html, Icon, DifficultyIcon, Spinner } from '/js/ui/components.js';
import { OperatorImage, useGameData, Img, Sprite, PromotionIcon, PlayerAvatar, BondGlyph, BandIcon } from '/js/ui/gameComponents.js';
import { normalizeResult, diyRecordFor, cardStandIn, standInForText } from '/js/ui/gameLogic.js';
import { data } from '/js/data.js';
import { itemIconUrl, enemyIconUrl, titleIconUrl, uiUrl } from '/js/ui/assetUrls.js';
import { store, useStore, emptyMatch } from '/js/store.js';
import { audio } from '/js/audio.js';
import { sentText } from '/js/ui/lang.js';
import { reducedMotion } from '/js/ui/device.js';
import { recordId, selfRowOf, loadStats, isModdedRecord, recordsOfSeason, roundsOf, countsTowardStats } from '/js/ui/stats.js';
import { UnofficialMark, VersionTag, isModdedRoom } from '/js/ui/pluginTag.js';
import { shownVersion, seasonOf } from '/js/versions.js';
import { TestMark } from '/js/ui/testConsole.js';
import { ResultView, resultBonds } from '/js/screens/result.js';
import { difficultyName, DIFFICULTY_COLORS } from '/shared/constants.js';
import { t } from '/shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const pad2 = (n) => String(Math.max(0, Math.trunc(n) || 0)).padStart(2, '0');
const int = (v) => Math.max(0, Math.round(Number(v) || 0));
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
/** A stage position (1920×1080 design pixels) as rem (1rem = 100px). */
const at = (x, y) => `left:${x / 100}rem;top:${y / 100}rem`;

/** The radar intro. 下一步 cuts to 同盟 with no leave animation (ref f0263 → f0264: no fade, no black frame). */
export const INTRO_MS = 1300;
// 模拟中断: the tiles hold ~0.2 s longer before the (red) wash (ref 12:22 f1211 seats → f1227 wash → f1232 the 个人战报)
export const INTRO_LOSE_MS = 1500;

/** [ASSUMED] Fit translated text into #698's fixed title boxes without enlarging short labels (DESIGN §35.1). */
export function titleScale(width, height, textWidth, textHeight) {
  return Math.min(1, width / (textWidth || 1), height / (textHeight || 1));
}

function SettleTitle({ as: Tag = 'h1', class: cls, children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const box = ref.current;
    const text = box?.firstElementChild;
    if (!text) return undefined;
    const fit = () => box.style.setProperty('--title-scale', String(titleScale(box.clientWidth, box.clientHeight, text.offsetWidth, text.offsetHeight)));
    fit();
    // Observe the untransformed text too: late fonts and the text-size preference change its natural size.
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    ro.observe(text);
    return () => ro.disconnect();
  }, [children]);
  return html`<${Tag} ref=${ref} class=${cx('settle__title', cls)}><span>${children}</span></${Tag}>`;
}

/** Official settle sprites (research 07-assets.json); CSS is used only for an absent/failed image. */
export function SettleButtonArt({ ghost = false }) {
  return html`<${Sprite} k=${ghost ? 'settle/btn_bg_02' : 'settle/btn_next_bg'} class="settle__btnbg"
    fallback=${html`<span aria-hidden="true" class=${cx('settle__btnbg', ghost ? 'settle__btnbg--ghost' : 'settle__btnbg--primary')}></span>`} />`;
}

// ---- the level settlement ---------------------------------------------------------------------------------------------

/**
 * LV of a 卫戍认证 total against config.rewards.milestones (cumulative `tokens` per `level`): the levels reached (0 before
 * the first), the progress into the next (`into` of `need`), `max` past the last.
 * @param {number} total @param {{ level: number, tokens: number }[]} milestones
 */
export function levelOf(total) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  const lv = Math.min(LV_MAX, 1 + Math.floor(n / LV_EXP));
  return lv >= LV_MAX ? { lv: LV_MAX, exp: LV_EXP, into: LV_EXP, need: LV_EXP, max: true } : { lv, exp: n % LV_EXP, into: n % LV_EXP, need: LV_EXP, max: false };
}

/** The 每日防卫目标 day of a time: local, turning over at `resetHour` (04:00). */
export function dayKey(ts, resetHour = 4) {
  const d = new Date(ts - resetHour * 3600000);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * The 每日防卫目标 points of a match: the row of the rounds passed in config.rewards.baseByRoundsPassed (its
 * dailyMissionPoint — [ASSUMED] unscaled by difficulty and mode, as the table gives it apart from the scaled reward).
 */
export function dailyPointsFor(roundsPassed, table) {
  const n = Number(roundsPassed) || 0;
  const row = (Array.isArray(table) ? table : []).filter((r) => r && r.round <= n).pop();
  return int(row?.dailyPoint);
}

/**
 * This match's level settlement from the local records (ui/stats.js, any order; the match's own record — `id` — and
 * anything after it left out). An official settled match earns its row's `reward` (server/match/results.js rewardFor);
 * a day whose matches reached the daily goal earned the bonus once ([ASSUMED] the bonus is 卫戍认证 too, so it counts
 * toward the level; the day is the local one). `counted` false (gameplay plugins): this match earns
 * nothing. Returns the totals before and after this match, its gain and bonus, my trophies so far, today's daily goal.
 * `season` (DESIGN §35.23): only the records of that activity count (null: every record).
 * @param {any[]} records
 * @param {{ id?: string|null, gain?: number, rounds?: number, trophies?: number, at?: number, counted?: boolean, rewards?: any, season?: string|null }} cur
 */
function cloudLevelProgress(records, { id = null, exp = 0, trophies = 0, at = Date.now() } = {}) {
  const int = (v) => Math.max(0, Math.round(Number(v) || 0));
  let total = 0;
  let cups = 0;
  for (const rec of Array.isArray(records) ? records : []) {
    if (!rec || rec.id === id || !Number.isFinite(rec.t) || rec.t > at) continue;
    const row = selfRowOf(rec);
    total += int(row?.reward);
    cups += int(row?.trophies);
  }
  const gain = int(exp);
  return { gain, before: total, after: total + gain, trophies: cups + int(trophies) };
}
export function levelProgress(records, {id=null,gain=0,exp=gain,trophies=0,at=Date.now(),counted=true,rounds=0,rewards=null}={}) {
  const rs=(Array.isArray(records)?records:[]).filter(r=>r?.test!==true && !isModdedRecord(r));
  return {...cloudLevelProgress(rs,{id,exp:counted?exp:0,trophies,at}),counted,...dailyOf(rs,{id,at,rounds,counted,rewards})};
}

/**
 * 10-29 round 16: the 每日防卫目标 of this match — today's points before it and with it, counted as the hub counts them
 * (officialHub.js hubProgress: the day's records, dailyPointsFor their rounds, config.rewards.daily). The bonus is shown
 * (+N 每日防卫目标, ref 12:08 f0880–f0886) but not added to the LV: the hub's LV is the sum of the rows' reward only.
 */
function dailyOf(rs, { id, at, rounds, counted, rewards }) {
  if (!counted) return { daily: null, bonus: 0 };
  const cfg = rewards?.daily || { need: 200, bonus: 300, resetHour: 4 };
  const need = int(cfg.need) || 200;
  const hr = cfg.resetHour ?? 4;
  const day = dayKey(at, hr);
  let before = 0;
  for (const r of rs) {
    if (!r || r.id === id || !countsTowardStats(r) || !Number.isFinite(r.t) || r.t > at || dayKey(r.t, hr) !== day) continue;
    before += dailyPointsFor(roundsOf(r), rewards?.baseByRoundsPassed);
  }
  const after = before + dailyPointsFor(rounds, rewards?.baseByRoundsPassed);
  return { daily: { before: Math.min(need, before), after: Math.min(need, after), need }, bonus: before < need && after >= need ? int(cfg.bonus) || 300 : 0 };
}

// ---- small facts --------------------------------------------------------------------------------------------------------

/** Read the resolved chess / backup form, including the active version or plugin's status (#811). */
export function opLevel(rec) {
  return { phase: rec?.status?.phase, level: rec?.status?.level ?? '—' };
}

/** 账号头像（avatarId = charId）→ 名册里的那条记录：结算卡没有阵容时拿它当卡面兜底。 */
function chessOfAvatarId(charId) {
  if (!charId) return null;
  const raw = data.get('chess');
  const list = Array.isArray(raw) ? raw : Object.values(raw || {});
  return list.find((c) => c && c.charId === charId && !c.isDiy) || null;
}

/** The ace of a lineup — the team card's art: the highest tier, elite first, the earliest on the board. */
export function aceOf(lineup) {
  let best = null;
  (Array.isArray(lineup) ? lineup : []).forEach((u) => {
    if (!u || u.kind === 'token') return;
    const s = (Number(u.tier) || 0) * 2 + (u.golden ? 1 : 0);
    if (!best || s > best.s) best = { u, s };
  });
  return best ? best.u : null;
}

/** 00时42分24秒 */
export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  return t('{h}时{m}分{s}秒', { h: pad2(s / 3600), m: pad2((s % 3600) / 60), s: pad2(s % 60) });
}

/** 2025/12/11 07:51 (local time) */
export function fmtDate(ts) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '—';
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Whether a settlement row cleared the match: the server's per-row `victory` (team won AND still in), else derived. */
export function rowCleared(raw, row, victory) {
  if (typeof raw?.victory === 'boolean') return raw.victory;
  return !!victory && row?.alive !== false && !row?.left;
}

/** A number counting from `from` to `to` (ease-out) once `run` holds; timers, not frames, so a hidden tab still ends. */
function useCountUp(to, { ms = 700, delay = 0, from = 0, run = true, linear = false, pow = 3 } = {}) {
  const target = Math.round(Number(to) || 0);
  const start = Math.round(Number(from) || 0);
  const [v, setV] = useState(() => (reducedMotion() ? target : start));
  useEffect(() => {
    if (!run) return undefined;
    if (reducedMotion() || target === start) { setV(target); return undefined; }
    const t0 = Date.now() + delay;
    const id = setInterval(() => {
      const k = Math.min(1, Math.max(0, (Date.now() - t0) / ms));
      setV(Math.round(start + (target - start) * (linear ? k : 1 - (1 - k) ** pow)));
      if (k >= 1) clearInterval(id);
    }, 32);
    return () => clearInterval(id);
  }, [target, start, run]);
  return v;
}

/**
 * Fit the 1920×1080 stage (19.2rem × 10.8rem) into the screen: 1rem already fits it to the window (theme.css), but not
 * below the 40px floor (a phone held sideways) or inside the safe-area insets — there it is scaled down (--k on the root).
 */
function useStageFit(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 100;
      const k = Math.min(el.clientWidth / (19.2 * rem), el.clientHeight / (10.8 * rem));
      el.style.setProperty('--k', String(Math.max(0.3, Math.min(1, k || 1))));
    };
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    addEventListener('resize', fit);
    return () => { ro?.disconnect(); removeEventListener('resize', fit); };
  }, []);
}

// ---- shared pieces ------------------------------------------------------------------------------------------------------

function Logo() {
  return html`<div class="slogo" aria-hidden="true">
    <${Sprite} k="entry/season_logo_settle" class="slogo__img"
      fallback=${html`<${Sprite} k="settle/common_logo" class="slogo__img" fallback=${html`<b class="slogo__txt">STRONGHOLD<br />PROTOCOL</b>`} />`} />
  </div>`;
}

/** The mode pill: the official difficulty plate (its emblem, no text) under the difficulty's name. */
function ModePill({ r }) {
  const d = r.difficulty;
  if (!d) return null;
  const key = String(d).toLowerCase();
  return html`<span class=${cx('smode', `smode--${key}`)} style=${`--d-color:${DIFFICULTY_COLORS[d] || 'var(--text-lo)'}`}>
    <${Sprite} k=${`settle/mode_${key}`} class="smode__bg" fallback=${html`<span class="smode__bg smode__bg--css"><${DifficultyIcon} difficulty=${d} /></span>`} />
    <b class="smode__name">${difficultyName(d) || d}</b>
  </span>`;
}

// ---- the radar intro ----------------------------------------------------------------------------------------------------
// 10-28 round 12: laid out frame by frame after the event footage (ref f0172–f0187, 10 fps). The outer/ art are the
// original PNGs (img/official/hub/ac/outer/, byte-identical to the package) at 1.5× their pixel size — the footage's
// 1280×720 at 1:1 on the 1920×1080 stage. The blank_* corners, img_text and the season logo stay the live sprites
// (not in outer/). The crosshair, brackets, plus marks, gauge, the teal wash and every timing are ours [OUR]: the
// client's AnimationClip was not found.
//   0.38 s ring (0.92 → 1), frames, logos, the faint terrain on the right; 0.58 s tiles 00 and 01; 0.78 s 02–04; 0.95 s the
//   teal wash with the terrain at the 个人战报 fit; 0.98 s the corners; 1.3 s (INTRO_MS) the 个人战报 (settle.css).
const OUTER = (n) => new URL(`/ui-art/img/official/hub/ac/outer/${n}.png`, location.origin).href;
const box = ([x, y, w, h]) => `left:${x / 100}rem;top:${y / 100}rem;width:${w / 100}rem;height:${h / 100}rem`;
function OImg({ n, b, class: cls, style = '' }) {
  return html`<img class=${cx('so', cls)} src=${OUTER(n)} alt="" draggable="false" style=${`${box(b)};${style}`} />`;
}
/** Pixel sizes of the outer/ art used here (the footage shows them 1:1). */
const OSIZE = { before_round_s: [716, 716], before_round_f: [714, 714], before_up_frame_s: [199, 431], before_up_frame_f: [199, 431],
  before_down_frame_s: [204, 428], before_down_frame_f: [200, 426], before_middle_s_02: [143, 142], before_middle_f_01: [143, 142],
  before_middle_f_03: [143, 142] };
const osize = (n) => OSIZE[n] || [148, 144];
const obox = (n, x, y) => { const [w, h] = osize(n); return [x, y, w * 1.5, h * 1.5]; };
const TILE_AT = [[849, 432], [571.5, 292.5], [1122, 292.5], [571.5, 567], [1122, 567]];
const GHOSTS = [['left_up', 480, 200], ['right_up', 1310, 200], ['left_down', 480, 750], ['right_down', 1310, 750]];
/** The terrain (settlemen_personal_*, 1020×960) as the 个人战报 shows it: 2.137× with its target (389, 349) on AIM. */
const MAP_K = 2180 / 1020;
const mapBox = () => [AIM[0] - 389 * MAP_K, AIM[1] - 349 * MAP_K, 2180, 2052];
const PLUS = [[142, 160], [1767, 160], [142, 937], [1767, 937]];

/** The radar's crosshair, brackets, plus marks and HIGH/LOW gauge — drawn by us after the footage [OUR]. */
const Hud = ({ cls }) => html`<div class=${cx('shud', cls)} aria-hidden="true">
  <i class="shud__v"></i><i class="shud__h shud__h--l"></i><i class="shud__h shud__h--r"></i>
  <i class="shud__brk shud__brk--l"></i><i class="shud__brk shud__brk--r"></i>
  ${PLUS.map(([x, y], i) => html`<i key=${i} class="shud__plus" style=${at(x, y)}></i>`)}
  <span class="shud__gauge"><i></i><i></i><i></i><i></i><small class="shud__hi">HIGH</small><small class="shud__lo">LOW</small></span>
</div>`;

function SettleIntro({ players, myId, lose, onDone }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const id = setTimeout(() => done.current(), lose ? INTRO_LOSE_MS : INTRO_MS);
    const skip = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); done.current(); } };
    addEventListener('keydown', skip);
    return () => { clearTimeout(id); removeEventListener('keydown', skip); };
  }, []);
  const s = lose ? 'f' : 's';
  const map = `settlemen_personal_${lose ? 'fail' : 'success'}`;
  const seats = TILE_AT.slice(1).map((xy, i) => ({ xy, n: `before_middle_${s}_${pad2(i + 1)}`, p: players.find((p) => p.seat === i) || null }));
  return html`<div class=${cx('sintro', lose && 'is-lose')} data-testid="settle-intro" onClick=${() => done.current()}>
    <div class="settle__stage" aria-hidden="true">
      <${OImg} n=${map} b=${[647, -262, 2180, 2052]} class="sintro__far" />
      <${Hud} cls="sintro__hud" />
      <${OImg} n=${`before_round_${s}`} b=${obox(`before_round_${s}`, 423, 3)} class="sintro__ring" />
      <${OImg} n=${`before_up_frame_${s}`} b=${obox(`before_up_frame_${s}`, 811, -180)} class="sintro__frame" />
      <${OImg} n=${`before_down_frame_${s}`} b=${obox(`before_down_frame_${s}`, 807, 648)} class="sintro__frame" />
      <span class="sintro__season" style=${box([727, 157, 153, 142])}><${Sprite} k="entry/season_logo_settle" /></span>
      <${OImg} n="common_logo" b=${[954, 147, 280, 142]} class="sintro__logo" />
      <${OImg} n=${`text_frame_${s}`} b=${[1207.5, 505.5, 189, 69]} class="sintro__tag" />
      <${Sprite} k="settle/img_text" class="sintro__foot" fallback=${html`<small class="sintro__foot">RHODES ISLAND STRONGHOLD PROTOCOL</small>`} />
      ${GHOSTS.map(([k, x, y], i) => html`<span key=${k} class="sintro__ghost" style=${`${at(x, y)};--i:${i}`}>
        <${Sprite} k=${k === 'right_down' ? 'settle/blank_right_down' : `settle/blank_${k}_${s}`} /></span>`)}
      <${OImg} n=${`before_middle_${s}`} b=${obox(`before_middle_${s}`, ...TILE_AT[0])} class="sintro__core" />
      ${seats.map(({ xy: [x, y], n, p }, i) => html`<${OImg} key=${i} n=${n} b=${obox(n, x, y)} style=${`--i:${i}`}
        class=${cx('sintro__seat', !p && 'is-empty', p && p.playerId === myId && 'is-me', p && p.alive === false && 'is-out', p && p.left && 'is-left')} />`)}
      <div class="sintro__wash"><${OImg} n=${map} b=${mapBox()} /></div>
    </div>
  </div>`;
}

// ---- 个人战报 -------------------------------------------------------------------------------------------------------------

// The terrain's target point and the rays to the lineup (stage pixels). [ASSUMED] read off the official settlement as
// the event footage shows it (the client's layout is not in the extracted data); the background art is laid so that
// its target — at (389, 349) of the 1020×960 team-show art, the same terrain — falls on AIM.
const AIM = [682, 345];
// 10-28: the ray ends at ref f0190 (×1.5); the third number is how much of the ray is drawn from its end (two stop
// short in the footage). Which ray goes to which card is not known. Round 13: on the page itself (f0195–f0262, full
// lineup) the two solid dots of f0190 are ray ends too (ring + ray, the same as the others), so they are rays here.
const RAYS = [[1399.5, 312, 1], [1380, 462, 1], [685.5, 619.5, 1], [778.5, 910.5, 1], [1237.5, 838.5, .45], [567, 685.5, .55],
  [1057.5, 192, 1], [900, 741, 1]];
const CROSSES = [[930, 240], [845, 640]];

const SELF_SPRITES = ['dot_line_01', 'arrow_02', 'dot_line_round', 'dot_line_ban', 'img_lv', 'img_lvup', 'img_max', 'levelup', 'max_bg',
  'num_line', 'reward_normal_icon', 'round_info_boss_doc', 'sp_boss_fx_ban', 'sp_boss_fx_doc', 'sp_boss_fx_line', 'sp_boss_fx_triangle',
  'operator_bg', 'operator_frame', 'operator_lv_bg', 'next_icon', 'img_text'];
function warmSelfSprites(lose) {
  const s = lose ? 'f' : 's';
  const urls = [...SELF_SPRITES.map((k) => uiUrl(data.get('assets'), `settle/${k}`)),
    ...[`target_bg_color_${s}`, 'target_bg_round_02', 'target_bg_round_01', `target_round_${s}`, 'target_dot', `target_dot_middle_${s}`].map(OUTER)];
  for (const u of urls) if (u) { const im = new Image(); im.decoding = 'async'; im.src = u; }
}

/** A quarter sprite turned four ways round its corner: the full ring / disc of the target. 10-28: the outer/ originals
 * (the live settle/* copies are re-trimmed). */
const Quad = ({ n, cls }) => html`<span class=${cx('squad', cls)}>${[0, 1, 2, 3].map((q) => html`<img key=${q} src=${OUTER(n)} alt="" draggable="false" class=${`sprite squad__q squad__q--${q}`} />`)}</span>`;
const OSprite = ({ n, cls }) => html`<img src=${OUTER(n)} alt="" draggable="false" class=${cx('sprite', cls)} />`;

function Target({ lose }) {
  const s = lose ? 'f' : 's';
  return html`<div class="starget" style=${at(AIM[0], AIM[1])} aria-hidden="true">
    <${Quad} n=${`target_bg_color_${s}`} cls="starget__color" />
    <${OSprite} n="target_bg_round_02" cls="starget__disc" />
    ${!lose && html`<${Quad} n="target_bg_color_s" cls="starget__fill" />`}
    <${Quad} n="target_bg_round_01" cls="starget__arc" />
    <${Quad} n=${`target_round_${s}`} cls="starget__ring" />
    <${OSprite} n="target_dot" cls="starget__dot" />
    <${OSprite} n=${`target_dot_middle_${s}`} cls="starget__mid" />
    <span class="starget__label">
      <${OSprite} n="target_title_up" cls="starget__up" />
      <${OSprite} n="target_title_down" cls="starget__down" />
    </span>
  </div>`;
}

function Rays({ lose }) {
  return html`<div class="srays" aria-hidden="true">
    ${RAYS.map(([x, y, f], i) => {
      const dx = AIM[0] - x;
      const dy = AIM[1] - y;
      const a = (Math.atan2(dy, dx) * 180) / Math.PI;
      return html`<span key=${i} class="sray" style=${`${at(x, y)};width:${(f * Math.hypot(dx, dy)) / 100}rem;transform:rotate(${a}deg);--i:${i}`}>
        <${Sprite} k="settle/dot_line_01" class="sray__line" fallback=${html`<i class="sray__line sray__line--css"></i>`} />
        <${Sprite} k="settle/arrow_02" class="sray__arrow" />
      </span>`;
    })}
    ${RAYS.map(([x, y], i) => html`<span key=${`e${i}`} class="sray__end" style=${`${at(x, y)};--i:${i}`}>
      <${Sprite} k="settle/dot_line_round" fallback=${html`<i class="sray__ring"></i>`} /></span>`)}
    ${lose ? CROSSES.map(([x, y], i) => html`<span key=${`x${i}`} class="sray__ban" style=${at(x, y)}>
      <${Sprite} k="settle/dot_line_ban" fallback=${html`<${Icon} name="close" />`} /></span>`) : null}
  </div>`;
}

/** One unit of a lineup as the cards draw it (自选 pick / 补位 stand-in resolved as on the report's thumbnails). */
function unitView(u, gd) {
  const chess = u.kind === 'token' ? null : gd.chess(u.id);
  const dr = u.diy && chess ? diyRecordFor(chess, u.diy, { chess: data.get('chess'), backups: data.get('backups') }) : null;
  const si = !dr && chess ? cardStandIn(chess, { unit: u, backups: gd.backups }) : null;
  const rec = dr || si || chess;
  const tier = Math.max(0, Math.min(6, Number(u.tier) || Number(rec?.tier) || 0));
  return {
    rec,
    si,
    tier,
    golden: !!(u.golden ?? rec?.isGolden),
    name: rec?.name || '',
    title: si ? t('{name}（{note}）', { name: si.name, note: standInForText(chess.name) }) : (rec?.name || ''),
    items: (Array.isArray(u.items) ? u.items : []).map((id) => data.lookup('items', id)).filter(Boolean),
  };
}

const NoInfo = () => html`<small class="sop__noinfo">NO INFO</small>`;

/** One lineup slot as a tall card; `u` null = an empty slot (the official NO INFO card). */
export function OpCard({ u, gd, i, ownerId }) {
  if (!u) {
    return html`<div class="sop is-empty" style=${`--i:${i}`}>
      <${Sprite} k="settle/operator_bg" class="sop__empty" fallback=${html`<span class="sop__art"><${NoInfo} /></span>`} />
    </div>`;
  }
  const v = unitView(u, gd);
  const lv = opLevel(v.rec);
  return html`<div class=${cx('sop', v.tier && `sop--t${v.tier}`, v.golden && 'is-golden')} style=${`--i:${i}`} title=${v.title}>
    <span class="sop__art"><${OperatorImage} m=${gd.m} chess=${v.rec} ownerId=${ownerId} skin=${u.skin} portrait avatarFallback portraitClass="is-portrait" avatarClass="is-avatar" fallback=${html`<span class="sop__glyph">${[...(v.name || '?')][0]}</span>`} /></span>
    <${Sprite} k="settle/operator_frame" class="sop__frame" />
    ${v.tier ? html`<b class="sop__tier">${ROMAN[v.tier]}</b>` : null}
    <span class="sop__lv"><${Sprite} k="settle/operator_lv_bg" class="sop__lvbg" /><${PromotionIcon} m=${gd.m} phase=${lv.phase} class="selite" /><b class="num">${lv.level}</b></span>
    ${v.si ? html`<span class="sop__si" data-standin=${v.si.charId}>${t('替补')}</span>` : null}
    <span class="sop__slots">${[0, 1].map((k) => {
      const it = v.items[k];
      return html`<i key=${k} class=${cx('sop__slot', it && 'has-item')} title=${it?.name || ''}>${it
        ? html`<${Img} src=${itemIconUrl(gd.m, it)} fallback=${html`<b>${[...(it.name || '?')][0]}</b>`} />`
        : html`<${Sprite} k="settle/operator_trap_bg" class="sop__trap" fallback=${html`<${NoInfo} />`} />`}</i>`;
    })}</span>
  </div>`;
}

function BondBar({ bonds, gd }) {
  const list = resultBonds(bonds, (id) => gd.bond(id));
  const ref = useRef(null);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => { const el = ref.current; if (el) setMore(el.scrollWidth > el.clientWidth + 2); }, [list.length]);
  return html`<div class="sbonds">
    <span class="sbonds__mark" aria-hidden="true"><${Sprite} k="settle/band_icon" fallback=${html`<small>BONDS</small>`} /></span>
    <div class="sbonds__list" ref=${ref}>
      ${list.length ? list.map((b, i) => html`<span key=${b.bondId} class=${cx('sbond', b.active && 'is-on')} style=${`--i:${i}`} title=${gd.bond(b.bondId)?.name || b.bondId}>
        <span class="sbond__disc"><${BondGlyph} bondId=${b.bondId} /></span>${b.hideLayers ? html`<b class="num">—</b>` : html`<b class="num">${b.layers ?? 0}</b>`}</span>`)
        : html`<${Sprite} k="settle/band_noinfo" class="sbonds__none" fallback=${html`<span class="sbonds__none">NO INFO</span>`} />`}
    </div>
    ${more ? html`<button type="button" class="sbonds__more" aria-label=${t('更多')} onClick=${() => ref.current?.scrollBy({ left: 300, behavior: 'smooth' })}><${Icon} name="chevronRight" /></button>` : null}
  </div>`;
}

/**
 * The 个人战报 timeline (ms from the page's first frame — ref 11:41 f0020, the terrain clean with its target; 30 fps).
 * Read off the footage frame by frame (r16/res/src30 for 11:41, f0820–f0910 for 12:08):
 *   rays 0.03–0.4 s, 通过回合 counting linearly 0.4–1.33 s whatever the count (15 at f0059; 14 at 12:08 f0866: 6 / 12 at 0.8 / 1.2 s), the title 0.5 s, the cards a grey
 *   ghost at 0.57 s and in colour at 0.63 s, plate / bonds / bottom strip 0.63–0.83 s, the first medal 0.63–0.97 s, the
 *   hidden core's sequence 67 ms after the rounds stop, the LV count from 1.17 s for 1 s (linear, the level turning over
 *   with no flash: 58 200 → 60 at f0055–f0085; 57 → 60 in about the same time at 12:08), then LEVEL UP! / MAX and 下一步
 *   67 ms after it ends (f0087).
 */
export const SELF_T = { rounds: 400, roundsMs: 930, lv: 1167, lvDaily: 1467, lvMs: 1000, after: 67, daily: 820, dailyMs: 880 };
/** 12:08 f0846–f0900: with the 每日防卫目标 column the daily count runs first (0.82–1.7 s, easing out: 178 / 187 / 194 / 198 of 200 at 1.0 / 1.2 / 1.4 / 1.6 s) and the LV count starts at ~1.47 s. */
const dailyOpen = (prog) => (prog?.daily && prog.daily.before < prog.daily.need && prog.daily.after > prog.daily.before ? prog.daily : null);
const lvDelay = (prog) => (dailyOpen(prog) ? SELF_T.lvDaily : SELF_T.lv);
const COIN = new URL('/ui-art/img/official/hub/ac/act2/img_coin.png', location.origin).href;

/**
 * The level settlement (10-29 round 16, rebuilt on ref 11:41 f0050–f0110 and 12:08 f0846–f0930; 1280×720 × 1.5): the
 * 卫戍认证 device (act2 img_coin, cut at the strip's top), 获得卫戍认证!, +N 常规获得, the 每日防卫目标 column when today's
 * goal was still open (its count, then +bonus sliding in), LV and its number, the exp, the bar (progress_bg /
 * progress_green), LEVEL UP! / MAX at the end. A match with gameplay plugins or a test match counts for nothing.
 */
function LevelStrip({ prog }) {
  const d = dailyOpen(prog);
  const run = !!prog.counted && prog.after > prog.before;
  const total = useCountUp(prog.after, { ms: SELF_T.lvMs, delay: lvDelay(prog), from: prog.before, linear: true, run });
  const today = useCountUp(d ? d.after : 0, { ms: SELF_T.dailyMs, delay: SELF_T.daily, from: d ? d.before : 0, run: !!d, pow: 1.5 });
  const lv0 = levelOf(prog.before);
  const lv = levelOf(run ? total : prog.after);
  const done = !run || total >= prog.after;
  const pct = lv.max ? 1 : lv.into / Math.max(1, lv.need);
  const why = (txt) => html`<small class="slv__why"><${Sprite} k="settle/reward_normal_icon" class="slv__icon" />${txt}</small>`;
  return html`<div class=${cx('slv', d && 'has-daily', done && 'is-done', lv.max && 'is-max')} title=${t('等级：官方对局累计获得的卫戍认证')}>
    <img class="slv__coin" src=${COIN} alt="" draggable="false" />
    <b class="slv__got">${t('获得卫戍认证!')}</b>
    ${prog.counted ? html`<span class="slv__col"><b class="slv__plus num">+${prog.gain}</b>${why(t('常规获得'))}</span>`
      : html`<span class="slv__col slv__col--off">${prog.test ? t('测试对局不计入等级') : t('非官方对局不计入等级')}</span>`}
    <i class="slv__div"></i>
    ${d ? html`<span class=${cx('slv__col', 'slv__col--daily', prog.bonus && today >= d.need && 'is-swap')}>
        <span class="slv__dnow"><small class="slv__dlabel">${t('每日防卫目标')}</small>
          <span class="slv__dcount num"><b>${today}</b>/${d.need}</span>
          <span class="slv__dbar"><i style=${`width:${(today / d.need) * 100}%`}></i></span></span>
        ${prog.bonus ? html`<span class="slv__dgot"><b class="slv__plus num">+${prog.bonus}</b>${why(t('每日防卫目标'))}</span>` : null}
      </span><i class="slv__div slv__div--2"></i>` : null}
    <div class="slv__lvg">
      <${Sprite} k="settle/img_lv" class="slv__lvimg" fallback=${html`<small class="slv__lvimg">LV.</small>`} />
      <b class="slv__num num">${lv.lv}</b>
      <span class="slv__exp num"><b>${lv.into}</b><${Sprite} k="settle/num_line" class="slv__slash" fallback="/" />${lv.need}</span>
      <span class="slv__track"></span>
        ${pct > 0 ? html`<i class="slv__fill" style=${`width:${pct * 4.2}rem`}></i>` : null}
      ${done && run && lv.lv > lv0.lv ? html`<span class="slv__up"><${Sprite} k="settle/levelup" class="slv__flag" /><${Sprite} k="settle/img_lvup" class="slv__tagtxt" fallback=${html`<b class="slv__tagtxt">LEVEL UP!</b>`} /></span>` : null}
      ${done && lv.max ? html`<span class="slv__max"><${Sprite} k="settle/max_bg" class="slv__flag" /><${Sprite} k="settle/img_max" class="slv__tagtxt" fallback=${html`<b class="slv__tagtxt">MAX</b>`} /></span>` : null}
    </div>
  </div>`;
}

/**
 * One defeated leader on the report (10-29 round 16, ref 11:41 f0110, 1:1 at 720p): the round plate
 * (round_info_boss_bg, _sp for the Hidden Core), the leader's portrait in its circle, the emblem at its foot, the ✓ box at
 * the top right (orange; red for the core); the core's plate carries its red marks (round_info_boss_doc).
 */
const MEDAL_AT = [[247.5, 394.5], [424.5, 394.5]];
function Medal({ m, i }) {
  const sp = m.kind === 'hidden' ? '_sp' : '';
  const label = m.kind === 'boss' ? t('敌方领袖') : t('隐秘核心');
  return html`<span class=${cx('smedal', `smedal--${m.kind}`, m.done ? 'is-done' : 'is-miss', m.fx && 'has-fx')} style=${box([...MEDAL_AT[i], 187.5, 186])}
      title=${m.rec?.name ? `${label} · ${m.rec.name}` : label}>
    <${Sprite} k=${`settle/round_info_boss_bg${sp}`} class="smedal__bg" />
    <span class="smedal__ava"><${Img} src=${enemyIconUrl(m.gd.m, m.rec?.enemyKey)} fallback=${null} /></span>
    <${Sprite} k=${`settle/round_info_boss_icon${sp}`} class="smedal__icon" fallback=${html`<${Icon} name="crown" class="smedal__icon" />`} />
    ${sp ? html`<${Sprite} k="settle/round_info_boss_doc" class="smedal__doc" />` : null}
    ${m.done ? html`<${Sprite} k=${`settle/round_info_boss_complete${sp}`} class="smedal__check" fallback=${html`<i class="smedal__check"><${Icon} name="check" /></i>`} />`
      : html`<i class="smedal__check is-miss"><${Icon} name="close" /></i>`}
  </span>`;
}

/**
 * The Hidden Core broken (ref 11:41 f0061–f0078, 33 ms a frame): a small red triangle grows (sp_boss_fx_triangle, 0.1 s),
 * the grey bar triangle closes in from 1.8× (sp_boss_fx_doc) with the red lines out of its corners (sp_boss_fx_line) and
 * the triangle fills red, the white ✕ (sp_boss_fx_ban) stamps in, it all dissolves in a white flash and the core's
 * medal is there (Medal .has-fx). Positions from the frames; the red fill is CSS (no sprite of it was found).
 */
function CoreFx({ i }) {
  return html`<span class="shfx" style=${box([...MEDAL_AT[i], 187.5, 186])} aria-hidden="true">
    ${[0, 120, 240].map((a) => html`<${Sprite} key=${a} k="settle/sp_boss_fx_line" class="shfx__line" style=${`--a:${a}deg`} />`)}
    <${Sprite} k="settle/sp_boss_fx_doc" class="shfx__doc" />
    <i class="shfx__fill"></i>
    <${Sprite} k="settle/sp_boss_fx_triangle" class="shfx__tri" />
    <${Sprite} k="settle/sp_boss_fx_ban" class="shfx__ban" />
  </span>`;
}

/** The 测试 mark of a match of the 「测试」 mode (0.3.1, DESIGN §34.8) with its command count, as on the detail view. */
function SettleTestMark({ res }) {
  if (res?.test !== true) return null;
  return html`<span class="settle__test" data-testid="settle-test"><${TestMark} /> ${t('测试对局')}${Number.isInteger(res.testActions) ? html` · ${t('测试指令 {n} 次', { n: res.testActions })}` : null}</span>`;
}

function SelfPage({ r, res, raw, self, gd, prog, content, onNext, version = null }) {
  const acct = useAccount(self.isBot ? null : self.playerId);
  const cleared = rowCleared(raw, self, r.victory);
  const [leaving, setLeaving] = useState(false);
  const nextRef = useRef(null);
  const nRounds = int(self.roundsPassed);
  const rounds = useCountUp(nRounds, { ms: SELF_T.roundsMs, delay: SELF_T.rounds, linear: true, from: cleared ? 0 : nRounds }); // 模拟中断 shows the rounds as they are, no count (ref 12:22 f1252)
  const rEnd = SELF_T.rounds + SELF_T.roundsMs;
  const lvEnd = lvDelay(prog) + (prog?.counted && prog.after > prog.before ? SELF_T.lvMs : 0);
  const boss = cleared && r.bossId ? gd.boss(r.bossId) : null;
  const hidden = cleared && r.hiddenReached && r.hiddenBossId ? gd.boss(r.hiddenBossId) : null;
  const medals = [boss && { kind: 'boss', rec: boss, done: true, gd }, hidden && { kind: 'hidden', rec: hidden, done: r.hiddenCleared, fx: !!r.hiddenCleared, gd }].filter(Boolean);
  const slots = Array.from({ length: 10 }, (_, i) => self.lineup[i] || null);
  const milestones = gd.config?.rewards?.milestones;
  useEffect(() => {
    audio.sfx(cleared ? 'settlementSucceed' : 'settlementFail');
    const sign = medals.length ? setTimeout(() => audio.sfx('settlementBossSign'), 633) : null;
    const focus = setTimeout(() => nextRef.current?.focus({ preventScroll: true }), lvEnd + SELF_T.after);
    return () => { clearTimeout(sign); clearTimeout(focus); };
  }, []);
  const next = () => {
    if (leaving) return;
    setLeaving(true);
    onNext();
  };
  const tl = `--t-rend:${rEnd}ms;--t-hid:${rEnd + SELF_T.after}ms;--t-next:${lvEnd + SELF_T.after}ms`;
  return html`<section class=${cx('sself', cleared ? 'is-win' : 'is-lose', leaving && 'is-leaving')} style=${tl} data-testid="settle-self">
    <div class="settle__stage">
      <${OImg} n=${`settlemen_personal_${cleared ? 'success' : 'fail'}`} b=${mapBox()} class="sself__bg" />
      <i class="sself__wash" aria-hidden="true"></i>
      <div class="sself__carry" aria-hidden="true">
        <${Hud} cls="sself__hud" />
        <${OImg} n=${`before_round_${cleared ? 's' : 'f'}`} b=${obox(`before_round_${cleared ? 's' : 'f'}`, 423, 3)} class="sself__ring" />
        <${Sprite} k="settle/img_text" class="sintro__foot" />
      </div>
      <${Rays} lose=${!cleared} />
      <${Target} lose=${!cleared} />
      <div class="sself__fx" aria-hidden="true"></div>
      <span class="sself__season" style=${box([94, 55, 98, 112])} aria-hidden="true"><${Sprite} k="entry/season_logo_settle" /></span>
      <${OImg} n="common_logo" b=${[258, 55, 212, 107]} class="sself__logo" />
      <div class="sself__band">${self.bandId ? html`<${BandIcon} bandId=${self.bandId} size="lg" />` : html`<${PlayerAvatar} player=${self} self=${true} />`}</div>
      <div class="sself__mode"><${ModePill} r=${r} /><${UnofficialMark} room=${content ? { content } : null} class="sself__modmark" /><${VersionTag} version=${version} class="sself__vertag" /><${SettleTestMark} res=${res} /></div>
      <${SettleTitle} class="sself__title">${cleared ? t('模拟完成') : t('模拟中断')}</${SettleTitle}>
      <div class="sself__row" aria-hidden="true">
        <${Sprite} k="settle/info_frame" class="sself__brk sself__brk--l" /><${Sprite} k="settle/info_frame" class="sself__brk sself__brk--r" />
        <i class="sself__glow"></i><i class="sself__div"></i></div>
      <div class="sself__rounds"><span>${t('通过回合')}</span><b class="num">${rounds}</b></div>
      ${medals.length ? html`<div class="sself__medals">${medals.map((m, i) => html`<${Medal} key=${m.kind} m=${m} i=${i} />`)}
        ${medals.map((m, i) => (m.fx ? html`<${CoreFx} key=${`fx${m.kind}`} i=${i} />` : null))}</div>` : null}
      <div class="splate">
        <${PlayerAvatar} player=${self} self=${true} class="splate__ava" />
        <div class=${cx("splate__info", acct?.card && "has-nc")}><${NameCardLayer} card=${acct?.card} />
          <b class="splate__name"><${Sprite} k=${plateArt(self, true)} class="splate__namebg" /><span><${PlayerName} playerId=${self.isBot ? null : self.playerId} name=${self.name} /></span></b>
          <span class="splate__rank" title=${t('累计奖杯')}><${TrophyBadge} count=${prog.trophies} /><b class="num">${prog.trophies}</b></span>
          <span class="splate__gain"><small><${Icon} name="crown" />${t('获得奖杯')}</small><b class="num">${self.trophies}</b></span>
        </div>
      </div>
      <div class="sops">
        <div class="sops__row sops__row--1">${slots.slice(0, 5).map((u, i) => html`<${OpCard} key=${i} u=${u} gd=${gd} ownerId=${self.playerId} i=${i} />`)}</div>
        <div class="sops__row sops__row--2">${slots.slice(5).map((u, i) => html`<${OpCard} key=${i} u=${u} gd=${gd} ownerId=${self.playerId} i=${i + 5} />`)}</div>
      </div>
      <${BondBar} bonds=${self.bonds} gd=${gd} />
      <div class="settle__barbg" aria-hidden="true"><${Sprite} k="settle/bottom_bg" /></div>
      ${prog ? html`<${LevelStrip} prog=${prog} />` : null}
      <button type="button" ref=${nextRef} class="settle__next" onClick=${next}>
        <${SettleButtonArt} />
        <${Sprite} k="settle/next_icon" class="settle__nexticon" fallback=${html`<span class="settle__nexticon"><${Icon} name="chevronRight" /></span>`} /><span class="settle__nextlabel">${t('下一步')}</span>
      </button>
    </div>
  </section>`;
}

// ---- 同盟 ----------------------------------------------------------------------------------------------------------------

/** A player plate's bar: red for a seat that left, mint for mine, grey for a teammate's ([ASSUMED] the art has the three
 * bars — id_info_bg, _quit, _single — not which seat takes which). */
const plateArt = (p, self) => `settle/${p.left ? 'id_info_bg_quit' : self ? 'id_info_bg' : 'id_info_bg_single'}`;

function titleView(p, gd) {
  if (!p.title) return null;
  const titles = Array.isArray(gd.config?.titles) ? gd.config.titles : [];
  const rec = titles.find((x) => x.id === p.title.id) || null;
  const rawRec = (data.getRaw('config')?.titles || []).find((x) => x && x.id === p.title.id) || null;
  const name = sentText(p.title?.name, rawRec?.name, rec?.name) || rec?.name || null;
  if (!name) return null;
  return {
    name,
    text: rec?.text || p.title?.text || '',
    icon: titleIconUrl(gd.m, rec?.picId || p.title?.picId || String(p.title.id || '').replace('comment_', 'comment_icon_')),
  };
}

function TeamCard({ p, i, gd, self, victory, raw, social }) {
  const acct = useAccount(p.isBot ? null : p.playerId);
  const ace = aceOf(p.lineup);
  const v = ace ? unitView(ace, gd) : null;
  // 没有阵容（开局就结束 / 全撤下）时用玩家**自己**的账号干员立绘当卡面（业主 2026-11-14「立绘区 NO INFO」）
  const artChess = v?.rec || chessOfAvatarId(p.avatarId || (self ? acct?.avatarId : null));
  const artSkin = ace?.skin ?? p.avatarSkin ?? (self ? acct?.avatarSkin : null) ?? null;
  const title = titleView(p, gd);
  const cleared = rowCleared(raw, p, victory);
  const band = p.bandId ? gd.band(p.bandId) : null;
  return html`<article class=${cx('tcard', self && 'is-self', p.alive === false && 'is-dead', p.left && 'is-left', cleared ? 'is-clear' : 'is-fail')} style=${`--i:${Math.min(i, 3)}`}>
    <header class="tcard__head" aria-hidden="true"><i class="tcard__pin"><${OSprite} n="card_square_1" cls="tcard__pinimg" /></i><span class="tcard__code"><i></i><i></i><i></i>STRONGHOLD PROTOCOL</span></header>
    <div class="tcard__art"><i class="tcard__bg" aria-hidden="true"></i>
      <${OperatorImage} m=${gd.m} chess=${artChess} ownerId=${p.playerId} skin=${artSkin} portrait avatarFallback portraitClass="tcard__img is-portrait" avatarClass="tcard__img is-avatar" fallback=${html`<span class="tcard__glyph">${[...(p.name || '?')][0]}</span>`} />
      ${title && !p.left ? html`<div class="tcard__title" title=${title.text}>
        <${Img} src=${title.icon} class="tcard__ticon" fallback=${html`<${Icon} name="crown" class="tcard__ticon" />`} /><b>${title.name}</b></div>` : null}
      ${p.left ? html`<span class="tcard__cut">${t('中断连接')}</span>`
        : html`<div class="tcard__rounds"><span>${t('通过回合')}</span><b class="num">${p.roundsPassed}</b></div>`}
    </div>
    <div class=${cx("tcard__plate",acct?.card && "has-nc")}><${NameCardLayer} card=${acct?.card} />
      <${Sprite} k=${plateArt(p, self)} class="tcard__platebg" />
      ${self ? html`<${OSprite} n="card_deco_self" cls="tcard__deco" />` : null}
      <${PlayerAvatar} player=${p} self=${self} class="tcard__ava" />
      ${self ? html`<${OSprite} n="icon_self_room" cls="tcard__me" />` : null}
      <span class="tcard__who">
        <b class="tcard__name"><span><${PlayerName} playerId=${p.isBot ? null : p.playerId} name=${p.name} /></span>${p.isBot ? html`<span class="tcard__ai">AI</span>` : null}</b>
        ${band ? html`<span class="tcard__band"><${BandIcon} bandId=${band.bandId} size="xs" /><span>${band.name}</span></span>` : null}
      </span>
    </div>
    <div class="tcard__chips"><${SocialChips} p=${p} self=${self} social=${social} />
      <span class="tchip tchip--cup" title=${t('获得奖杯')}><${Sprite} k="settle/id_info_cup_icon" class="tchip__cup" fallback=${html`<${Icon} name="crown" />`} /><b class="num">+${p.trophies}</b></span>
    </div>
  </article>`;
}

function TeamPage({ r, res, gd, myId, at: when, content, backLabel, onBack, onDetail, version = null }) {
  const hid = !!(r.victory && r.hiddenCleared);
  const n = Math.max(0, Math.round(Number(r.roundsPassed) || 0));
  const rounds = useCountUp(n, hid ? { ms: n * 71, delay: 1300, linear: true } : { ms: n * 33.5, delay: 1215, linear: true });
  const social = useMatchSocial(recordId(res,myId));
  const cardsRef = useRef(null);
  const many = r.players.length > 4;
  const roster = useRosterScroll(cardsRef,{enabled:many,identity:r.players.map(p=>p.playerId).join(','),initialSelector:'.tcard.is-self'});
  const backRef = useRef(null);
  const rawOf = (pid) => (Array.isArray(res?.players) ? res.players.find((x) => x && x.playerId === pid) : null) || null;
  const self = r.players.find((p) => p.playerId === myId) || null;
  const bg = self?.left ? 'quit' : r.victory ? 'success' : 'fail';
  useEffect(() => {
    audio.sfx('settlementTeam');
    const id = setTimeout(() => backRef.current?.focus({ preventScroll: true }), 900);
    return () => clearTimeout(id);
  }, []);
  return html`<section class=${cx('steam', r.victory ? 'is-win' : 'is-lose', hid && 'is-hid')} data-testid="settle-team">
    <div class="steam__bg" aria-hidden="true"><${OSprite} n=${`settlemen_teamshow_${bg}`} /></div>
    <div class="settle__stage">
      <${Logo} />
      <div ref=${cardsRef} class=${cx("steam__cards",many && "is-many")} tabIndex=${many ? 0 : undefined} aria-label="同盟结算成员，左右滑动查看" style=${`--n:${r.players.length}`}>
        ${r.players.length ? r.players.map((p, i) => html`<${TeamCard} key=${p.playerId} p=${p} i=${i} gd=${gd} self=${p.playerId === myId} victory=${r.victory} raw=${rawOf(p.playerId)} social=${r.players.length > 1 ? social : null} />`)
          : html`<p class="steam__none">${t('暂无结算数据')}</p>`}
      </div>
      ${many ? html`<button type="button" class="steam__nav steam__nav--l" disabled=${!roster.prev} onClick=${()=>roster.page(-1)} aria-label="向左"><${Icon} name="chevronLeft" /></button>
        <button type="button" class="steam__nav steam__nav--r" disabled=${!roster.next} onClick=${()=>roster.page(1)} aria-label="向右"><${Icon} name="chevronRight" /></button><p class="steam__scroll-hint">${t('共 {n} 名成员 · 左右滑动查看全部结算',{n:r.players.length})}</p>` : null}
      <div class="settle__barbg steam__barbg" aria-hidden="true"><${Sprite} k="settle/bottom_bg" /></div>
      <div class="steam__outcome">
        <span class="steam__tags"><${ModePill} r=${r} /><${UnofficialMark} room=${content ? { content } : null} /><${VersionTag} version=${version} /><${SettleTestMark} res=${res} /></span>
        <${SettleTitle} as="b" class="steam__title">${r.victory ? t('模拟完成') : t('模拟中断')}</${SettleTitle}>
      </div>
      <div class="steam__rounds"><span>${t('同盟通过回合')}</span><b class="num">${rounds}</b><i class="steam__glow" aria-hidden="true"></i><i class="steam__flash" aria-hidden="true"></i></div>
      <div class="steam__when">
        <span class="steam__row"><${Sprite} k="settle/date_time_bg" class="steam__rowbg" /><${Sprite} k="settle/time_icon" class="steam__ico" />${fmtDuration(r.durationMs)}</span>
        <span class="steam__row"><${Sprite} k="settle/date_time_bg" class="steam__rowbg" /><${Sprite} k="settle/date_icon" class="steam__ico" />${fmtDate(when)}</span>
      </div>
      <button type="button" class="sbtn sbtn--ghost steam__detail" onClick=${onDetail}>
        <${SettleButtonArt} ghost=${true} /><${Icon} name="chart" /><span>${t('数据详情')}</span></button>
      <button type="button" ref=${backRef} class="sbtn sbtn--primary settle__back" onClick=${onBack}>
        <${SettleButtonArt} />
        <${Sprite} k="settle/btn_back_icon_01" class="sbtn__mark" fallback=${html`<${Icon} name="chevronLeft" />`} /><span>${backLabel}</span></button>
      <div class="ui-slot steam__slot" data-ui-slot="result.tab" aria-label=${t('界面插件')} dangerouslySetInnerHTML=${{ __html: '' }}></div>
    </div>
  </section>`;
}

// ---- the flow -----------------------------------------------------------------------------------------------------------

/**
 * The settlement of one m.result: intro → 个人战报 → 同盟; 数据详情 opens the full report over it.
 * `content`: the room's content (room.state.content) — gameplay plugins mark the match unofficial (DESIGN §32.6).
 * @param {{ res: any, pub?: any, myId?: string|null, content?: any, backLabel: string, onBack: () => void }} props
 */
export function SettleFlow({ res, pub = null, myId = null, content = null, backLabel, onBack, version = null }) {
  const gd = useGameData();
  const r = normalizeResult(res, pub);
  const self = r.players.find((p) => p.playerId === myId) || null;
  const rawSelf = self && Array.isArray(res?.players) ? res.players.find((x) => x && x.playerId === myId) || null : null;
  const [page, setPage] = useState(() => (!self ? 'team' : reducedMotion() ? 'self' : 'intro'));
  const [detail, setDetail] = useState(false);
  // this device's records as the match ended (m.result is recorded as it arrives: the match's own record is left out)
  const ctx = useMemo(() => {
    const { records } = currentRecords();
    const id = recordId(res, myId);
    const own = records.find((x) => x.id === id);
    return { records, id, at: own?.t || Date.now() };
  }, []);
  // a 测试 match earns nothing toward the level or the daily goal (its server reward is 0 and its record is not kept)
  const isTest = res?.test === true;
  const prog = useMemo(() => (self ? { ...levelProgress(ctx.records, {
    id: ctx.id, gain: self.reward, rounds: self.roundsPassed, trophies: self.trophies, at: ctx.at,
    counted: !isTest && !isModdedRoom(content ? { content } : null), rewards: gd.config?.rewards, season: seasonOf(version),
  }), test: isTest } : null), [gd.config]);
  const rootRef = useRef(null);
  useStageFit(rootRef);
  // the 个人战报 draws its rays / target / strip ~0.1-0.3 s after it mounts: fetch them while the radar runs (Img is lazy)
  useEffect(() => { if (page === 'intro') warmSelfSprites(lose); }, []);
  const lose = self ? !rowCleared(rawSelf, self, r.victory) : !r.victory;
  return html`<div ref=${rootRef} class=${cx('screen', 'result', 'settle', `settle--${page}`)} data-testid="settle">
    ${page === 'intro' ? html`<${SettleIntro} players=${r.players} myId=${myId} lose=${lose} onDone=${() => setPage('self')} />` : null}
    ${page === 'self' ? html`<${SelfPage} r=${r} res=${res} raw=${rawSelf} self=${self} gd=${gd} prog=${prog} content=${content} version=${version} onNext=${() => setPage('team')} />` : null}
    ${page === 'team' ? html`<${TeamPage} r=${r} res=${res} gd=${gd} myId=${myId} at=${ctx.at} content=${content} version=${version} backLabel=${backLabel} onBack=${onBack} onDetail=${() => setDetail(true)} />` : null}
    ${detail ? html`<div class="settle__detail" data-testid="settle-detail">
      <${ResultView} res=${res} pub=${pub} myId=${myId} quiet=${true} slot=${false} content=${content} version=${version} backLabel=${t('返回')} onBack=${() => setDetail(false)} /></div>` : null}
  </div>`;
}

/**
 * RESULT screen of the match on screen: reads the store; 返回同盟 / 返回大厅 drops the match.
 * The RESULT phase can reach the client before m.result: the flow starts once the payload is here, since its own row
 * decides intro → 个人战报 (a seat) or 同盟 (a spectator).
 */
export function ResultScreen() {
  const res = useStore((s) => s.match.result);
  const pub = useStore((s) => s.match.public);
  const myId = useStore((s) => s.me.playerId);
  const hasRoom = useStore((s) => !!s.room);
  const content = useStore((s) => s.room?.content ?? null);
  // the official version the match played (DESIGN §35.23): the room's, or the last room's once it is gone
  const version = useStore(shownVersion);
  const back = () => store.set({ match: emptyMatch() });
  if (!res) return html`<div class="screen result settle" data-testid="settle-wait"><${Spinner} size="lg" /></div>`;
  return html`<${SettleFlow} res=${res} pub=${pub} myId=${myId} content=${content} version=${version} backLabel=${hasRoom ? t('返回同盟') : t('返回大厅')} onBack=${back} />`;
}

function useMatchSocial(rid) {
  const { me: acct } = useCurrentAccount();
  const [likes, setLikes] = useState({ counts: {}, mine: [] });
  const [sent, setSent] = useState([]);
  const [busy, setBusy] = useState(null);
  const on = !!(acct && rid);
  useEffect(()=>{if(acct)refreshBlacklist()},[acct?.id]);
  useEffect(() => {
    if (!on) return undefined;
    let n = 0;
    const poll = async () => {
      n++;
      try { if (await ensureUploaded(rid)) { const d = await accountApi(`likes?record=${encodeURIComponent(rid)}`); setLikes({ counts: d.counts || {}, mine: d.mine || [] }); } } catch { /* next tick */ }
    };
    poll();
    const id = setInterval(() => { if (n >= 24) clearInterval(id); else if (!document.hidden) poll(); }, 5000);
    return () => clearInterval(id);
  }, [on, rid]);
  const like = async (pid) => {
    if (busy) return;
    setBusy('like:' + pid);
    try {
      if (!(await ensureUploaded(rid))) throw new Error(t('战绩还没有同步到账号，请稍后再试'));
      await accountApi('likes', { body: { record: rid, playerId: pid } });
      setLikes((l) => ({ counts: { ...l.counts, [pid]: (l.counts[pid] || 0) + (l.mine.includes(pid) ? 0 : 1) }, mine: [...new Set([...l.mine, pid])] }));
    } catch (err) { toast(err?.message || t('点赞失败'), 'error'); } finally { setBusy(null); }
  };
  const befriend = async (pid) => {
    if (busy) return;
    setBusy('friend:' + pid);
    try { await requestFriend({ playerId: pid }); setSent((s) => [...s, pid]); } catch (err) { toast(err?.message || t('添加好友失败'), 'error'); } finally { setBusy(null); }
  };
  // 加好友 needs only my login (the request names the teammate's match id), not this match's record
  return { on, acct: !!acct, likes, sent, busy, like, befriend };
}
function SocialChips({ p, self, social }) {
  const info = useAccount(p.isBot ? null : p.playerId);
  const friends = useStore((s) => s.data?.friends || null, Object.is, friendsStore);
  useStore(s=>s,Object.is,blacklistStore);
  const [blocking,setBlocking]=useState(false);
  if (p.isBot || !social) return null;
  const got = social.likes.counts[p.playerId] || 0;
  if (self) {
    return social.on && got ? html`<span class="tchip tchip--liked" title=${t('本局收到的点赞')}><${Glyph} d=${THUMB} /><b class="num">${got}</b></span>` : null;
  }
  const blocked=isBlacklisted(p.playerId,info);
  const block=async()=>{if(blocking)return;setBlocking(true);try{await addBlacklist({playerId:p.playerId},info?info.name+'#'+info.tag:p.name)}catch(e){toast(e.message,'error')}finally{setBlocking(false)}};
  const guest = !info;
  const why = !social.on ? t('登录账号后可以点赞和加好友') : guest ? t('对方没有登录账号') : '';
  const whyFriend = !social.acct ? t('登录账号后可以加好友') : guest ? t('对方没有登录账号') : '';
  const liked = social.likes.mine.includes(p.playerId);
  const isFriend = !!(info && friends?.some((f) => f.name === info.name && f.tag === info.tag));
  const asked = social.sent.includes(p.playerId);
  return html`
    <button type="button" class=${cx('tchip', 'tchip--friend', (isFriend || asked) && 'is-done')} disabled=${!!whyFriend || isFriend || asked || social.busy === 'friend:' + p.playerId}
      title=${whyFriend || (isFriend ? t('已是好友') : asked ? t('好友申请已发送') : t('加好友'))} aria-label=${t('加好友')} onClick=${() => social.befriend(p.playerId)}>
      <${Glyph} d=${ADD_FRIEND} />${isFriend || asked ? html`<${Icon} name="check" />` : null}</button>
    <button type="button" class=${cx('tchip', 'tchip--like', liked && 'is-done')} disabled=${!!why || liked || social.busy === 'like:' + p.playerId}
      title=${why || (liked ? t('已点赞') : t('点赞'))} aria-label=${t('点赞')} onClick=${() => social.like(p.playerId)}>
      <${Glyph} d=${THUMB} />${got ? html`<b class="num">${got}</b>` : null}</button>
    <button type="button" class=${cx('tchip','tchip--block',blocked && 'is-done')} disabled=${!social.acct||guest||blocked||blocking} title=${!social.acct?t('登录账号后可以拉黑'):guest?t('对方未登录账号，可在黑名单管理中输入名字#编号添加'):blocked?t('已拉黑，可在黑名单管理中解除'):t('禁止该账号加入你创建的房间')} aria-label=${blocked?t('已拉黑'):t('拉黑')} onClick=${block}>${blocked?t('已拉黑'):t('拉黑')}</button>`;
}
