// 选择模拟协议's left picture (PR #643, the event's screen after 独立模拟 — video 5:00–5:18). With the art pack it is the
// event's own scene (2026-10-27 round 3, measured off the recording at 1280×720): the official Rhodes Island
// (`modeChoice/<difficulty>_rhodes_island`) on its four survey plates, the modechoice set's defenders on the two lit ones
// (标准: four a side; 险境 / 绝境: six pairs a side), the enemies, thorns (险境's own orange pair from the newer Arkdays pack)
// and crosses of the harder protocols, the deck plate,
// the iso lettering, the cable from the top with its light running down every few seconds and the ID card that pops out of
// the deck (img/official/hub/mc/, scripts/build-proto-art.py). Without the art pack (or when the picture fails) the PR's
// own stepped wireframe hull stands in, drawn in the selected difficulty's colour (`currentColor`, from --d-color).
// Choosing another difficulty remounts it (key): it comes up from dark and its loop starts over, as in the recording.
import { html } from '/js/ui/components.js';
import { useState } from '/vendor/hooks.module.js';
import { uiUrl } from '/js/ui/assetUrls.js';
import { data } from '/js/data.js';

/** The difficulty's official picture (modeChoice/<difficulty>_rhodes_island) when the caller names none. */
const ART_KEY = { FUNNY: 'funny', NORMAL: 'normal', HARD: 'hard', ABYSS: 'abyss' };
const MC = new URL('/ui-art/img/official/hub/mc/', location.origin).href;

// ---- the event's scene ---------------------------------------------------------------------------------------------
// Everything below is in the recording's pixels (1280×720). The view box is the official hub's stage there (the SVG's box
// is 22,43.3 743×566.7), so the scene lands 1:1; other layouts scale it whole.
const VIEW = '22 43.3 743 566.7';
/** The modechoice sprites' set per protocol: the bundle's keys run one step below ours (its funny is 标准). */
const SET = { FUNNY: 'funny', NORMAL: 'normal', HARD: 'hard', ABYSS: 'abyss' };
/** Plate colour (lit plates at .55 ≈ the recording's), and the cable's lit colour, per protocol. */
const TINT = { FUNNY: '#f08a22', NORMAL: '#f55a24', HARD: '#f54836', ABYSS: '#d81e14' };
const CABLE = { FUNNY: '#e85003', NORMAL: '#d85202', HARD: '#eb2304', ABYSS: '#c81004' };
const SIZE = {
  funny_chess: [40, 72], chess_01: [68, 84], chess_02: [36, 64], chess_03: [36, 64], cross: [48, 28], id_card: [124, 120],
  desc: [88, 72], desc_text: [204, 84], thorn_2: [52, 92], thorn_3: [116, 92], thorn_4: [88, 52], abyss_thorn_2: [60, 96],
  abyss_thorn_4: [92, 56], abyss_thorn_5: [88, 88],
};
/** A thorn's root and its longest point, in the sprite's pixels (the scene places those two). */
const THORN = {
  thorn_2: [[3, 80], [36, 2]], thorn_3: [[2, 71], [102, 2]], thorn_4: [[12, 49], [84, 1]],
  abyss_thorn_2: [[2, 85], [38, 3]], abyss_thorn_4: [[5, 50], [88, 2]], abyss_thorn_5: [[23, 69], [7, 2]],
};
const FIG = 0.95; // the defenders, enemies and crosses are drawn at 95 %
// one / pair: the lit defenders (funny_chess; <set>_chess_01, two abreast); e2 / e3: the dark enemies (<set>_chess_02 / 03)
const PAIRS_BACK = [[147, 300], [182, 287], [219, 272], [255, 258], [289, 244], [325, 228]].map(([x, y]) => ['pair', x, y]);
const PAIRS_FRONT = [[507, 423], [542, 410], [578, 394], [615, 381], [649, 367], [684, 351]].map(([x, y]) => ['pair', x, y]);
const HARD_SCENE = {
  back: PAIRS_BACK,
  front: [...PAIRS_FRONT, ['e3', 169, 422], ['e3', 197, 431], ['e2', 171, 446], ['e3', 199, 456], ['e2', 229, 445], ['e3', 257, 455],
    ['e3', 652, 239], ['e3', 680, 249], ['e2', 614, 254], ['e3', 644, 267], ['e2', 673, 277]],
  crosses: [[126, 405], [391, 499], [743, 355]],
  // [sprite slot, mirrored, root, point]
  thorns: [['thorn_4', true, [240, 415], [98, 385]], ['thorn_2', true, [243, 421], [160, 438]], ['thorn_2', false, [396, 310], [412, 245]],
    ['thorn_3', false, [652, 378], [730, 310]], ['thorn_4', false, [418, 500], [470, 462]]],
  card: [457, 157], desc: [459, 256], cable: [347.5, -24],
};
const SCENES = {
  FUNNY: {
    back: [[202, 290], [236, 277], [272, 262], [308, 248]].map(([x, y]) => ['one', x, y]),
    front: [[562, 413], [596, 400], [632, 385], [667, 371]].map(([x, y]) => ['one', x, y]),
    crosses: [], thorns: [], card: [435, 157], desc: [439, 256], cable: [330, -24],
  },
  NORMAL: {
    back: PAIRS_BACK,
    front: [...PAIRS_FRONT, ['e2', 183, 442], ['e3', 211, 452], ['e2', 628, 257], ['e3', 656, 267]],
    crosses: [[126, 405], [391, 499]],
    thorns: [],
    // 险境's own pair (the Arkdays pack): already drawn in perspective, so set unrotated at 112.5 % (matched at 5:58)
    flat: [['normal_thorn_left', 82, 370, 163, 87], ['normal_thorn_right', 621, 291, 112, 112]],
    card: [457, 157], desc: [459, 256], cable: [347.5, -24],
  },
  HARD: HARD_SCENE,
  ABYSS: HARD_SCENE, // not in the recording: 绝境's layout in the abyss set
};
/** Where each ship picture sits, 1:1 (x, y, w, h; matched against the recording; 终极's centred on 绝境's). */
const SHIP = { FUNNY: [223, 178, 426, 328], NORMAL: [222, 175, 427, 332], HARD: [222, 175, 427, 332], ABYSS: [219.5, 173, 432, 336] };
/** The plates: lit (behind the defenders) with their corner brackets, and the two dim ones with lighter tiles. */
const LIT = [
  { quad: [[121, 356], [343, 267], [414, 302], [207, 385]], marks: [[[107, 358], [80, 368], [177, 401], [207, 390]], [[337, 263], [364, 253], [413, 280]]] },
  { quad: [[480, 478], [695, 392], [783, 422], [568, 508]], marks: [[[465, 482], [447, 492], [533, 524], [560, 513]], [[700, 387], [723, 377], [798, 417]]] },
];
/** Dim plates as origin + two edges; tiles as [a0, a1, b0, b1] fractions of those edges. */
const DIM = [
  { o: [97, 485], u: [165, 52], v: [135, -47], tiles: [[0.03, 0.45, 0.04, 0.5], [0.55, 0.97, 0.04, 0.5]] },
  { o: [534, 322], u: [88, -50], v: [156, 50], tiles: [[0.45, 0.92, 0.08, 0.62]] },
];
const pts = (list) => list.map((p) => p.map((v) => +v.toFixed(1)).join(',')).join(' ');
const at = ({ o, u, v }, a, b) => [o[0] + a * u[0] + b * v[0], o[1] + a * u[1] + b * v[1]];
const quad = (p, [a0, a1, b0, b1]) => [at(p, a0, b0), at(p, a1, b0), at(p, a1, b1), at(p, a0, b1)];
let uid = 0;

function sprite(set, kind) {
  if (kind === 'one') return 'funny_chess';
  return `${set}_chess_0${kind === 'pair' ? 1 : kind === 'e2' ? 2 : 3}`;
}

function Fig({ set, kind, x, y, i }) {
  const name = sprite(set, kind);
  const [w, h] = SIZE[name === 'funny_chess' ? name : name.slice(set.length + 1)];
  return html`<image class="psm-fig" style=${`--i:${i}`} href=${`${MC}${name}.png`} x=${x} y=${y} width=${w * FIG} height=${h * FIG} />`;
}

function Thorn({ set, slot, flip, root, point, i }) {
  const name = set === 'abyss' ? `abyss_${{ thorn_2: 'thorn_2', thorn_3: 'thorn_5', thorn_4: 'thorn_4' }[slot]}` : `${set}_${slot}`;
  const key = set === 'abyss' ? name : slot;
  const [[bx, by], [tx, ty]] = THORN[key];
  const [w, h] = SIZE[key];
  const sx = (flip ? -1 : 1) * (tx - bx), sy = ty - by;
  const rot = (Math.atan2(point[1] - root[1], point[0] - root[0]) - Math.atan2(sy, sx)) * 180 / Math.PI;
  const s = Math.hypot(point[0] - root[0], point[1] - root[1]) / Math.hypot(sx, sy);
  const t = `translate(${root[0]} ${root[1]}) rotate(${rot.toFixed(2)}) scale(${(flip ? -s : s).toFixed(3)} ${s.toFixed(3)}) translate(${-bx} ${-by})`;
  return html`<g class="psm-thorn" style=${`--i:${i}`}><image href=${`${MC}${name}.png`} width=${w} height=${h} transform=${t} /></g>`;
}

function EventScene({ difficulty, pic, onError }) {
  const set = SET[difficulty] || 'funny';
  const sc = SCENES[difficulty] || SCENES.FUNNY;
  const [id] = useState(() => `psm${++uid}`);
  const tint = TINT[difficulty] || TINT.FUNNY;
  const ship = SHIP[difficulty] || SHIP.FUNNY;
  const [cx, cy] = sc.cable;
  const [kx, ky] = sc.card;
  const front = [...sc.front].sort((a, b) => a[2] - b[2]);
  const cross = `${MC}${set === 'funny' ? 'normal' : set}_cross.png`;
  return html`<svg class="ps ps--event" viewBox=${VIEW} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" style=${`--tint:${tint}`}>
    <defs>
      <mask id=${`${id}c`} maskUnits="userSpaceOnUse" x=${cx} y=${cy} width="108" height="420">
        <image href=${`${MC}com_link_line_white.png`} x=${cx} y=${cy} width="108" height="408" />
        <svg x=${cx} y=${cy + 330} width="108" height="56" viewBox="0 330 108 20" preserveAspectRatio="none"><image href=${`${MC}com_link_line_white.png`} width="108" height="408" /></svg>
      </mask>
      <linearGradient id=${`${id}g`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0" /><stop offset=".35" stop-color="#fff" /><stop offset=".75" stop-color="#fff" /><stop offset="1" stop-color="#fff" stop-opacity="0" />
      </linearGradient>
      <mask id=${`${id}p`} maskUnits="userSpaceOnUse" x=${cx - 10} y="-60" width="130" height="520">
        <rect class="psm-pulse" x=${cx - 10} y="-460" width="130" height="420" fill=${`url(#${id}g)`} />
      </mask>
      <mask id=${`${id}t`} maskUnits="userSpaceOnUse" x=${kx + 50} y=${ky + 39} width="68" height="36">
        <image href=${`${MC}img_id_card_text.png`} x=${kx + 50} y=${ky + 39} width="68" height="36" />
      </mask>
    </defs>
    <g class="psm-plates">
      ${DIM.map((p, i) => html`<g key=${`d${i}`} class="psm-dim">
        <polygon points=${pts(quad(p, [0, 1, 0, 1]))} />
        ${p.tiles.map((t, j) => html`<polygon key=${j} class="psm-dim__tile" points=${pts(quad(p, t))} />`)}
      </g>`)}
      ${LIT.map((p, i) => html`<g key=${`l${i}`} class="psm-lit">
        <polygon points=${pts(p.quad)} />
        ${p.marks.map((m, j) => html`<polyline key=${j} class="psm-mark" points=${pts(m)} />`)}
      </g>`)}
    </g>
    <g class="psm-back">${sc.back.map(([k, x, y], i) => html`<${Fig} key=${`b${i}`} set=${set} kind=${k} x=${x} y=${y} i=${i} />`)}</g>
    <image class="psm-ship" href=${pic} x=${ship[0]} y=${ship[1]} width=${ship[2]} height=${ship[3]} onError=${onError} />
    <image class="psm-desc" href=${`${MC}${set}_desc.png`} x=${sc.desc[0]} y=${sc.desc[1]} width="88" height="72" />
    <g class="psm-front">${front.map(([k, x, y], i) => html`<${Fig} key=${`f${i}`} set=${set} kind=${k} x=${x} y=${y} i=${i + sc.back.length} />`)}</g>
    <g class="psm-thorns">${sc.thorns.map(([slot, flip, root, point], i) => html`<${Thorn} key=${i} set=${set} slot=${slot} flip=${flip} root=${root} point=${point} i=${i} />`)}
      ${(sc.flat || []).map(([name, x, y, w, h], i) => html`<g key=${`f${i}`} class="psm-thorn" style=${`--i:${i}`}><image href=${`${MC}${name}.png`} x=${x} y=${y} width=${w * 1.125} height=${h * 1.125} /></g>`)}</g>
    <g class="psm-crosses">${sc.crosses.map(([x, y], i) => html`<image key=${i} href=${cross} x=${x} y=${y} width=${48 * FIG} height=${28 * FIG} />`)}</g>
    <image class="psm-lettering" href=${`${MC}${set}_desc_text.png`} x="584" y="456" width=${204 * FIG} height=${84 * FIG} />
    <g class="psm-cable" style=${`--cable:${CABLE[difficulty] || CABLE.FUNNY}`}>
      <rect class="psm-cable__dim" x=${cx} y=${cy} width="108" height="420" mask=${`url(#${id}c)`} />
      <g mask=${`url(#${id}p)`}><rect class="psm-cable__lit" x=${cx} y=${cy} width="108" height="420" mask=${`url(#${id}c)`} /></g>
    </g>
    <g class="psm-card" style=${`transform-origin:${kx + 62}px ${ky + 100}px`}>
      <image href=${`${MC}${set}_id_card.png`} x=${kx} y=${ky} width="124" height="120" />
      <svg class="psm-ava" x=${kx - 6} y=${ky + 47} width="56.3" height="56.3" viewBox="0 0 64 64"><image href=${`${MC}img_fx_${set}_avatar.png`} width="128" height="128" /></svg>
      <rect x=${kx + 50} y=${ky + 39} width="68" height="36" fill=${tint} mask=${`url(#${id}t)`} />
    </g>
  </svg>`;
}

// ---- the drawn stand-in (no art pack) -------------------------------------------------------------------------------
const S = 15;            // one unit in px of the 1000 × 640 view box
const OX = 230, OY = 400; // where the origin lands
/** X runs up-right, Y down-right, Z up. */
const iso = (x, y, z = 0) => [OX + (x + y) * 0.866 * S, OY + (y - x) * 0.5 * S - z * S];
const pt = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
const poly = (list) => list.map((p) => pt(iso(...p))).join(' ');

/** The three faces of a box seen from this angle: top, front (y = y1), side (x = x0). */
function box([x0, y0, z0], [x1, y1, z1], key) {
  return html`<g key=${key} class="ps-box">
    <polygon class="ps-face ps-face--side" points=${poly([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]])} />
    <polygon class="ps-face ps-face--front" points=${poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]])} />
    <polygon class="ps-face ps-face--top" points=${poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]])} />
  </g>`;
}

const HULL = [
  [[0, 0, 0], [32, 9, 2.4]],          // keel
  [[2.5, 1, 2.4], [29, 8, 4.2]],      // main deck
  [[5, 2, 4.2], [12, 7, 5.6]],        // aft block
  [[15, 1.5, 4.2], [26, 7.5, 6.2]],   // superstructure
  [[18, 2.5, 6.2], [24, 6.5, 8]],     // bridge
  [[21.5, 3.6, 8], [23, 5, 13.5]],    // mast
  [[3, 6.2, 4.2], [4.6, 7.8, 10.5]],  // stack
  [[27, 2, 4.2], [30.5, 7, 4.9]],     // bow plate
];
/** Deck lines (panel seams) for texture. */
const SEAMS = [
  [[3, 2.5, 4.2], [28.5, 2.5, 4.2]], [[3, 5.5, 4.2], [14.5, 5.5, 4.2]], [[8, 1, 4.2], [8, 2, 4.2]],
  [[15.5, 4.5, 6.2], [25.5, 4.5, 6.2]], [[1, 9, 1.2], [31, 9, 1.2]],
];
/** The two squares beside the hull. */
const PADS = [
  { from: [3, -13], to: [19, -3.5] },
  { from: [12, 12], to: [30, 20.5] },
];
const COUNT = { FUNNY: 10, NORMAL: 18, HARD: 26, ABYSS: 34 };
const SPIKES = { FUNNY: 1, NORMAL: 3, HARD: 5, ABYSS: 7 };

/** Defender positions: rows on the two squares, filled alternately up to `n`. */
function defenders(n) {
  const spots = [];
  for (const [i, pad] of PADS.entries()) {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      spots.push({ pad: i, x: pad.from[0] + 1.6 + c * ((pad.to[0] - pad.from[0] - 3.2) / 5), y: pad.from[1] + 1.4 + r * ((pad.to[1] - pad.from[1] - 2.8) / 3), k: r * 6 + c });
    }
  }
  // alternate the pads, front rows first, so a low count still fills both
  const order = spots.sort((a, b) => (a.k - b.k) || (a.pad - b.pad)).slice(0, n);
  return order.sort((a, b) => iso(a.x, a.y)[1] - iso(b.x, b.y)[1]);
}

function Figure({ x, y, i }) {
  const [px, py] = iso(x, y, 0);
  return html`<g class="ps-fig" style=${`--i:${i}`}>
    <ellipse class="ps-fig__shadow" cx=${px} cy=${py} rx="9.5" ry="4.2" />
    <path class="ps-fig__body" d=${`M${px - 8} ${py} L${px + 8} ${py} L${px + 7} ${py - 19} Q${px} ${py - 23} ${px - 7} ${py - 19} Z`} />
    <rect class="ps-fig__head" x=${px - 6} y=${py - 34} width="12" height="12" rx="2" />
  </g>`;
}

/** An enemy spike: a thin wedge from outside the squares towards the hull. */
function Spike({ from, to, i }) {
  const a = iso(...from), b = iso(...to);
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * 7, ny = dx / len * 7;
  return html`<g class="ps-spike" style=${`--i:${i}`}>
    <polygon points=${`${a[0] + nx},${a[1] + ny} ${b[0]},${b[1]} ${a[0] - nx},${a[1] - ny}`} />
    <path d=${`M${a[0] - 8} ${a[1] - 8}l16 16M${a[0] + 8} ${a[1] - 8}l-16 16`} class="ps-spike__x" />
  </g>`;
}
const SPIKE_PATHS = [
  [[-6, 4.5], [0, 4.5]], [[36, 3], [32, 4]], [[10, 25], [12, 11]], [[22, -16], [19, -1]],
  [[-4, 16], [4, 10]], [[34, 15], [29, 10]], [[0, -10], [3, -1]],
];

function DrawnScene({ difficulty }) {
  const n = COUNT[difficulty] ?? COUNT.FUNNY;
  const spikes = SPIKE_PATHS.slice(0, SPIKES[difficulty] ?? 1);
  const grid = [];
  for (let x = -8; x <= 40; x += 4) grid.push(html`<line key=${`x${x}`} x1=${iso(x, -18)[0]} y1=${iso(x, -18)[1]} x2=${iso(x, 26)[0]} y2=${iso(x, 26)[1]} />`);
  for (let y = -18; y <= 26; y += 4) grid.push(html`<line key=${`y${y}`} x1=${iso(-8, y)[0]} y1=${iso(-8, y)[1]} x2=${iso(40, y)[0]} y2=${iso(40, y)[1]} />`);
  const mastTop = iso(22.2, 4.3, 13.5);
  const cable = `M${mastTop[0] + 60} -10 C${mastTop[0] + 70} 120 ${mastTop[0] - 20} 110 ${mastTop[0]} ${mastTop[1]}`;
  const callAt = iso(8, -6, 15);
  return html`<svg class="ps" viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    <g class="ps-grid">${grid}</g>
    <path class="ps-cable" d=${cable} />
    <path class="ps-cable__pulse" pathLength="1000" d=${cable} />
    ${PADS.map((p, i) => html`<g key=${`pad${i}`} class="ps-pad">
      <polygon points=${poly([[p.from[0], p.from[1], 0], [p.to[0], p.from[1], 0], [p.to[0], p.to[1], 0], [p.from[0], p.to[1], 0]])} />
      <polyline class="ps-pad__edge" points=${poly([[p.from[0] - 1.5, p.from[1] - 1.5, 0], [p.to[0] + 1.5, p.from[1] - 1.5, 0], [p.to[0] + 1.5, p.to[1] + 1.5, 0]])} />
    </g>`)}
    <g class="ps-figs ps-figs--back">${defenders(n).filter((f) => f.pad === 0).map((f, i) => html`<${Figure} key=${`a${f.k}`} x=${f.x} y=${f.y} i=${i} />`)}</g>
    <g class="ps-hull">
      ${HULL.map(([a, b], i) => box(a, b, i))}
      ${SEAMS.map(([a, b], i) => html`<line key=${`s${i}`} class="ps-seam" x1=${iso(...a)[0]} y1=${iso(...a)[1]} x2=${iso(...b)[0]} y2=${iso(...b)[1]} />`)}
      <circle class="ps-beacon" cx=${mastTop[0]} cy=${mastTop[1]} r="3.5" />
    </g>
    <g class="ps-figs">${defenders(n).filter((f) => f.pad === 1).map((f, i) => html`<${Figure} key=${`b${f.k}`} x=${f.x} y=${f.y} i=${i} />`)}</g>
    <g class="ps-spikes">${spikes.map(([a, b], i) => html`<${Spike} key=${i} from=${[a[0], a[1], 0]} to=${[b[0], b[1], 0.5]} i=${i} />`)}</g>
    <g class="ps-call">
      <line x1=${iso(10, 1, 6.2)[0]} y1=${iso(10, 1, 6.2)[1]} x2=${callAt[0] + 40} y2=${callAt[1] + 70} />
      <rect x=${callAt[0]} y=${callAt[1]} width="96" height="70" />
      <rect class="ps-call__icon" x=${callAt[0] + 8} y=${callAt[1] + 8} width="24" height="54" />
      <circle class="ps-call__man" cx=${callAt[0] + 20} cy=${callAt[1] + 18} r="4.5" />
      <path class="ps-call__man" d=${`M${callAt[0] + 14} ${callAt[1] + 26}h12v14h-3v14h-6v-14h-3z`} />
      <line x1=${callAt[0] + 40} y1=${callAt[1] + 16} x2=${callAt[0] + 86} y2=${callAt[1] + 16} />
      <line x1=${callAt[0] + 40} y1=${callAt[1] + 28} x2=${callAt[0] + 76} y2=${callAt[1] + 28} />
      <line x1=${callAt[0] + 40} y1=${callAt[1] + 40} x2=${callAt[0] + 82} y2=${callAt[1] + 40} />
      <text x=${callAt[0] + 40} y=${callAt[1] + 60} font-size="11">DEF ${String(n).padStart(2, '0')}</text>
    </g>
    <line class="ps-scan" x1="0" y1="0" x2="1000" y2="0" />
  </svg>`;
}

/**
 * @param {{ difficulty: string, art?: string|null }} props difficulty FUNNY | NORMAL | HARD | ABYSS; art: the official
 *   picture's URL (null without the art pack)
 */
export function ProtocolScene({ difficulty, art = undefined }) {
  if (art === undefined) art = ART_KEY[difficulty] ? uiUrl(data.get('assets'), `modeChoice/${ART_KEY[difficulty]}_rhodes_island`) : null;
  const [bad, setBad] = useState(null);
  const pic = art && bad !== art ? art : null;
  return pic ? html`<${EventScene} difficulty=${difficulty} pic=${pic} onError=${() => setBad(art)} />` : html`<${DrawnScene} difficulty=${difficulty} />`;
}
