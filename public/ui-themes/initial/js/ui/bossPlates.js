// The leader rounds' plates and the run's end, as the event's footage shows them (video 11:03–11:08 最终攻势,
// 11:25–11:28 隐秘核心已解锁, 11:30–11:39 the endings), drawn with the official sprites (data/assets.json ui): the
// leader crest settle/round_info_boss_icon, the hidden core's round_info_boss_icon_sp, their ✓ round_info_boss_complete
// (_sp), the merged-LP node's rook hudPanel/icon_hp, the warnings hudPanel/icon_warn and the map behind the panel
// settle/settlemen_personal_fail; the leaders' portraits are their enemy icons. Those settle crests are small (the
// emblem is ~28 / 45 px): when the local client's extract is there (data/local-assets.json ui/battle, tools/local-
// extract) the crests are its full-size sprites instead — icon_boss_normal_white (tinted the crest's orange, as the
// footage draws it flat) and boss_sp_icon, the hidden core's glitched crest (Crest).
//   * FinalAssaultPlate — 最终攻势: each survivor's LP runs along a line into one node (the team's merged LP, m.public
//     teamLp), then the leader's crest lights up beside it: 合力击败敌方领袖！ (round 16: rebuilt on the 1280 stage from
//     the event's battle sprites, img/official/hub/ac/battle/).
//   * HiddenCorePlate — 隐秘核心已解锁 at the hidden round's start.
//   * EndPlate — the run's end, in the 3 s the server already waits before RESULT (server/match/match/bossRounds.js
//     DELAYS.SETTLE; settle.js afterSettle) — it never delays the settlement: 击败了全部领袖！ / 未能击破隐秘核心 when
//     the hidden round is over, 模拟中断 when the team falls (endPlateOf).
// screens/game.js picks the moments, and shows them only once every sprite is in (bossPlateArtReady): without the art
// pack the 0.3.0 banners stay. pointer-events none: the field stays usable. With prefers-reduced-motion they show
// without the motion. Styles: css/screens/boss-plates.css. [ASSUMED] the positions, sizes and timings, measured frame by
// frame from that footage.
import { useEffect, useState } from '/vendor/hooks.module.js';
import { html } from '/js/ui/components.js';
import { Img, PlayerAvatar } from '/js/ui/gameComponents.js';
import { uiUrl, enemyIconUrl } from '/js/ui/assetUrls.js';
import { reducedMotion } from '/js/ui/device.js';
import { sortedPlayers } from '/js/ui/gameLogic.js';
import { data, getBoss, localAsset } from '/js/data.js';
import { PHASE } from '/shared/constants.js';
import { t } from '/shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** How long each plate holds before it fades (ms; the fade is LEAVE_MS more). */
export const FINAL_PLATE_MS = 3270;
export const CORE_PLATE_MS = 2350;
export const END_PLATE_MS = 2500;
const LEAVE_MS = 250;
/** round 12: 击败了全部领袖！ holds END_CUT_MS, the window fades (0.1 s), then the darkened field comes back (to END_FADE_MS). */
export const END_CUT_MS = 2750;
const END_FADE_MS = 350;
/** 未能击破隐秘核心 holds CF_CUT_MS, the window fades (0.15 s), the dimmed field comes back by CF_FADE_MS. */
export const CF_CUT_MS = 1467;
const CF_FADE_MS = 433;
/** 模拟中断 is one 2.03 s timeline from its mount (abt-*, step-end per footage frame): the window folds 1.8–1.87 s,
 *  the words go by 1.9 s, the dim lifts 1.97–2.03 s. ABORT_MS + ABORT_FADE_MS = that 2.03 s. */
export const ABORT_MS = 1767;
const ABORT_FADE_MS = 266;

// round 12 (the reviewer's 战斗结束与结算动画补充): the hidden-core plate and 击败了全部领袖！ rebuilt from the event's own
// end-screen sprites (img/official/hub/ac/end/, copied byte for byte, SHA-256 checked) on a 1280 × 720 stage measured off
// the original recording (video 11:25.6–11:28.0 and 11:30.2–11:32.6). Only the PNGs are original: their order, timing,
// blends and the few drawn pieces (the core plate's halo and brackets) are ours [OUR], and the
// AnimationClip itself was not found — this is a frame-by-frame imitation, not the restored clip.
const END_ART = (n) => new URL(`/ui-art/img/official/hub/ac/end/${n}.png`, location.origin).href;
const END_LIST = ['bg_type_01', 'bg_type_01_effect', 'bg_side_effect', 'boss_sp_icon', 'icon_boss_back', 'icon_win_boss',
  'icon_win_boss_sp', 'icon_boss_normal_white', 'icon_boss_sp_large', 'boss_clear', 'boss_clear_sp', 'img_text_win_all',
  'img_screen_line', 'bg_type_02'];

const ART = ['settle/round_info_boss_icon', 'settle/round_info_boss_icon_sp', 'settle/round_info_boss_complete',
  'settle/round_info_boss_complete_sp', 'settle/settlemen_personal_fail', 'hudPanel/icon_hp', 'hudPanel/icon_warn'];

/** Whether every sprite has loaded (preloadBossPlateArt): null = not fetched yet, false = missing or still loading. */
let plateArt = null;
/** The preloaded images, kept (and decoded) so the cache can't drop them before a plate mounts in a long match. */
const heldArt = [];

/** The full-size crests (Crest): null = not fetched yet (the local manifest may come later), false = none, true = in. */
const HD = { leader: 'icon_boss_normal_white', core: 'boss_sp_icon' };
let hdArt = null;

function preloadHdCrests() {
  if (hdArt !== null || typeof Image !== 'function' || !data.get('local')) return;
  const urls = [HD.leader, HD.core].map((n) => localAsset('ui/battle', n));
  hdArt = false;
  if (!urls.every(Boolean)) return;
  let left = urls.length;
  for (const src of urls) {
    const img = new Image();
    img.onload = () => { left -= 1; if (left === 0) hdArt = true; };
    img.onerror = () => { left = -1; };
    img.src = src;
  }
}

/** True once the sprites are all in: without them screens/game.js keeps the 0.3.0 banners and result box. */
export const bossPlateArtReady = () => { preloadHdCrests(); return plateArt === true; };

/** Fetch the sprites when the match screen opens (screens/game.js, once per page). A missing pack never turns ready. */
export function preloadBossPlateArt() {
  if (plateArt !== null || typeof Image !== 'function') return;
  plateArt = false;
  const assets = data.get('assets');
  const urls = [...ART.map((k) => uiUrl(assets, k)), ...END_LIST.map(END_ART), ...FA_LIST.map(BATTLE)];
  if (!urls.every(Boolean)) return;
  let left = urls.length;
  for (const src of urls) {
    const img = new Image();
    img.onload = () => { left -= 1; if (left === 0) plateArt = true; img.decode?.().catch(() => {}); };
    img.onerror = () => { left = -1; };
    img.src = src;
    heldArt.push(img);
  }
}

/**
 * Whether a leader round's battles are over: the server zeroes the countdown and stops every field, then waits
 * DELAYS.SETTLE before the next round or RESULT (server/match/match/bossRounds.js); a leader at 0 HP is over at once.
 * @param {any} pub m.public
 */
export function bossRoundOver(pub) {
  if (!pub?.bossHp) return false;
  if (Number(pub.bossHp.hp) <= 0) return true;
  const fields = Array.isArray(pub.fields) ? pub.fields : [];
  return !pub.deadline && fields.length > 0 && fields.every((f) => !f.live);
}

/**
 * Which end plate the moment calls for, or null:
 *   'allClear' — the hidden round is over and its leader fell (击败了全部领袖！);
 *   'coreFail' — the hidden round is over, its leader standing (未能击破隐秘核心: the run is still won);
 *   'abort'    — 模拟中断: the 最终攻势 is over with the leader standing, or the round's settlement left nobody alive.
 * A 最终攻势 won goes on to the hidden round or to the settlement as in 0.3.0 [ASSUMED: the footage has no plate for it].
 * @param {string} phase @param {any} pub m.public
 * @returns {'allClear'|'coreFail'|'abort'|null}
 */
export function endPlateOf(phase, pub) {
  if (phase === PHASE.HIDDEN_CORE && bossRoundOver(pub)) return Number(pub.bossHp.hp) <= 0 ? 'allClear' : 'coreFail';
  if (phase === PHASE.FINAL_ASSAULT && bossRoundOver(pub) && Number(pub.bossHp.hp) > 0) return 'abort';
  // [ASSUMED] the settlement that eliminates the last player shows 模拟中断 in place of the round's result box
  const players = Array.isArray(pub?.players) ? pub.players : [];
  if (phase === PHASE.SETTLE && players.length > 0 && players.every((p) => p.alive === false)) return 'abort';
  return null;
}

/**
 * The 最终攻势 plate's rows, frozen when the phase starts: every survivor with the LP it brings (seat order), and the
 * merged pool (m.public teamLp; the rows' sum before it arrives).
 * @param {any} pub m.public
 * @returns {{ rows: { player: any, lp: number }[], total: number }}
 */
export function finalPlateRows(pub) {
  const rows = sortedPlayers(pub).filter((p) => p && p.alive !== false).map((p) => ({ player: p, lp: Math.max(0, Number(p.lp) || 0) }));
  const sum = rows.reduce((s, r) => s + r.lp, 0);
  return { rows, total: Number.isFinite(pub?.teamLp) ? Math.max(0, pub.teamLp) : sum };
}

/** The node's centre on the 1280 stage before the group moves left (video f040: the box 724–823 × 302–403). */
const NODE_Y = 352.5;
/** The line sprites (img/official/hub/ac/battle/): width, height, the stroke's centre at the left end and at the right. */
const LINE = {
  team_blood_line_l: [231, 123, 116.6, 6.9], team_blood_line_s: [231, 44, 39.4, 2.3], team_blood_line_2r: [227, 43, 36.6, 7.1],
  team_blood_line_3r_l: [228, 76, 69, 5.2], team_blood_line_3r_s: [28, 8, 4.1, 4.1],
};
/**
 * Each row's line on the 1280 stage (y = the stroke's centre at its left end, under the row's LP) and its sprite: four
 * rows as the footage (f040: 237 / 314 / 388.5 / 463.5, the long curve outside, the short one inside, flipped above the
 * node); three, two and one with the event's own 3r / 2r sprites at the footage's 74 px pitch [ASSUMED: the footage has
 * four]; past four (a room may seat 20) drawn curves at a closer pitch [ASSUMED]. `inner` rows draw a frame later.
 * @returns {{ y: number, sprite: string|null, flip: boolean, inner: boolean }[]}
 */
export function finalRowsY(n) {
  const k = Math.max(0, Math.trunc(n) || 0);
  const row = (y, sprite, inner = false) => ({ y, sprite, flip: y < NODE_Y, inner });
  if (k === 4) return [row(237, 'team_blood_line_l'), row(314, 'team_blood_line_s', true), row(388.5, 'team_blood_line_s', true), row(463.5, 'team_blood_line_l')];
  if (k === 3) return [row(NODE_Y - 74, 'team_blood_line_3r_l'), row(NODE_Y, 'team_blood_line_3r_s', true), row(NODE_Y + 74, 'team_blood_line_3r_l')];
  if (k === 2) return [row(NODE_Y - 37, 'team_blood_line_2r'), row(NODE_Y + 37, 'team_blood_line_2r')];
  if (k === 1) return [row(NODE_Y, 'team_blood_line_3r_s')];
  const gap = Math.min(74, 270 / Math.max(1, k - 1));
  return Array.from({ length: k }, (_, i) => {
    const off = i - (k - 1) / 2;
    return row(NODE_Y + off * gap, null, Math.abs(off) < (k - 1) / 4);
  });
}

/** A leader's portrait (the enemy icon of bosses.json's enemyKey), or null. */
export function bossIconOf(bossId) {
  const b = bossId ? getBoss(bossId) : null;
  return b?.enemyKey ? enemyIconUrl(data.get('assets'), b.enemyKey) : null;
}

function Art({ k, class: cls }) {
  const src = uiUrl(data.get('assets'), k);
  return src ? html`<img class=${cls} src=${src} alt="" draggable="false" />` : null;
}

/**
 * A leader's crest: the local client's full-size sprite once loaded, else the settle one. The orange crest is the
 * white sprite as a mask (the footage's flat orange), so the beaten crest's filter still turns it black.
 * @param {{ core?: boolean, class?: string }} props
 */
function Crest({ core = false, class: cls }) {
  const hd = hdArt === true ? localAsset('ui/battle', core ? HD.core : HD.leader) : null;
  if (!hd) return html`<${Art} k=${core ? 'settle/round_info_boss_icon_sp' : 'settle/round_info_boss_icon'} class=${cls} />`;
  if (core) return html`<img class=${cx(cls, 'is-hd')} src=${hd} alt="" draggable="false" />`;
  return html`<i class=${cx(cls, 'is-hd', 'bpl__crest--tint')} style=${`--crest: url("${hd}")`}></i>`;
}

/** Hold for `ms`, then `leaving` (the fade), then onDone. */
function useTimedLeave(ms, onDone, fade = LEAVE_MS) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setLeaving(true), ms);
    const b = setTimeout(() => onDone?.(), ms + fade);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  return leaving;
}

/** `to` counted up from 0 after `delay`, one share of it per `frame` ms (the node filling with the team's LP); at once
 *  with reduced motion. */
function useCountUp(to, delay, shares, frame) {
  const [n, setN] = useState(() => (reducedMotion() ? to : 0));
  useEffect(() => {
    if (reducedMotion()) { setN(to); return undefined; }
    const ids = shares.map((k, i) => setTimeout(() => setN(Math.round(to * k)), delay + i * frame));
    return () => ids.forEach(clearTimeout);
  }, [to]);
  return n;
}

/** A leader's portrait in its ring, with the official ✓ when it fell. */
function Portrait({ src, done = false, core = false, class: cls }) {
  return html`<span class=${cx('bpl__ava', core && 'bpl__ava--core', cls)}>
    <${Img} src=${src} />
    ${done ? html`<${Art} k=${core ? 'settle/round_info_boss_complete_sp' : 'settle/round_info_boss_complete'} class="bpl__done" />` : null}
  </span>`;
}

/** The node's count, the share of the team's LP each frame shows (video f029–f039, one per 33 ms from 0.7 s). */
const FA_COUNT = [.1, .27, .42, .55, .66, .76, .85, .91, .96, .99, 1];
/** A sprite of the event's battle HUD (img/official/hub/ac/battle/, copied byte for byte). */
const BATTLE = (n) => new URL(`/ui-art/img/official/hub/ac/battle/${n}.png`, location.origin).href;
const FA_LIST = ['team_boss_start_bg', 'team_blood_line_l', 'team_blood_line_s', 'team_blood_line_2r', 'team_blood_line_3r_l',
  'team_blood_line_3r_s', 'team_blood_line_dot', 'team_boss_blood', 'team_boss_blood_frame', 'team_boss_blood_icon',
  'team_boss_blood_round', 'team_boss_dese_upper_02', 'team_boss_doc_text', 'team_boss_frame', 'team_boss_player_blood',
  'team_boss_player_mine', 'team_boss_start_cross', 'boss_bg_normal', 'icon_boss', 'dec_text_lower_corner',
  'dec_text_side_num', 'dec_text_upper_left_01', 'dec_line_side', 'icon_warn', 'dec_triangle_line', 'dec_line', 'round_cross',
  'icon_complete', 'boss_clear_icon_add', 'boss_bg_sp', 'icon_boss_sp_tiny', 'icon_boss_tiny', 'dec_tiny_text_02',
  'img_link_01', 'img_link_02', 'img_link_out', 'img_dec_cross', 'img_dec_cross_2', 'fx_line_mesh', 'dec_stronghold_protocol',
  'mosaic_disturb', 'dec_text_upper_left_02'];

/** A battle sprite drawn through CSS (frame px on the 1280 stage); `crop` = [x, y, the sprite's width, height] when only
 *  part of it shows. */
function Deco({ n, class: cls, box, crop = null }) {
  const [l, tp, w, h] = box;
  const part = crop ? `--ms:${fp(crop[2])} ${fp(crop[3])};--mp:${fp(-crop[0])} ${fp(-crop[1])};` : '';
  return html`<i class=${cx('fa2__d', cls)}
    style=${`left:${fp(l)};top:${fp(tp)};width:${fp(w)};height:${fp(h)};--m:url("${BATTLE(n)}");${part}`}></i>`;
}

/** One row's line: the grey sprite and its teal copy, which runs from the row into the node (the head, then the tail). */
function FaLine({ row }) {
  const [w, h, left] = LINE[row.sprite];
  const top = row.flip ? row.y - (h - left) : row.y - left;
  const width = row.sprite === 'team_blood_line_3r_s' ? 231 : w;
  return html`<span class=${cx('fa2__line', row.flip && 'is-flip', row.inner && 'is-inner')}
      style=${`left:${fp(505)};top:${fp(top)};width:${fp(width)};height:${fp(h)};--m:url("${BATTLE(row.sprite)}")`}>
    <i class="fa2__grey"></i><i class="fa2__glow"><i class="fa2__teal"></i></i>
  </span>`;
}

/** The node: the official rounded square, ring and rook, dark with the white count, then filled teal from the left. */
const FaNode = ({ n }) => html`<span class="fa2__node">
  ${['fa2__empty', 'fa2__full'].map((k) => html`<span key=${k} class=${cx('fa2__lay', k)}>
    <i class="fa2__sq"></i><i class="fa2__nr"></i><i class="fa2__rook"></i><b class="fa2__n">${n}</b>
  </span>`)}
  <i class="fa2__frame"></i>
</span>`;

/**
 * 最终攻势 (video 11:03.9–11:07.3, frames r16/fa/src30): the window opens on the event's own map (team_boss_start_bg);
 * each survivor's LP leaves its row and runs its line (team_blood_line_*) into the node, the node fills and counts the
 * team's merged LP while two rings spread from it; the group slides left, the leader's crest lights up beside it
 * (icon_boss_normal_white, black → orange) with its portrait badge, and 最终攻势 / 合力击败敌方领袖！ come up. The
 * sprites are the event's (img/official/hub/ac/battle/ and end/); the rings, the comets, the crest's colour and every
 * timing are ours, read off the footage frame by frame [REBUILT]. Timeline: css/screens/boss-plates.css 最终攻势.
 * @param {{ rows: { player: any, lp: number }[], total: number, bossId?: string|null, myId?: string|null, onDone?: Function }} props
 */
export function FinalAssaultPlate({ rows, total, bossId = null, myId = null, onDone }) {
  const leaving = useTimedLeave(FINAL_PLATE_MS, onDone);
  const shown = useCountUp(total, 700, FA_COUNT, 33);
  const lay = finalRowsY(rows.length);
  const curves = lay.filter((r) => !r.sprite);
  return html`<div class=${cx('bpl', 'bst', 'bst--final', leaving && 'is-leaving')} role="status" aria-live="polite"
      aria-label=${`${t('最终攻势')}：${t('合力击败敌方领袖！')}`} data-testid="final-plate">
    <div class="bst__stage">
      <i class="bst__dim" aria-hidden="true"></i>
      <div class="bst__win fa2__win">
        <div class="fa2__in">
          <div class="fa2__vm" aria-hidden="true">
            <${EArt} src=${BATTLE('team_boss_start_bg')} class="fa2__bg" box=${[113, 171, 1051, 422]} />
          </div>
          <div class="fa2__decos" aria-hidden="true">
            <${Deco} n="dec_text_upper_left_01" box=${[190, 217, 72, 13]} />
            <${Deco} n="team_boss_dese_upper_02" class="is-warm" box=${[1005, 229, 80, 24]} />
            <${Deco} n="dec_text_lower_corner" box=${[180, 444, 100, 64]} crop=${[0, 0, 224, 64]} />
            <${Deco} n="dec_text_lower_corner" class="is-warm" box=${[1022, 467, 74, 50]} crop=${[150, 0, 224, 64]} />
            <${Deco} n="dec_text_side_num" class="fa2__num-l" box=${[193, 312, 16, 72]} />
            <${Deco} n="dec_text_side_num" class="is-warm" box=${[1068, 312, 16, 72]} />
          </div>
          <div class="fa2__grp" aria-hidden="true">
            <i class="fa2__ring fa2__ring--o"></i><i class="fa2__ring fa2__ring--i"></i>
            ${lay.filter((r) => r.sprite).map((r, i) => html`<${FaLine} key=${i} row=${r} />`)}
            ${curves.length ? html`<svg class="fa2__curves" viewBox="0 0 1280 720">
              ${curves.map((r, i) => {
                const d = `M505 ${r.y} C620 ${r.y} 620 ${NODE_Y} 736 ${NODE_Y}`;
                return html`<g key=${i} class=${cx(r.inner && 'is-inner')}><path class="fa2__cg" d=${d} /><path class="fa2__ct" d=${d} pathLength="1" /></g>`;
              })}
            </svg>` : null}
            <div class="fa2__rows">
              ${rows.map((r, i) => html`<div key=${r.player?.playerId ?? i} class="fa2__row" style=${`top:${fp(lay[i].y)}`}>
                <${PlayerAvatar} player=${r.player} class="fa2__ava" />
                ${r.player?.playerId === myId ? html`<${EArt} src=${BATTLE('team_boss_player_mine')} class="fa2__mine" box=${[402, -30, 21, 21]} />` : null}
                <span class="fa2__lp"><i class="fa2__lpi"></i><b>${r.lp}</b></span>
                <i class="fa2__dot"></i><i class="fa2__dot fa2__dot--b"></i><i class="fa2__comet"></i>
              </div>`)}
            </div>
            <div class="fa2__pop">
              ${[[707, 293], [841, 293], [707, 397], [841, 397]].map(([x, y]) => html`<${Deco} key=${`${x}-${y}`}
                n="team_boss_start_cross" class="fa2__x" box=${[x - 5.5, y - 6, 11, 12]} />`)}
              <${FaNode} n=${shown} />
            </div>
          </div>
          <div class="fa2__lead" aria-hidden="true">
            <${EArt} src=${BATTLE('team_boss_frame')} class="fa2__brk" box=${[798, 312, 9, 78]} />
            <${EArt} src=${BATTLE('team_boss_frame')} class="fa2__brk fa2__brk--r" box=${[1052, 312, 9, 78]} />
            <i class="fa2__crest" style=${`--m:url("${END_ART('icon_boss_normal_white')}")`}></i>
            <${EArt} src=${BATTLE('team_boss_doc_text')} class="fa2__doc" box=${[877, 467, 100, 12]} />
            <span class="fa2__badge">
              <${EArt} src=${BATTLE('boss_bg_normal')} box=${[0, 0, 122, 122]} />
              <i class="fa2__flash"></i>
              <span class="fa2__boss"><${Img} src=${bossIconOf(bossId)} /></span>
              <${EArt} src=${BATTLE('icon_boss')} box=${[49, 73, 24, 26]} />
            </span>
          </div>
          <div class="fa2__words">
            <span class="fa2__micro">${t('最终攻势')}</span>
            <b class="fa2__title">${t('合力击败敌方领袖！')}</b>
          </div>
        </div>
        <i class="bst__scan" style=${`--scan:url("${END_ART('img_screen_line')}")`}></i>
      </div>
    </div>
  </div>`;
}

/** An end-screen sprite (or `src`) at its box on the 1280 stage (frame px: left, top, width, height). */
function EArt({ n, src = END_ART(n), class: cls, box, style = '' }) {
  const [l, tp, w, h] = box;
  return html`<img class=${cx('bst__img', cls)} src=${src} alt="" draggable="false" decoding="sync"
    style=${`left:${fp(l)};top:${fp(tp)};width:${fp(w)};height:${fp(h)};${style}`} />`;
}
const fp = (n) => `calc(${n} * var(--fp))`;

/** The small grey triangle with red bars under the hidden core's portrait (drawn after the footage, [OUR]). */
const CoreTri = ({ class: cls }) => html`<svg class=${cls} viewBox="0 0 70 40" aria-hidden="true">
  <path d="M35 2 L68 38 L2 38 Z" fill="none" stroke="rgba(150,160,160,.75)" stroke-width="2" />
  <path d="M14 22h8M14 27h8M48 22h8M48 27h8" stroke="#e23a32" stroke-width="2.4" />
</svg>`;

/** One red glitch block of the core plate, stage px. */
const GL = (x, y, w, h) => `left:${fp(x)};top:${fp(y)};width:${fp(w)};height:${fp(h)}`;

/**
 * 隐秘核心已解锁: the hidden round begins. Layers (video 11:25.5–11:28.2): the dark window (bg_type_01) opening from its
 * middle, the glitched crest (boss_sp_icon: its black silhouette flickers, shifts with dim red blocks, then lights up
 * with the bright red blocks and the halo flare), the halo settling to a faint disc and rim, warnings, brackets, the
 * core's portrait over its small crest (icon_boss_sp_large), the words. Block boxes and every timing read off the frames.
 * @param {{ bossId?: string|null, onDone?: Function }} props
 */
export function HiddenCorePlate({ bossId = null, onDone }) {
  const leaving = useTimedLeave(CORE_PLATE_MS, onDone, 300);
  const crest = END_ART('boss_sp_icon');
  const side = `--m:url("${BATTLE('dec_line_side')}")`;
  return html`<div class=${cx('bpl', 'bst', 'bst--core', leaving && 'is-leaving')} role="status" aria-live="polite" data-testid="core-plate">
    <div class="bst__stage">
      <i class="bst__dim" aria-hidden="true"></i>
      <div class="bst__win core2__win" aria-hidden="true">
        <${EArt} n="bg_type_01" class="core2__bg" box=${[-26, -90, 988, 546]} />
        <i class="bst__scan" style=${`--scan:url("${END_ART('img_screen_line')}")`}></i>
      </div>
      <div class="core2__fx" aria-hidden="true">
        <i class="core2__halo"></i><i class="core2__ring"></i>
        <i class="core3__gl core3__gl--a"><i style=${GL(222, 353, 242, 109)}></i><i style=${GL(614, 420, 183, 100)}></i><i style=${GL(222, 228, 150, 67)}></i><i style=${GL(514, 308, 474, 20)}></i></i>
        <i class="core3__gl core3__gl--b"><i class="core3__wash" style=${GL(172, 195, 926, 340)}></i><i style=${GL(272, 222, 268, 98)}></i><i style=${GL(274, 366, 198, 104)}></i><i style=${GL(742, 258, 132, 34)}></i><i style=${GL(720, 322, 274, 28)}></i><i style=${GL(604, 430, 196, 65)}></i></i>
        <i class="core3__gl core3__gl--c"><i class="core3__wash" style=${GL(172, 195, 926, 340)}></i><i style=${GL(272, 222, 348, 108)}></i><i style=${GL(272, 360, 206, 110)}></i><i style=${GL(520, 375, 378, 90)}></i><i style=${GL(718, 322, 280, 38)}></i><i style=${GL(742, 258, 154, 62)}></i></i>
        <i class="core2__beam core2__beam--l" style=${side}></i><i class="core2__beam core2__beam--r" style=${side}></i>
        <i class="core2__brk core2__brk--l"><b></b></i><i class="core2__brk core2__brk--r"><b></b></i>
        <${EArt} src=${BATTLE('icon_warn')} class="core2__warn core2__warn--a" box=${[393, 266, 46, 41]} />
        <${EArt} src=${BATTLE('icon_warn')} class="core2__warn core2__warn--b" box=${[828, 296, 36, 32]} />
        <${EArt} src=${BATTLE('icon_warn')} class="core2__warn core2__warn--c" box=${[450, 385, 27, 25]} />
        <span class="core2__crest">
          <i class="core2__ghost" style=${`--m:url("${crest}")`}></i>
          <${EArt} n="boss_sp_icon" class="core2__icon" box=${[0, 0, 360, 257]} />
        </span>
        <span class="core2__boss">
          <${Img} src=${bossIconOf(bossId)} />
          <${CoreTri} class="core2__tri" />
          <${EArt} n="icon_boss_sp_large" class="core2__mini" box=${[11.5, 36.5, 25, 25]} />
        </span>
      </div>
      <b class="core2__title">${t('隐秘核心已解锁')}</b>
      <span class="core2__sub">${t('挑战失败不影响最终结算')}</span>
    </div>
  </div>`;
}

/**
 * 击败了全部领袖！ (video 11:30.0–11:33.1, r16/win/src30 f005 = 0 ms). The event's sprites only: the teal entrance
 * (0.17–0.3 s) is dec_triangle_line's two bars as the big triangle's legs and base closing in, two teal lines and four
 * round_cross marks moving out, the window (bg_type_01) fading in tinted teal; at 0.33 s the red window with its side
 * glows (bg_side_effect), both win crests (icon_win_boss / _sp, striped while the window is teal, lit to 0.73 s) and the
 * red dec_line; 0.45–0.63 s each leader's portrait on its own plate (boss_bg_normal + icon_boss_tiny / boss_bg_sp +
 * icon_boss_sp_tiny), the ✓ disc (icon_complete, red) popping in large, the + marks and the words (img_text_win_all);
 * 0.87–1.1 s a glow (boss_clear_icon_add) flares over each portrait and its ✓ (boss_clear / _sp) flies in; at END_CUT_MS
 * the window goes in 0.13 s and the dimmed field comes back 0.3 s later. Positions and timings read off the frames.
 */
const WIN_TRI = ['la', 'ra', 'lb', 'rb', 'lc', 'rc'];
function AllClear({ bossId, hiddenBossId }) {
  const tri = `--m:url("${BATTLE('dec_triangle_line')}")`;
  const glow = `--m:url("${BATTLE('boss_clear_icon_add')}")`;
  return html`<div class="bst__stage">
    <i class="bst__dim" aria-hidden="true"></i>
    <div class="bst__win win2__win" aria-hidden="true">
      <${EArt} n="bg_type_01" class="win2__bg" box=${[-24, -75, 1008, 520]} />
      <${EArt} n="bg_type_01_effect" class="win2__fx" box=${[0, -30, 946, 433]} />
      <${EArt} n="bg_side_effect" class="win2__side win2__side--l" box=${[0, 2, 280, 368]} />
      <${EArt} n="bg_side_effect" class="win2__side win2__side--r" box=${[667, 2, 280, 368]} />
      <i class="bst__scan" style=${`--scan:url("${END_ART('img_screen_line')}")`}></i>
    </div>
    <div class="win2__body" aria-hidden="true">
      <i class="win2__back" style=${`--m:url("${END_ART('icon_boss_back')}")`}></i>
      ${WIN_TRI.map((k) => html`<i key=${k} class=${`win2__tri win2__tri--${k}`} style=${tri}></i>`)}
      <i class="win2__hl win2__hl--l"></i><i class="win2__hl win2__hl--r"></i>
      ${[0, 1, 2, 3].map((i) => html`<${EArt} key=${i} src=${BATTLE('round_cross')} class=${`win2__pin win2__pin--${i}`}
        box=${[i < 2 ? 310 : 948, i % 2 ? 363 : 285, 20, 20]} />`)}
      <${EArt} src=${BATTLE('dec_line')} class="win2__rl win2__rl--l" box=${[190, 327, 280, 12]} />
      <${EArt} src=${BATTLE('dec_line')} class="win2__rl win2__rl--r" box=${[810, 327, 280, 12]} />
      <${EArt} n="icon_win_boss" class="win2__crest win2__crest--l" box=${[452, 208, 240, 240]} />
      <${EArt} n="icon_win_boss_sp" class="win2__crest win2__crest--r" box=${[592, 209, 240, 240]} />
      <${EArt} src=${BATTLE('boss_bg_normal')} class="win2__plate" box=${[410, 263, 122, 122]} />
      <span class="win2__ava win2__ava--l"><${Img} src=${bossIconOf(bossId)} /></span>
      <${EArt} src=${BATTLE('icon_boss_tiny')} class="win2__plate" box=${[446, 325, 50, 50]} />
      <${EArt} src=${BATTLE('boss_bg_sp')} class="win2__plate" box=${[744, 272, 124, 124]} />
      <span class="win2__ava win2__ava--r"><${Img} src=${bossIconOf(hiddenBossId)} /></span>
      <${EArt} src=${BATTLE('icon_boss_sp_tiny')} class="win2__plate" box=${[766, 309, 84, 84]} />
      <i class="win2__glow win2__glow--l" style=${glow}></i><i class="win2__glow win2__glow--r" style=${glow}></i>
      <${EArt} n="boss_clear" class="win2__done" box=${[476, 290, 34, 34]} />
      <${EArt} n="boss_clear_sp" class="win2__done" box=${[810, 291, 31, 32]} />
      ${[[491, 393], [765, 393], [765, 256]].map(([x, y], i) => html`<${EArt} key=${i} src=${BATTLE('round_cross')}
        class=${cx('win2__plus', i === 2 && 'win2__plus--top')} box=${[x, y, 24, 24]} />`)}
      <${EArt} src=${BATTLE('icon_complete')} class="win2__check" box=${[618, 371, 44, 44]} />
      <${EArt} n="img_text_win_all" class="win2__words" box=${[472, 388, 337, 119]} />
    </div>
  </div>`;
}

/**
 * 未能击破隐秘核心 (video 11:34.3–11:36.2, r16/cfail/src30 f028 = 0 ms): the run is won, the hidden core stands. The
 * event's sprites only: the orange window (bg_type_02) fading in over 0.3 s with its corner texts and side numbers; the
 * leader's crest (icon_boss_normal_white) black, the core's (boss_sp_icon) teal over its dark triangle (icon_boss_back),
 * both coming in 0.13–0.37 s; the leader's crest flickers out 0.43–0.57 s and comes back black with the orange ✓ disc
 * (icon_complete) flashing in at 0.6–0.67 s, while the words come up and the portraits fade in on their plates; the
 * leader's glow and ✓ (boss_clear) 0.87–1.1 s as in 击败了全部领袖！. At CF_CUT_MS the window goes in 0.17 s, the dim
 * holds and lifts by CF_FADE_MS. Positions fitted to f040 / f060 (sprite masks), timings read off the frames.
 */
function CoreFail({ bossId, hiddenBossId }) {
  const glow = `--m:url("${BATTLE('boss_clear_icon_add')}")`;
  return html`<div class="bst__stage">
    <i class="bst__dim" aria-hidden="true"></i>
    <div class="bst__win cf2__win" aria-hidden="true">
      <${EArt} n="bg_type_02" class="cf2__bg" box=${[-41.5, -18, 961, 399]} />
      <i class="bst__scan" style=${`--scan:url("${END_ART('img_screen_line')}")`}></i>
    </div>
    <div class="cf2__body" aria-hidden="true">
      <span class="cf2__decos">
        <${Deco} n="dec_text_upper_left_01" box=${[190, 217, 72, 13]} />
        <${Deco} n="dec_text_lower_corner" box=${[180, 444, 100, 64]} crop=${[0, 0, 224, 64]} />
        <${Deco} n="dec_text_lower_corner" box=${[1022, 467, 74, 50]} crop=${[150, 0, 224, 64]} />
        <${Deco} n="dec_text_side_num" class="cf2__num" box=${[193, 296, 16, 72]} />
        <${Deco} n="dec_text_side_num" class="cf2__num" box=${[1068, 296, 16, 72]} />
        <${Deco} n="dec_tiny_text_02" box=${[535, 471, 210, 8]} />
      </span>
      <i class="cf2__ln cf2__ln--l"></i><i class="cf2__ln cf2__ln--r"></i>
      ${[[425, 247, 't'], [425, 385, 'b'], [855, 247, 't'], [855, 385, 'b'], [340, 284, 'l'], [340, 349, 'l'], [940, 284, 'r'],
        [940, 349, 'r']].map(([x, y, k], i) => html`<i key=${i} class=${`cf2__pin cf2__pin--${k}`}
        style=${`left:${fp(x - 10)};top:${fp(y - 10)};--m:url("${BATTLE('round_cross')}")`}></i>`)}
      <${EArt} n="icon_boss_back" class="cf2__back" box=${[522, 107, 420, 412]} />
      <${EArt} n="boss_sp_icon" class="cf2__core" box=${[615, 213, 229, 164]} />
      <i class="cf2__crest" style=${`--m:url("${END_ART('icon_boss_normal_white')}")`}></i>
      <${EArt} src=${BATTLE('icon_complete')} class="cf2__check" box=${[524, 279, 54, 54]} />
      <${EArt} src=${BATTLE('boss_bg_normal')} class="cf2__plate" box=${[548, 305.5, 104, 104]} />
      <span class="win2__ava cf2__ava cf2__ava--l"><${Img} src=${bossIconOf(bossId)} /></span>
      <${EArt} src=${BATTLE('icon_boss_tiny')} class="cf2__plate" box=${[578.75, 358.25, 42.5, 42.5]} />
      <${EArt} src=${BATTLE('boss_bg_sp')} class="cf2__plate" box=${[737.5, 325.5, 99, 99]} />
      <span class="win2__ava cf2__ava cf2__ava--r"><${Img} src=${bossIconOf(hiddenBossId)} /></span>
      <${EArt} src=${BATTLE('icon_boss_sp_tiny')} class="cf2__plate" box=${[755, 355, 67, 67]} />
      <i class="win2__glow cf2__glow" style=${glow}></i>
      <${EArt} n="boss_clear" class="win2__done" box=${[605.5, 325.5, 29, 29]} />
    </div>
    <b class="cf2__title">${t('未能击破隐秘核心')}</b>
  </div>`;
}

/**
 * 模拟中断 (video 11:37.25–11:39.3, r16/abort/src30 f023 = 0 ms), on the event's sprites: the window's map (bg_type_01)
 * and scan lines, its corner texts (dec_text_upper_left_01 / _02, dec_text_lower_corner) in dim red; five lanes of chain
 * links, teal (img_link_01 over img_link_02) sweeping in right-first 0.13–0.37 s, flipping left-first to the broken red
 * chain (img_link_out) 0.7–0.93 s; the four + marks (img_dec_cross) running out to the corners 0.03–0.27 s, the ✕
 * (img_dec_cross_2) from 0.9 s; the side lines (fx_line_mesh teal, dec_line red); STRONGHOLD PROTOCOL
 * (dec_stronghold_protocol) and the title sliding in smeared; the window's red pulse 0.9–1.77 s; the window folds to its
 * middle line 1.8–1.87 s, the words smear and break up (mosaic_disturb) to 1.9 s. Every box fitted on the frames (lanes:
 * sprite-mask IoU .86–.89 at scale 1), every step one footage frame. Ours: the words are live text (no image of 模拟中断
 * in the pack) and the dashes over them are drawn.
 */
/** The lanes, k = -2..2 (51 px apart on the frame): the teal pair's and the red chain's centres. */
const ABORT_LANES = [-2, -1, 0, 1, 2];
/** The marks' homes and their glyph in the 132 px 9-slice sprites (centre of each quadrant's 20 px glyph). */
const ABORT_MARKS = [[339, 281, 1, 1, 32.5, 34.5], [931, 281, -1, 1, 96.5, 34.5], [339, 420.5, 1, -1, 32.5, 98.5],
  [931, 420.5, -1, -1, 96.5, 98.5]];
function Abort() {
  const mz = `--mz:url("${BATTLE('mosaic_disturb')}")`;
  return html`<div class="bst__stage" style=${mz}>
    <i class="bst__dim" aria-hidden="true"></i>
    <div class="abt__frame" aria-hidden="true">
      <div class="bst__win abt__win">
        <${EArt} n="bg_type_01" class="abt__bg" box=${[-31, -120, 1008, 520]} />
        <i class="bst__scan" style=${`--scan:url("${END_ART('img_screen_line')}")`}></i>
        <i class="abt__pulse"></i>
      </div>
      <i class="abt__tint"></i>
      <${Deco} n="dec_text_upper_left_01" class="abt__deco" box=${[200, 257, 72, 13]} />
      <${Deco} n="dec_text_upper_left_02" class="abt__deco" box=${[196, 292, 84, 48]} />
      <${Deco} n="dec_text_lower_corner" class="abt__deco" box=${[195, 397, 100, 64]} crop=${[0, 0, 224, 64]} />
      <${Deco} n="dec_text_lower_corner" class="abt__deco" box=${[1020, 397, 74, 64]} crop=${[150, 0, 224, 64]} />
      <i class="abt__ln abt__ln--tl" style=${`--m:url("${BATTLE('fx_line_mesh')}")`}></i>
      <i class="abt__ln abt__ln--tr" style=${`--m:url("${BATTLE('fx_line_mesh')}")`}></i>
      <i class="abt__ln abt__ln--rl" style=${`--m:url("${BATTLE('dec_line')}")`}></i>
      <i class="abt__ln abt__ln--rr" style=${`--m:url("${BATTLE('dec_line')}")`}></i>
      ${ABORT_LANES.map((k, i) => html`<span key=${k} class=${`abt__lane abt__lane--${i}`}>
        <${EArt} src=${BATTLE('img_link_01')} class="abt__lk abt__lk--u" box=${[561 + 51 * k, 247, 44, 132]} />
        <${EArt} src=${BATTLE('img_link_02')} class="abt__lk abt__lk--l" box=${[484 + 51 * k, 304, 44, 172]} />
        <${EArt} src=${BATTLE('img_link_out')} class="abt__lk abt__lk--r" box=${[519 + 51 * k, 205, 44, 300]} />
      </span>`)}
      ${ABORT_MARKS.map(([x, y, sx, sy, gx, gy], i) => ['', '_2'].map((v) => html`<i key=${i + v}
        class=${cx('abt__mk', v ? 'abt__mk--x' : 'abt__mk--p')}
        style=${`left:${fp(x - 10)};top:${fp(y - 10)};--sx:${sx};--sy:${sy};--m:url("${BATTLE('img_dec_cross' + v)}");--mp:${fp(10 - gx)} ${fp(10 - gy)}`}></i>`))}
    </div>
    <div class="abt__body" aria-hidden="true">
      <span class="abt__dashes">${[0, 1, 2, 3].map((i) => html`<i key=${i} style=${`--i:${i}`}></i>`)}</span>
      <b class="abt__title">${t('模拟中断')}</b>
      <b class="abt__title abt__ghost">${t('模拟中断')}</b>
      <${EArt} src=${BATTLE('dec_stronghold_protocol')} class="abt__sub" box=${[709.5, 385.5, 181, 19.3]} />
      <${EArt} src=${BATTLE('dec_stronghold_protocol')} class="abt__sub abt__ghost" box=${[709.5, 385.5, 181, 19.3]} />
    </div>
  </div>`;
}

/**
 * The run's end (endPlateOf kinds), over the field in the server's last pause before RESULT.
 * @param {{ kind: 'allClear'|'coreFail'|'abort', bossId?: string|null, hiddenBossId?: string|null, onDone?: Function }} props
 */
export function EndPlate({ kind, bossId = null, hiddenBossId = null, onDone }) {
  const all = kind === 'allClear';
  const abort = kind === 'abort';
  const leaving = useTimedLeave(all ? END_CUT_MS : abort ? ABORT_MS : CF_CUT_MS, onDone,
    all ? END_FADE_MS : abort ? ABORT_FADE_MS : CF_FADE_MS);
  if (all) {
    return html`<div class=${cx('bpl', 'bst', 'bst--win', leaving && 'is-leaving')} role="status" aria-live="polite"
        aria-label=${t('击败了全部领袖！')} data-testid="end-plate">
      <${AllClear} bossId=${bossId} hiddenBossId=${hiddenBossId} />
    </div>`;
  }
  if (abort) {
    return html`<div class=${cx('bpl', 'bst', 'bst--abort', leaving && 'is-leaving')} role="status" aria-live="polite"
        aria-label=${t('模拟中断')} data-testid="end-plate">
      <${Abort} />
    </div>`;
  }
  return html`<div class=${cx('bpl', 'bst', 'bst--cfail', leaving && 'is-leaving')} role="status" aria-live="polite"
      aria-label=${t('未能击破隐秘核心')} data-testid="end-plate">
    <${CoreFail} bossId=${bossId} hiddenBossId=${hiddenBossId} />
  </div>`;
}
