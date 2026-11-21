// 「全局作战目标」 (the event's footage, video 7:52.4–7:55.1): as the field first comes up after 协议启动！ a dark band crosses
// the middle of the screen — the contour map (goal_bg) on its right, the ring with its hatching and cross-hair on the left
// between two brackets, the tiny 00 / 01 / STRONGHOLD PROTOCOL marks — with the match's goal in two lines: 全局作战目标 in
// green over 消灭敌方领袖！ in white. It fades in while the words wipe in from the left, holds ≈ 2 s and fades; the round
// plate (ui/matchPopups.js RoundPopup) follows it. Shown once, at round 1's 回合开始 (screens/game.js).
// The sprites are the newer Arkdays pack's [uc]autochessbattle goal_* and banner_back (2026-10-27 round 4,
// scripts/build-battle-art.py), in img/official/hub/battle/ — not in the resource pack; positions measured off the video at
// 1280×720 (one --p = one px there). The 2 × 3 squares on the right (round 5) are dec_text_lower_corner's, cropped (its own
// frame holds the same pattern; that the original page draws this very file is not confirmed), tinted green by a mask.
// pointer-events none: the field stays usable under it. Styles: css/screens/goal-banner.css.
import { html } from '/js/ui/components.js';
import { useTimedLeave } from '/js/ui/matchPopups.js';
import { t } from '/shared/i18n.js';
import { AC_THEME, acThemeArt, acThemeId } from '/js/ui/acTheme.js';

const ART = new URL('/ui-art/img/official/hub/battle/', location.origin).href;

/** How long the band holds before it fades (the footage: in at 472.6, out from 474.9). */
export const GOAL_MS = 2300;

/** The match's goal line, or null when it has none to show (no final assault: no leader to defeat). */
export function goalOf(pub) {
  return Number.isFinite(Number(pub?.bossRound)) && Number(pub.bossRound) > 0 ? t('消灭敌方领袖！') : null;
}

const img = (name, cls) => html`<img class=${`gbn__${cls}`} src=${`${ART}${name}.png`} alt="" draggable="false" />`;

export function GoalBanner({ text, onDone }) {
  if (acThemeId() === AC_THEME.CLOSURE) return html`<${ClosureGoalBanner} text=${text} onDone=${onDone} />`;
  return html`<${DefaultGoalBanner} text=${text} onDone=${onDone} />`;
}

function DefaultGoalBanner({ text, onDone }) {
  const leaving = useTimedLeave(GOAL_MS, onDone);
  return html`<div class=${`gbn${leaving ? ' is-leaving' : ''}`} role="status" aria-live="polite" data-testid="goal-banner">
    <div class="gbn__band">
      ${img('banner_back', 'back')}
      ${img('goal_bg', 'map')}
      ${img('goal_round', 'round')}
      <i class="gbn__hatch" aria-hidden="true"></i>
      ${img('goal_cross', 'cross')}
      <i class="gbn__br gbn__br--l" aria-hidden="true"></i><i class="gbn__br gbn__br--r" aria-hidden="true"></i>
      ${img('goal_text_04', 't04')}${img('goal_text_00', 't00')}${img('goal_text_01', 't01')}${img('goal_text_03', 't03')}
      <i class="gbn__sq" aria-hidden="true"></i>
      <div class="gbn__words"><b>${t('全局作战目标')}</b><strong>${text}</strong></div>
    </div>
  </div>`;
}

// ---- 「全能的」可露希尔 theme ([uc]ac_s_closur goal_*) -------------------------------------------------------------------
// The theme footage (2026-11-09 recording, 37.40–39.65 s; a 1280×588 capture, so one design px = 0.8167 px there):
// the same band and the same two lines at the same place as the default, re-skinned — the dark band goal_bg (1043×272,
// centred), a purple perspective floor in its lower half, Closure's dotted sketch goal_avatar on the left between the
// blue »[…] tags goal_desc_2 / goal_desc_1, the »[CLOSURE] caption goal_desc_3 under the words, and on the right the small
// CLOSURE window goal_desc_4 with the cube robot goal_desc_5 on it. 全局作战目标 in cyan (#2DECF6), the goal in white.
// A plain fade (≈180 ms in, ≈200 ms out; no wipe), held ≈2 s, a few blue squares drifting in the band.
// Sprite positions: tools/match.py on the footage (score ≥ .4 where the sprite is opaque), every sprite 1:1.
export const CLOSURE_GOAL_MS = 2150;
const CLOSURE_GOAL_LEAVE_MS = 200;

/** The floor's lines: from a vanishing point above the band (640, 200) through the top row (y 352, every 49 px), rows 25 px apart. */
const FLOOR_ROWS = [352, 377, 402, 427];
const FLOOR_COLS = Array.from({ length: 19 }, (_, i) => 640 + (i - 9) * 49);
const FLOOR_FAR = 352;
const FLOOR_NEAR = 432;
const VP_Y = 200;
const nearX = (x) => 640 + (x - 640) * ((FLOOR_NEAR - VP_Y) / (FLOOR_FAR - VP_Y));

/** [left, top, size, delay ms, drift] of the drifting squares (design px). */
const MOTES = [[452, 300, 5, 0, 1], [610, 338, 4, 260, -1], [742, 296, 6, 120, 1], [806, 352, 4, 520, -1], [968, 306, 5, 380, 1],
  [536, 404, 4, 700, 1], [1012, 386, 4, 200, -1], [690, 412, 5, 900, 1]];

function ClosureGoalBanner({ text, onDone }) {
  const leaving = useTimedLeave(CLOSURE_GOAL_MS, onDone, CLOSURE_GOAL_LEAVE_MS);
  const art = (name, cls) => html`<img class=${`gbnc__${cls}`} src=${acThemeArt(name)} alt="" draggable="false" />`;
  return html`<div class=${`gbn gbn--closure${leaving ? ' is-leaving' : ''}`} role="status" aria-live="polite" data-testid="goal-banner">
    <div class="gbn__band">
      ${art('goal_bg', 'back')}
      <svg class="gbnc__floor" viewBox="0 0 1280 720" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="gbnc-glow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#3a2bd0" stop-opacity="0" /><stop offset="1" stop-color="#4532d8" stop-opacity=".26" />
          </linearGradient>
          <linearGradient id="gbnc-side" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#fff" stop-opacity="0" /><stop offset=".3" stop-color="#fff" stop-opacity="1" />
            <stop offset=".88" stop-color="#fff" stop-opacity="1" /><stop offset="1" stop-color="#fff" stop-opacity="0" />
          </linearGradient>
          <mask id="gbnc-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="1280" height="720"><rect x="330" y="330" width="760" height="104" fill="url(#gbnc-side)" /></mask>
        </defs>
        <g mask="url(#gbnc-mask)">
          <rect x="330" y="318" width="760" height="116" fill="url(#gbnc-glow)" />
          <g stroke="#7a68ff" stroke-opacity=".42" stroke-width="1.1" fill="none">
            ${FLOOR_ROWS.map((y) => html`<line x1="330" y1=${y} x2="1090" y2=${y} />`)}
            ${FLOOR_COLS.map((x) => html`<line x1=${x} y1=${FLOOR_FAR} x2=${nearX(x)} y2=${FLOOR_NEAR} />`)}
          </g>
        </g>
      </svg>
      ${art('goal_avatar', 'avatar')}
      ${art('goal_desc_2', 'tag2')}${art('goal_desc_1', 'tag1')}${art('goal_desc_3', 'cap')}
      ${art('goal_desc_4', 'win')}${art('goal_desc_5', 'cube')}
      ${MOTES.map(([x, y, s, d, k]) => html`<i class="gbnc__mote" style=${`--x:${x};--y:${y};--s:${s};--d:${d}ms;--k:${k}`} aria-hidden="true"></i>`)}
      <div class="gbn__words gbnc__words"><b>${t('全局作战目标')}</b><strong>${text}</strong></div>
    </div>
  </div>`;
}
