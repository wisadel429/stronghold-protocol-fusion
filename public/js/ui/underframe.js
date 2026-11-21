// Underframe — the selection diamond of a tapped own piece (research 09 §1.2 "Tap a deployed unit", §5, §6.5;
// official `act2autochess_panel_character_menu`: `util_btn` icon_sell + price "+1", funcId autochessSale; the
// destroy variant `_underFramePanelBtnParamDestroyPos` with icon_destory).
//
//   board operator  → 撤退 (upper-left: back to the bench) + 出售 +N (upper-right)
//   board summon    → 撤退
//   bench operator  → 出售 +N
//   item / Art      → 销毁
// The diamond frames the piece's tile; only its buttons take pointer events, so the unit under it can still be
// dragged (moving it — or dropping it back on its own tile to re-orient it with the wheel). The game screen shows the
// unit's range tiles (rotated to its facing) and the detail card beside it while it is selected (on the side away
// from the unit, `underframeRect` / gameLogic `panelSide`), and the underframe sits above every HUD panel, so its
// buttons are never covered.
//
// Button look (user playtest #2 item 7): the official sprites icon_sell / icon_destory are WHITE octagon plates with
// the glyph cut out — tinted in the client. Drawn as is they read as a plain white block, so each button is a coloured
// octagon plate: the sprite is used as a CSS mask over the plate colour (出售 amber like every money action, 销毁 /
// 撤退 red) on a dark backing that shows through the glyph cut-out. Without the local sprites the same plate carries
// the built-in glyph.
//
// TempRowNotice (user playtest #3 item 3; the A2 label rule 2026-11-01) — the other board-anchored overlay of the prep:
// while the temp overflow (临时整备区: row 8 cols 4..8 behind the bench; a 2x2 block left of the 20-slot 炸惊 bench —
// `tempSlotsOf`) holds pieces, a dashed red frame around it and a label at its end say that they block 准备就绪 and
// are destroyed when the prep ends unless moved to the bench, equipped or used. Placed through view.tileScreen
// (useTileScreen, so it follows the camera — the Final Assault prep too); it never takes the pointer, so the pieces under
// it stay draggable. The label sits left of the row / right of it when the left has no room, and moves ABOVE the frame
// only when that spot would be covered by the shop bar (`.shopbar`, z 3 over the notice's z 2), so every mode — 炸惊's
// much wider shop bar included — reads it (A2, handoff/temp-overflow-row-a2-b4).

import { html, HexBadge, Icon } from './components.js';
import { GIcon } from './gameComponents.js';
import { useTileScreen, tileScreen } from './facingWheel.js';
import { hotkeyLabelOf } from './settings.js';
import { localAsset } from '../data.js';
import { useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { GEO, tempRowOf } from '../../../shared/constants.js';
import { t, tParts } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Runner glyph of 撤退 (a figure leaving through a door; original shape). */
function RetreatGlyph() {
  return html`<svg class="uframe__glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M13.5 3.2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9.6 8.3l3.7-.6 2.2 3.3 2.7 1-.6 1.8-3.4-1.2-.9-1.3-.8 3.2 2.6 2.6V22h-2v-4.7l-2.4-2.3-.9 3.6-4.4-1 .5-1.9 2.4.5 1.6-6.6-1 .3-1.4 2.8-1.8-.9 1.9-3.6z" />
    <path d="M2 5h5v2H4v10h3v2H2z" opacity=".7" />
  </svg>`;
}

/**
 * A tinted octagon plate: the official sprite (white plate, glyph cut out) as a mask over the tone colour, or the
 * built-in glyph on the same plate when the local sprite is not installed.
 * @param {{ sprite: string, glyph: string, tone: 'sell'|'destroy' }} props
 */
export function PlateIcon({ sprite, glyph, tone }) {
  const url = localAsset('ui/battle', sprite);
  return html`<span class=${cx('uframe__plate', `uframe__plate--${tone}`, url ? 'has-mask' : 'is-glyph')}
      style=${url ? `--uf-mask:url("${url}")` : ''} data-sprite=${url ? sprite : null} aria-hidden="true">
    ${url ? null : html`<${GIcon} name=${glyph} class="uframe__pglyph" />`}
  </span>`;
}

/**
 * Client-px rect the underframe of a tile covers: the diamond plus its buttons (plates, labels, the +N price) — the
 * geometry of the css below (.uframe__btn--retreat / --sell: .56rem plates at 25 % / 75 % across, 25 % down, shifted
 * −80 % / −20 % horizontally and −90 % vertically). Used for the detail panel placement.
 * @param {{ x: number, y: number, s: number }|null} g view.tileScreen(row, col)
 * @param {number} [rem] root font size (px)
 * @returns {{ left: number, right: number, top: number, bottom: number }|null}
 */
export function underframeRect(g, rem = 100) {
  if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) return null;
  const s = g.s > 0 ? g.s : 64;
  const half = s * 1.05;
  const P = rem * 0.56;                 // plate
  const H = P + rem * 0.26;             // plate + label
  const q = half / 2;                   // 25 % / 75 % of the diamond box, from its centre
  const btnTop = g.y - q - 0.9 * H;
  const left = Math.min(g.x - half, g.x - q - 0.8 * P);
  const right = Math.max(g.x + half, g.x + q - 0.2 * P + P + rem * 0.14);
  return { left, right, top: Math.min(g.y - half, btnTop - rem * 0.08), bottom: g.y + half };
}

/**
 * @param {{ view: any, uid?: number|null, row: number, col: number, actions: { retreat: boolean, sell: number|null, destroy: boolean },
 *   name?: string, busy?: boolean, onRetreat?: () => void, onSell?: () => void, onDestroy?: () => void }} props
 */
export function Underframe({ view, uid = null, row, col, actions, name = '', busy = false, onRetreat, onSell, onDestroy }) {
  const g = useTileScreen(view, row, col);
  if (!g || !actions) return null;
  const s = g.s > 0 ? g.s : 64;
  const half = s * 1.05;
  const stop = (e) => e.stopPropagation();
  const keys = { retreat: hotkeyLabelOf('retreat'), sell: hotkeyLabelOf('sell') }; // the player's keys (设置 → 快捷键)
  return html`<div class="uframe" data-uid=${uid} style=${`left:${g.x}px;top:${g.y}px;width:${half * 2}px;height:${half * 2}px`} role="group"
      aria-label=${t('{name} 操作', { name: name || t('单位') })}>
    <svg class="uframe__dia" viewBox="-110 -110 220 220" aria-hidden="true">
      <path class="uframe__outer" d="M0 -100 L100 0 L0 100 L-100 0 Z" />
      <path class="uframe__corner" d="M-100 0 L-86 -14 M-100 0 L-86 14 M100 0 L86 -14 M100 0 L86 14 M0 -100 L-14 -86 M0 -100 L14 -86 M0 100 L-14 86 M0 100 L14 86" />
    </svg>
    ${actions.retreat ? html`<button type="button" class="uframe__btn uframe__btn--retreat" disabled=${busy} onPointerDown=${stop}
        onClick=${(e) => { stop(e); onRetreat?.(); }} title=${actions.sell != null ? t('撤退至整备区（{key}）', { key: keys.retreat }) : t('撤退至整备区')} aria-label=${t('撤退')} aria-keyshortcuts=${actions.sell != null ? keys.retreat : undefined}>
      <${RetreatGlyph} /><span class="uframe__label">${actions.sell != null ? t('撤退[{key}]', { key: keys.retreat }) : t('撤退')}</span>
    </button>` : null}
    ${actions.sell != null ? html`<button type="button" class="uframe__btn uframe__btn--sell" disabled=${busy} onPointerDown=${stop}
        onClick=${(e) => { stop(e); onSell?.(); }} title=${t('出售（+{sell} 资金，{key}）', { sell: actions.sell, key: keys.sell })} aria-label=${t('出售，获得 {sell} 资金', { sell: actions.sell })} aria-keyshortcuts=${keys.sell}>
      <${PlateIcon} sprite="icon_sell" glyph="sell" tone="sell" />
      <span class="uframe__label">${t('出售[{key}]', { key: keys.sell })}</span>
      <${HexBadge} value=${`+${actions.sell}`} tone="gold" size="sm" class="uframe__price" />
    </button>` : null}
    ${actions.destroy ? html`<button type="button" class=${cx('uframe__btn', 'uframe__btn--destroy')} disabled=${busy} onPointerDown=${stop}
        onClick=${(e) => { stop(e); onDestroy?.(); }} title=${t('销毁道具')} aria-label=${t('销毁')}>
      <${PlateIcon} sprite="icon_destory" glyph="trash" tone="destroy" />
      <span class="uframe__label">${t('销毁')}</span>
    </button>` : null}
  </div>`;
}

// ---- the temp overflow row (临时整备区) ---------------------------------------------------------------------------

/**
 * Screen frame of the temp row from its two end tiles (view.tileScreen of cols TEMP_C0 and TEMP_C0 + TEMP_SIZE − 1): the
 * quad [back-left, back-right, front-right, front-left] (back = the far edge, higher on screen — also when the Final
 * Assault prep mirrors the board), its bounds, and the side of the label: left of the row, or right of it when the
 * left has no room for `labelW` px. Pure (test/ui/playtest3.test.js).
 * @param {{ poly: Array<[number, number]> } | null} a @param {{ poly: Array<[number, number]> } | null} b
 * @param {{ labelW?: number, gap?: number, vw?: number }} [opts]
 * @returns {{ quad: Array<[number, number]>, left: number, right: number, top: number, bottom: number, y: number, side: 'left'|'right' } | null}
 */
export function tempRowFrame(a, b, { labelW = 0, gap = 8, vw = Infinity } = {}) {
  const ok = (t) => t && Array.isArray(t.poly) && t.poly.length >= 4 && t.poly.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!ok(a) || !ok(b)) return null;
  const backs = [a.poly[0], a.poly[1], b.poly[0], b.poly[1]];
  const fronts = [a.poly[2], a.poly[3], b.poly[2], b.poly[3]];
  const minX = (pts) => pts.reduce((m, p) => (p[0] < m[0] ? p : m));
  const maxX = (pts) => pts.reduce((m, p) => (p[0] > m[0] ? p : m));
  const quad = [minX(backs), maxX(backs), maxX(fronts), minX(fronts)];
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const side = left - gap - labelW >= 0 || right + gap + labelW > vw ? 'left' : 'right';
  return { quad, left, right, top, bottom, y: (top + bottom) / 2, side };
}

/**
 * Screen frame of a MULTI-ROW temp block (炸惊's 2x2: rows 8/7 × cols -2/-1) from every one of its tiles: the convex
 * hull of their projected quads, its bounds, and the side of the label (the same rule as `tempRowFrame`). A single-row
 * band keeps `tempRowFrame` byte-identical (the C layout); only a block whose slots span two rows takes this path, so
 * the frame encloses all four cells instead of cutting across the block's diagonal.
 * @param {Array<{ poly: Array<[number, number]> } | null>} tiles one per temp slot (`view.tileScreen`)
 * @param {{ labelW?: number, gap?: number, vw?: number }} [opts]
 * @returns {{ quad: Array<[number, number]>, left: number, right: number, top: number, bottom: number, y: number, side: 'left'|'right' } | null}
 */
export function tempBlockFrame(tiles, { labelW = 0, gap = 8, vw = Infinity } = {}) {
  const pts = [];
  for (const t of Array.isArray(tiles) ? tiles : []) {
    if (!t || !Array.isArray(t.poly)) continue;
    for (const p of t.poly) if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push([p[0], p[1]]);
  }
  if (pts.length < 3) return null;
  // unique + lexicographic; monotone chain hull (collinear points dropped, so a single row reduces to its 4 corners)
  const uniq = pts
    .filter((p, i) => pts.findIndex((q) => Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6) === i)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of uniq) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = uniq.length - 1; i >= 0; i--) { const p = uniq[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const quad = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (quad.length < 3) return null;
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const side = left - gap - labelW >= 0 || right + gap + labelW > vw ? 'left' : 'right';
  return { quad, left, right, top, bottom, y: (top + bottom) / 2, side };
}

/**
 * What the temp row's label says will happen to its pieces (server/match/player/basics.js tempDue): a piece is resolved
 * at the end of the first prep in which the player can act on it. Not ready (or outside PREP): at the end of this / the
 * coming prep, and 准备就绪 waits for the row to be cleared. Ready in PREP: Ready is refused while the row holds pieces,
 * so whatever lies there arrived after it — kept through the NEXT prep (cancelling Ready makes it due at this one).
 * @param {boolean} ready m.private ready (during PREP)
 */
export function tempRowRule(ready) {
  return ready
    ? t('已准备就绪后进入的单位保留到下个休整期，届时仍在此处的将被销毁（取消准备则在本休整期结束时销毁）')
    : t('放入整备区或战场、配发或使用后才能准备；休整期结束时仍在此处的将被销毁');
}

/**
 * Where the temp row's label goes (A2, owner 2026-11-01). The label is anchored at one point and the CSS class carries
 * the rest of the transform: `is-left` (the default) `translate(−100%, −50%)` puts its right edge on the anchor,
 * `is-right` `translate(0, −50%)` its left edge, `is-above` `translate(0, −100%)` its bottom edge.
 *
 * Preferred spot: the side `tempRowFrame` picked. If that box intersects the shop bar (`.shopbar` is always above the
 * notice — z 3 over 2 — so a label under it cannot be read at all), it moves ABOVE the frame; if the bar still covers
 * that box (炸惊's bar reaches further left than the frame), it sits left of the bar; with no room left of the bar it
 * stays above and accepts the overlap. Pure: the caller measures the label's own laid-out box
 * (`offsetWidth` / `offsetHeight`) and passes the `.shopbar` rect (test/ui/playtest3.test.js).
 * @param {{ side: 'left'|'right', left: number, right: number, top: number, y: number }} f the frame (`tempRowFrame`)
 * @param {{ w?: number, h?: number }} label the label's laid-out box
 * @param {{ gap?: number, shop?: { left: number, right: number, top: number, bottom: number } | null }} [opts]
 * @returns {{ where: 'side'|'above', left: number, top: number } | null} the anchor point (inline left/top)
 */
export function tempLabelSpot(f, label, { gap = 8, shop = null } = {}) {
  if (!f || !Number.isFinite(f.left) || !Number.isFinite(f.right) || !Number.isFinite(f.y) || !Number.isFinite(f.top)) return null;
  const w = Number.isFinite(label && label.w) ? Math.max(0, label.w) : 0;
  const h = Number.isFinite(label && label.h) ? Math.max(0, label.h) : 0;
  const hit = (left, top) => !!shop && w > 0 && h > 0 &&
    left < shop.right && left + w > shop.left && top < shop.bottom && top + h > shop.top;
  const side = f.side === 'right' ? 'right' : 'left';
  const sideLeft = side === 'left' ? f.left - gap : f.right + gap;
  if (!hit(side === 'left' ? sideLeft - w : sideLeft, f.y - h / 2)) return { where: 'side', left: sideLeft, top: f.y };
  // above the frame, its left edge on the frame's own left edge (anchored on its bottom edge)
  let left = Math.max(gap, f.left);
  const top = f.top - gap;
  if (hit(left, top - h) && shop && shop.left - gap - w >= gap) left = shop.left - gap - w;
  return { where: 'above', left, top };
}

/**
 * The temp row's notice: dashed red frame + label (count, what to do, what happens at the end of the prep — tempRowRule).
 * `label` false (a piece is being dragged / placed): the frame only, nothing over the pieces the player is moving.
 * `slots` = the match's temp table (shared/constants.js `tempSlotsOf`, which `screens/game.js` passes): five cells on the
 * row-8 band, or 炸惊's 2x2 block hung off the left of its 20-slot bench. Without it, `row` / `col` + `cols` describe a
 * single-row band (`tempRowOf` / `tempColOf` for the origin).
 *
 * A2 (owner, 2026-11-01): `tempLabelSpot` decides the label's spot — side, or above the frame when the side spot would
 * be covered by the shop bar. Measured against the real `.shopbar` rect and the label's own laid-out box, once per
 * camera / viewport change, never guessed from the font size.
 * @param {{ view: any, count: number, items?: number, label?: boolean, ready?: boolean, row?: number, col?: number, cols?: number, slots?: Array<{row:number,col:number}> | null }} props
 */
export function TempRowNotice({ view, count, items = 0, label = true, ready = false, row = tempRowOf(GEO.HAND_SIZE), col = GEO.TEMP_C0, cols = GEO.TEMP_SIZE, slots = null }) {
  // `slots` = the match's temp table (shared/constants.js tempSlotsOf): five cells on one row, or 炸惊's 2x2 block hung
  // off the left of its 20-slot bench (rows 8/7, cols -2/-1). One row keeps `tempRowFrame` (the C layout, byte-identical);
  // two rows take the hull of every cell (`tempBlockFrame`) so the dashes enclose all four pads.
  const list = Array.isArray(slots) && slots.length ? slots : null;
  const a = useTileScreen(view, list ? list[0].row : row, list ? list[0].col : col);
  const b = useTileScreen(view, list ? list[list.length - 1].row : row, list ? list[list.length - 1].col : col + Math.max(1, cols) - 1);
  let rem = 100;
  try { rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 100; } catch { /* default */ }
  const vw = globalThis.innerWidth || 1920;
  const gap = rem * 0.1;
  const multiRow = !!list && list.some((s) => s.row !== list[0].row);
  // the two hooks above re-render on every camera change; the remaining cells are projected during this render (pure)
  const tiles = multiRow ? list.map((s) => tileScreen(view, s.row, s.col)) : null;
  const f = count > 0
    ? (multiRow ? tempBlockFrame(tiles, { labelW: rem * 2.9, gap, vw }) : tempRowFrame(a, b, { labelW: rem * 2.9, gap, vw }))
    : null;
  // the frame's numbers as primitives: the layout effect below must not re-run on every fresh quad object
  const fLeft = f ? f.left : 0, fRight = f ? f.right : 0, fTop = f ? f.top : 0, fY = f ? f.y : 0, fSide = f ? f.side : 'left';
  const labRef = useRef(null);
  /** @type {[{where: 'side'|'above', left: number, top: number} | null, Function]} measured spot, null until measured */
  const [spot, setSpot] = useState(null);
  useLayoutEffect(() => {
    if (!f) return;
    const el = labRef.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    const bar = document.querySelector('.shopbar');
    const q = bar ? bar.getBoundingClientRect() : null;
    const shop = q ? { left: q.left, right: q.right, top: q.top, bottom: q.bottom } : null;
    const next = tempLabelSpot({ side: fSide, left: fLeft, right: fRight, top: fTop, y: fY }, { w, h }, { gap, shop });
    if (!next) return;
    setSpot((p) => (p && p.where === next.where && Math.abs(p.left - next.left) < 0.05 && Math.abs(p.top - next.top) < 0.05 ? p : next));
  }, [fLeft, fRight, fTop, fY, fSide, gap, count, label, rem, vw]);
  if (!f) return null;
  const pts = f.quad.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  // the anchor of the chosen spot: before the first measurement the side anchor `tempRowFrame` picked (the layout effect
  // then confirms or moves it, before the browser paints)
  const anchor = spot && spot.where ? spot : { where: 'side', left: f.side === 'left' ? f.left - gap : f.right + gap, top: f.y };
  const style = `left:${anchor.left.toFixed(1)}px;top:${anchor.top.toFixed(1)}px`;
  return html`<div class="tempnote" aria-hidden="false" data-testid="temp-notice">
    <svg class="tempnote__frame" aria-hidden="true"><polygon points=${pts} /></svg>
    ${label ? html`<div ref=${labRef} class=${`tempnote__label is-${anchor.where === 'above' ? 'above' : f.side}`} style=${style} role="status">
      <b class="tempnote__title"><${Icon} name="warn" />${items > 0 && items === count
        ? tParts('临时整备区 {n} 件道具待处理', { n: html`<span class="num">${count}</span>`, count })
        : tParts('临时整备区 {n} 个单位待处理', { n: html`<span class="num">${count}</span>`, count })}</b>
      <span class="tempnote__rule">${tempRowRule(ready)}</span>
    </div>` : null}
  </div>`;
}
