// 「全能的」可露希尔 theme — the in-match top bar's centre ([uc]ac_s_closur group_hud), replacing the default band of
// ui/hud.js TopBar when the theme is on (acTheme.js). Drawn from the theme footage (2026-11-09 recording, 1280×588;
// one design px = 0.8167 px there; positions found with tools/match.py, every sprite 1:1):
//   board_main (the dark bar with its cables) over board_shadow; under the window the three TVs bg_tv_normal
//   (bg_tv_battle in battle, bg_tv_boss in boss rounds); left 回合 + the cyan folder round_num_back with the round in
//   dark ink; right icon_hp + the LP in white; the two 🔍 buttons btn_check_myself (cyan) / btn_check_enemy (amber).
//   The window: rest_window_back (blue) with the winged cat rest_cat + 休息一下 in prep, battle_window_back (amber)
//   with the bat start_battle_bat + kills n/m (n in gold) in battle; small stars twinkle at its ends.
// Phase scenes (same triggers as the default's capsuleFxKind, footage 40.4–42.8 s and 96.45–99.0 s):
//   wait   回合开始 — a CD (rest_disc) spins on a teal glow (rest_back_light), pink stars burst at both ends;
//   rest   → 休整期 — the CD goes, the cat pops up in the middle, then slides left as 休息一下 wipes in;
//   clash  作战 — a light dot opens into a glowing bar (start_back_light) carrying the bat's face (start_bat), which
//          turns into the game stick (start_game_stick); the stick slides left as 开始作战 wipes in, holds, and the
//          window fades to the bat + kills counter (≈2.5 s in all).
// Leaks (2026-11-10 recording 07-04-02, 369–382 s): while the own battle runs, the runner tag miss_back (the orange
// pill with the runner and ×, the count after them in orange) hangs under the battle window, centred, over its lower
// edge; every new leak bumps the count and a red glow runs over the tag (~330 ms); when the battle ends it fades out
// as the LP's −N comes (hud.js closureLp, the −N on hp_miss_back: css ac-closure-battle.css).
// 联防 / boss rounds / 隐秘核心 are not in the footage: the window keeps the default capsule's content (kills ×N tag,
// boss bars …) in the theme's colours — [ASSUMED] until footage of them turns up.
// The bar is laid out on the 1280×720 design grid in rem (1 rem = 66.67 design px, like the rest of the HUD), from the
// screen's top centre (.gtopc: left 50 %, top 0).
import { html, Tooltip } from '/js/ui/components.js';
import { PHASE } from '/shared/constants.js';
import { isCombatPhase, isBossPhase } from '/js/ui/gameLogic.js';
import { acThemeArt } from '/js/ui/acTheme.js';
import { t } from '/shared/i18n.js';
import { ClosureBossWindow, preloadClosureBossArt } from '/js/ui/acClosureBoss.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const art = (name) => acThemeArt(name, 'ac_s_closur');
const Img = ({ n, c }) => html`<img class=${c} src=${art(n)} alt="" draggable="false" />`;

/** The sprites a scene needs at once (fetched when the bar mounts, so the first scene has them). */
const PRELOAD = ['board_main', 'board_shadow', 'bg_tv_normal', 'bg_tv_battle', 'bg_tv_boss', 'rest_window_back', 'battle_window_back',
  'rest_cat', 'rest_cat_wing_L', 'rest_cat_wing_R', 'rest_disc', 'rest_back_light', 'rest_shortcut', 'start_battle_bat',
  'start_battle_bat_wing_L', 'start_battle_bat_wing_R', 'start_back_light', 'start_bat', 'start_game_stick', 'sheet_star',
  'sheet_star2', 'round_num_back', 'icon_hp', 'btn_check_myself', 'btn_check_enemy', 'img_streak_star', 'miss_back', 'hp_miss_back'];
let preloaded = false;
export function preloadClosureHud() {
  if (preloaded || typeof Image !== 'function') return;
  preloaded = true;
  preloadClosureBossArt();
  for (const n of PRELOAD) { const i = new Image(); i.src = art(n); }
}

/** Which window the phase shows: rest (blue, the cat) | battle (amber, the bat) | unite | boss. */
export function closureWindowKind(phase) {
  if (isBossPhase(phase)) return 'boss';
  if (phase === PHASE.UNITE) return 'unite';
  if (isCombatPhase(phase) || phase === PHASE.SETTLE) return 'battle';
  return 'rest';
}

/**
 * Twinkling stars at the window's ends: [left, top, size, delay ms, colour] in design px from the window's corner.
 * Colours: p pink, b blue, c cyan, g green, y yellow, o orange (the footage: pink / blue in prep, green / yellow /
 * orange in battle). The bursts of 回合开始 / 开始作战 are larger and fly outwards (sign of the side).
 */
const STARS = {
  rest: [[12, 22, 13, 0, 'b'], [20, 38, 9, 520, 'p'], [150, 26, 11, 260, 'p'], [144, 42, 8, 780, 'b']],
  battle: [[12, 12, 12, 0, 'c'], [150, 40, 9, 400, 'g'], [20, 36, 7, 700, 'p']],
};
const BURST = {
  wait: [[8, 14, 15, 0, 'p'], [16, 34, 12, 160, 'p'], [4, 26, 9, 400, 'b'], [26, 22, 8, 620, 'p'],
    [150, 14, 14, 90, 'p'], [142, 36, 12, 300, 'p'], [156, 26, 9, 520, 'b'], [134, 22, 8, 700, 'p']],
  clash: [[8, 16, 16, 0, 'g'], [18, 34, 13, 140, 'y'], [4, 28, 10, 380, 'o'], [28, 22, 9, 600, 'g'],
    [152, 16, 15, 80, 'g'], [144, 38, 13, 260, 'o'], [158, 28, 10, 480, 'y'], [136, 24, 9, 680, 'g']],
};

function Stars({ list, burst = false }) {
  return list.map(([x, y, s, d, c]) => html`<i class=${cx('gtopc__star', `is-${c}`, burst && 'is-burst')}
    style=${`--x:${x};--y:${y};--s:${s};--d:${d}ms;--k:${x > 82 ? 1 : -1}`} aria-hidden="true"></i>`);
}

/** The window's resting content per kind (the default capsule's, re-skinned, for 联防 / boss). */
function WindowContent({ kind, hud, capsule }) {
  if (kind === 'rest') {
    return html`<span class="gtopc__rest">
      <span class="gtopc__cat" aria-hidden="true"><${Img} n="rest_cat_wing_L" c="gtopc__wing gtopc__wing--l" /><${Img} n="rest_cat_wing_R" c="gtopc__wing gtopc__wing--r" /><${Img} n="rest_cat" c="gtopc__catbody" /></span>
      <b class="gtopc__word">${t('休息一下')}</b>
    </span>`;
  }
  if (kind === 'battle') {
    const n = hud?.resolved ?? hud?.killed ?? 0;
    return html`<span class="gtopc__fight">
      <span class="gtopc__bat" aria-hidden="true"><${Img} n="start_battle_bat_wing_L" c="gtopc__wing gtopc__wing--bl" /><${Img} n="start_battle_bat_wing_R" c="gtopc__wing gtopc__wing--br" /><${Img} n="start_battle_bat" c="gtopc__batbody" /></span>
      <span class="gtopc__kills num"><b key=${n}>${n}</b>/${hud?.total ?? '--'}</span>
    </span>`;
  }
  return html`<span class="gtopc__other">${capsule}</span>`;
}

function Scene({ kind }) {
  if (kind === 'wait') {
    return html`<span class="gtopc__fx gtopc__fx--wait" aria-hidden="true">
      <${Img} n="rest_back_light" c="gtopc__disclight" /><${Img} n="rest_cat" c="gtopc__peek" /><${Img} n="rest_disc" c="gtopc__disc" /><${Img} n="rest_shortcut" c="gtopc__shortcut" />
      <${Stars} list=${BURST.wait} burst=${true} />
    </span>`;
  }
  if (kind === 'rest') {
    return html`<span class="gtopc__fx gtopc__fx--rest" aria-hidden="true"><${Img} n="rest_back_light" c="gtopc__disclight" /><${Img} n="rest_disc" c="gtopc__disc" /></span>`;
  }
  if (kind === 'clash') {
    return html`<span class="gtopc__fx gtopc__fx--clash" aria-hidden="true">
      <i class="gtopc__dot"></i><${Img} n="start_back_light" c="gtopc__startlight" /><${Img} n="start_bat" c="gtopc__startbat" />
      <span class="gtopc__go"><${Img} n="start_game_stick" c="gtopc__stick" /><b class="gtopc__goword">${t('开始作战')}</b></span>
      <${Stars} list=${BURST.clash} burst=${true} />
    </span>`;
  }
  return null;
}

/** The runner tag ×N under the battle window (n > 0: the own battle's leaks so far; keyed so each new leak flashes). */
function MissPill({ n }) {
  return html`<span class="gtopc__miss" data-testid="closure-miss" title=${t('本回合已有 {n} 个敌人进入蓝门', { n })}
      aria-label=${t('漏怪 {n}', { n })}>
    <${Img} n="miss_back" c="gtopc__missback" />
    <i class="gtopc__missflash" key=${`f${n}`} aria-hidden="true"></i>
    <b class="gtopc__missn num" key=${n}>${n}</b>
  </span>`;
}

/**
 * The monitor bezel above the bar (no sprite of it in the theme pack — the footage's shape redrawn): a dark top panel and,
 * on each side, a double line coming down and turning in along the bar's top edge — teal in prep, amber in battle,
 * red in boss rounds (CSS --gl). Design px from the screen's top centre.
 */
function Bezel() {
  // footage px → design: the outer band 464–473 / 810–819 px (11 design px wide, down to y ≈ 19), the inner one
  // 478–483 / 800–803 px (6 wide, down to y ≈ 11); prep rgb(36,80,77), battle rgb(89,60,28) — muted, no glow
  const side = (k) => html`<g transform=${k > 0 ? 'scale(-1 1)' : ''}>
    <path class="gtopc__bezelline" d="M -215.5 -1 H -204.5 V 14 Q -204.5 19 -199.5 21 L -206 21 Q -215.5 19 -215.5 12 Z" />
    <path class="gtopc__bezelline is-inner" d="M -198.4 -1 H -192.3 V 9 Q -192.3 12 -189 13 L -194 13 Q -198.4 12 -198.4 8 Z" />
  </g>`;
  return html`<svg class="gtopc__bezel" viewBox="-260 0 520 40" aria-hidden="true">
    ${side(-1)}${side(1)}
  </svg>`;
}

/** A 🔍 button of the theme (same bindings as hud.js CheckBtn). */
function ChkBtn({ side, label, tip, grey, on, disabled, onClick, testid }) {
  return html`<${Tooltip} text=${tip} placement="bottom">
    <button type="button" class=${cx('gtopc__chk', `gtopc__chk--${side}`, 'tapx', grey && 'is-grey', on && 'is-on')} aria-label=${label}
      aria-disabled=${disabled ? 'true' : 'false'} data-testid=${testid} onClick=${onClick}>
      <${Img} n=${side === 'l' ? 'btn_check_myself' : 'btn_check_enemy'} c="gtopc__chkimg" />
    </button>
  <//>`;
}

/**
 * The theme's top-bar centre.
 * @param {{ phase: string, roundText: string, lp: number|null, lpEl: any, capsule: any, hud: any, fx: { kind: string|null, seq: number },
 *   btn: ReturnType<import('/js/ui/hud.js').checkButtons>, noChk: boolean, drawer: any, pen: boolean, onLeft: Function, onRight: Function,
 *   miss?: number|null }} props  miss: the own battle's leaks so far (hud.js closureLp; null = no tag)
 */
export function ClosureHudCenter({ phase, roundText, lpEl, capsule, hud, fx, btn, noChk, drawer, pen, onLeft, onRight, miss = null }) {
  preloadClosureHud();
  const kind = closureWindowKind(phase);
  const tv = kind === 'boss' ? 'bg_tv_boss' : kind === 'rest' ? 'bg_tv_normal' : 'bg_tv_battle';
  const back = kind === 'rest' ? 'rest_window_back' : 'battle_window_back';
  const scene = fx?.kind && fx.kind !== 'enter' ? fx.kind : null;
  // the grid's centre cell stays (an empty slot), so the countdown keeps its right-hand column; the bar itself hangs from
  // the header (the slot is not positioned)
  return html`<div class="gtop__center gtopc-slot"><div class=${cx('gtopc', `gtopc--${kind}`, noChk && 'is-nochk')} data-testid="closure-hud">
    <${Img} n="board_shadow" c="gtopc__shadow" />
    <${Img} n="board_main" c="gtopc__board" />
    <${Bezel} />
    <i class="gtopc__glow gtopc__glow--l" aria-hidden="true"></i><i class="gtopc__glow gtopc__glow--r" aria-hidden="true"></i>
    <${Img} n=${tv} c="gtopc__tv" />
    <div class="gtopc__round">
      <span class="gtopc__roundlabel">${t('回合')}</span>
      <span class="gtopc__folder"><${Img} n="round_num_back" c="gtopc__folderimg" /><b class="gtopc__roundnum num" key=${roundText}>${roundText}</b></span>
    </div>
    <div class="gtopc__lp">${lpEl}</div>
    ${phase === PHASE.FINAL_ASSAULT ? html`<${ClosureBossWindow} key=${`final${fx?.seq ?? 0}`} capsule=${capsule} />` : html`<div class=${cx('gtopc__win', scene && `is-fx-${scene}`, fx?.kind === 'enter' && 'is-fx-enter')} key=${`win${fx?.seq ?? 0}`} role="status">
      <${Img} n=${back} c="gtopc__winback" />
      <span class="gtopc__content"><${WindowContent} kind=${kind} hud=${hud} capsule=${capsule} /></span>
      ${scene ? html`<${Scene} kind=${scene} />` : html`<${Stars} list=${STARS[kind === 'rest' ? 'rest' : 'battle']} />`}
    </div>`}
    ${miss > 0 && kind === 'battle' ? html`<${MissPill} n=${miss} />` : null}
    <span class="gtopc__chkwrap gtopc__chkwrap--l">
      <${ChkBtn} side="l" label=${btn.left.label} tip=${btn.left.tip} on=${!!drawer && !pen} onClick=${onLeft} testid="check-player" />
    </span>
    <span class="gtopc__chkwrap gtopc__chkwrap--r">
      <${ChkBtn} side="r" label=${btn.right.label} tip=${btn.right.tip} grey=${btn.right.grey} disabled=${btn.right.grey && !pen} onClick=${onRight} testid="check-enemy" />
    </span>
  </div></div>`;
}
