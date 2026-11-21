// 「请选择策略」 — the band the event's strategy draft plays when the pick becomes the player's (video 6:46 and 7:18), drawn
// with the official sprites: the screen dims, a light-grey band slides in from the left carrying the STRONGHOLD PROTOCOL
// mark (settle/common_logo), the contour map (battleReady/bg_terrain) and the ship's outline (battleReady/rhodes_outline),
// a teal fill wipes over it with 请选择策略 and the ring (battleReady/bg_ring), and the band folds shut (≈ 1.7 s). The
// teal square at its right end carries the round plate's robot head (roundStartDialog/round_emoji_head) — [ASSUMED] the
// footage's face there (a winking cube) has no sprite of its own in the extraction.
// screens/bandDraft.js shows it with the 轮到你 sound in co-op and in 独立模拟 alike (the maintainer's decision of
// 2026-10-21, as in PR #643; [ASSUMED] for solo — the footage above shows co-op turns only), once the art is in
// (ui/protocolBoot.js onBootArt — fetched as a room is entered, the match screen opens and the draft mounts): at once,
// or as soon as the sprites arrive while the turn is still the player's, up to TURN_BANNER_LATE_MS after it began (a cold
// cache no longer skips it); never with prefers-reduced-motion — the draft's header says whose turn it is. It never
// takes a click (pointer-events none). Styles: css/screens/protocol-boot.css (.tbanner).
import { useEffect } from '/vendor/hooks.module.js';
import { html } from '/js/ui/components.js';
import { t } from '/shared/i18n.js';

/** How long the band stays (its animation's length). */
export const TURN_BANNER_MS = 1700;

/**
 * The latest the band still starts after the turn began, when its sprites were still loading (ms): it waits for them
 * (§35.18's leftover: a cold cache skipped the solo band at 1 s), but not without end — later, the turn is well under
 * way and the band would only cover it. [ASSUMED] the bound (no official counterpart — the event's client has its art
 * at hand); the band never blocks input meanwhile.
 */
export const TURN_BANNER_LATE_MS = 5000;

// 2026-10-27 round 6: the sprites come from the Arkdays pack's copies in img/official/hub/ac/ (the same art under the
// same names: [uc]autochessouter bg_terrain / rhodes_outline / bg_ring / common_logo, [uc]autochessbattle
// round_emoji_head), not the resource pack — the band no longer depends on the pack being admitted.
const AC = new URL('/ui-art/img/official/hub/ac/', location.origin).href;
const AC_FILE = {
  'battleReady/bg_terrain': 'outer/bg_terrain.png', 'battleReady/rhodes_outline': 'outer/rhodes_outline.png',
  'battleReady/bg_ring': 'outer/bg_ring.png', 'settle/common_logo': 'outer/common_logo.png',
  'roundStartDialog/round_emoji_head': 'battle/round_emoji_head.png',
  // the robot's square at the band's right end (video 6:46): the panel, the winking cube with its spark, the pixel line
  emoji_back: 'outer/emoji_back.png', square_1: 'battle/square_1.png', emoji_spark: 'outer/emoji_spark.png',
  cube_subtitle: 'outer/cube_subtitle.png', plus: 'battle/plus.png',
};

/** An official sprite: an image, or (`mask`) a box its shape is painted through in the CSS colour. */
function Art({ k, class: cls, mask = false }) {
  const src = AC_FILE[k] ? AC + AC_FILE[k] : null;
  if (!src) return null;
  return mask
    ? html`<i class=${cls} style=${`--src:url("${src}")`}></i>`
    : html`<img class=${cls} src=${src} alt="" draggable="false" />`;
}

/**
 * The 「请选择策略」 band; calls onDone when it has played.
 * @param {{ onDone?: Function }} props
 */
export function TurnBanner({ onDone }) {
  useEffect(() => {
    const id = setTimeout(() => onDone?.(), TURN_BANNER_MS);
    return () => clearTimeout(id);
  }, []);
  const cross = (pos) => html`<${Art} k="plus" class=${`tbanner__cross tbanner__cross--${pos}`} mask=${true} />`;
  return html`<div class="tbanner" role="status" aria-live="polite" data-testid="turn-banner">
    <div class="tbanner__dim"></div>
    <div class="tbanner__band">
      <div class="tbanner__bar">
        <div class="tbanner__grey" aria-hidden="true">
          <${Art} k="battleReady/bg_terrain" class="tbanner__topo" mask=${true} />
          <${Art} k="battleReady/rhodes_outline" class="tbanner__ship" mask=${true} />
          <${Art} k="settle/common_logo" class="tbanner__logo" mask=${true} />
          ${cross('tl')}${cross('bl')}${cross('tr')}${cross('br')}
        </div>
        <div class="tbanner__teal">
          <${Art} k="battleReady/bg_terrain" class="tbanner__topo" mask=${true} />
          <${Art} k="battleReady/rhodes_outline" class="tbanner__ship" mask=${true} />
          <${Art} k="battleReady/bg_ring" class="tbanner__ring" mask=${true} />
          <span class="tbanner__text">${t('请选择策略')}</span>
          <span class="tbanner__sub" aria-hidden="true">STRONGHOLD PROTOCOL</span>
          ${cross('tl')}${cross('bl')}${cross('tr')}${cross('br')}
        </div>
      </div>
      <span class="tbanner__bot" aria-hidden="true"><${Art} k="emoji_back" class="tbanner__botbg" /><${Art} k="square_1" class="tbanner__head" />
        <${Art} k="emoji_spark" class="tbanner__spark" /><${Art} k="cube_subtitle" class="tbanner__subtitle" /></span>
    </div>
  </div>`;
}
