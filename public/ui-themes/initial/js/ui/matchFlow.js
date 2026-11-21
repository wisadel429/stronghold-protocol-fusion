// 房间与搜寻流程的公共部件 (2026-10-13, the owner's request: the event's room / matchmaking flow, video 5:22–6:29; every
// drawing here is original):
//   SearchPanel — 搜寻中 (Ns): the brand line, the search tags (精确搜寻 · the difficulty), a pixel scout running over a
//                 skyline, a rotating tip, 停止搜寻;
//   FoundPanel  — 搜寻成功！正在连接中…: green, the search lines converging on the seats;
//   RadarScene  — 选择同盟方式's left picture: a sweeping radar with live bearing / range read-outs;
//   CreateArt / JoinArt — the two cards' pictures (since item 9: the event's own sprites, see below).
// Styles: css/screens/lobby.css (mf-*).
// 2026-10-27 round 6 (the recording 6:05 搜寻中, 6:10 搜寻成功): the panels are drawn with the event's sprites
// (img/official/hub/ac/outer, the eight-page pack): banner_matching_doc for the brand line, banner_matching_title_bg / _glow
// behind 搜寻中, banner_matching_type_bg under the tags, the cactus strip banner_matching_loading_scene_tile and the wave
// banner_matching_loading_line_tile scrolling (repeat-x) under the little robot banner_matching_loading_head, the
// banner_matching_loading_doc crosses, btn_stop_bg for 停止搜寻; 搜寻成功 on autochess_matching_success with line.png's strands
// and the robo_head / robo_eyes / robo_hand face; FoundPanel `fail` (搜寻已停止 — no fail screen in the recording, OUR use
// of autochess_matching_fail) on the grey one. The PixelScout drawing stays exported but is no longer shown.
import { useEffect, useRef, useState } from '/vendor/hooks.module.js';
import { html, Icon } from '/js/ui/components.js';
import { getConfig } from '/js/data.js';
import { t, N_ } from '/shared/i18n.js';

const AC = new URL('/ui-art/img/official/hub/ac/outer/', location.origin).href;
const acImg = (f, cls) => html`<img class=${cls} src=${AC + f + '.png'} alt="" draggable="false" />`;

const FALLBACK_TIPS = [
  N_('联合模拟在选择策略时可以进行一次跳过'),
  N_('调度中心即使冻结，依然可以主动刷新'),
  N_('两件同名装备可以合成一件更强力的装备'),
  N_('只有达成完美作战的队友可以进行联防'),
];

/** The loading tips (config.json `tips`, else a few built-in ones). */
export function tipList() {
  const cfg = getConfig();
  const list = Array.isArray(cfg?.tips) ? cfg.tips.map((x) => (typeof x === 'string' ? x : x?.tip)).filter((x) => typeof x === 'string' && x) : [];
  return list.length ? list : FALLBACK_TIPS.map((x) => t(x));
}

/** Seconds → '12s' / '1:05'. */
export function searchClock(s) {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  return n < 60 ? `${n}s` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

/** The rook in brackets used as the brand mark. */
export function BrandMark({ class: cls = '' }) {
  return html`<span class=${`mf-brand mf-brand--art ${cls}`} role="img" aria-label="STRONGHOLD PROTOCOL">${acImg('banner_matching_doc', 'mf-brand__img')}</span>`;
}

/** A little pixel scout (an original square bot) running over a scrolling skyline. */
export function PixelScout({ happy = false }) {
  return html`<svg class=${`mf-scout${happy ? ' is-happy' : ''}`} viewBox="0 0 240 90" aria-hidden="true" focusable="false">
    <path class="mf-scout__wave" d="M0 58 C30 40 50 76 80 58 S130 40 160 58 S210 76 240 58" />
    <g class="mf-scout__sky">
      <path d="M10 70h8v-14h6v14h10v-24h6v24h12v-10h6v10h20v-18h4v-6h4v24h18v-12h6v12h10v-20h6v20h14v-8h8v8" />
      <path d="M130 70h8v-14h6v14h10v-24h6v24h12v-10h6v10h20v-18h4v-6h4v24h18v-12h6v12h10v-20h6v20h14v-8h8v8" />
    </g>
    <g class="mf-scout__bot">
      <rect x="104" y="34" width="26" height="22" rx="3" />
      <rect class="mf-scout__eye" x="110" y="41" width="4" height="5" />
      <rect class="mf-scout__eye mf-scout__eye--r" x="120" y="41" width="4" height="5" />
      <rect x="114" y="26" width="6" height="8" />
      <rect x="112" y="22" width="10" height="4" />
      <rect class="mf-scout__leg mf-scout__leg--a" x="108" y="56" width="5" height="7" />
      <rect class="mf-scout__leg mf-scout__leg--b" x="121" y="56" width="5" height="7" />
    </g>
    <line class="mf-scout__ground" x1="60" y1="70" x2="180" y2="70" />
    <text x="120" y="84" text-anchor="middle">${happy ? 'CONNECTED' : 'SCANNING · · ·'}</text>
  </svg>`;
}

/**
 * 搜寻中 panel.
 * @param {{ elapsed: number, tags?: Array<{ key: string, label: string, color?: string, icon?: any }>, onStop?: (() => void)|null,
 *   stopping?: boolean, note?: string|null, class?: string }} props
 */
export function SearchPanel({ elapsed = 0, tags = [], onStop = null, stopping = false, note = null, class: cls = '' }) {
  const [tips] = useState(tipList);
  const [i, setI] = useState(() => Math.floor(Math.random() * Math.max(1, tips.length)));
  useEffect(() => { const id = setInterval(() => setI((x) => x + 1), 5000); return () => clearInterval(id); }, []);
  const dots = '.'.repeat((Math.floor(elapsed) % 3) + 1);
  return html`<aside class=${`mf-search ${cls}`} role="status" aria-live="polite">
    <${BrandMark} />
    <h3 class="mf-search__title">${t('搜寻中')}<span class="mf-search__dots" aria-hidden="true">${dots}</span><small class="num">(${searchClock(elapsed)})</small></h3>
    ${tags.length ? html`<div class="mf-search__tags">${tags.map((g) => html`<span key=${g.key} class="mf-tag" style=${g.color ? `--tag:${g.color}` : undefined}>${g.icon || null}${g.label}</span>`)}</div>` : null}
    <div class="mf-search__scene mf-scene" aria-hidden="true">
      <i class="mf-scene__line"></i><i class="mf-scene__land"></i>
      <span class="mf-scene__bot">${acImg('banner_matching_loading_head', 'mf-scene__head')}${acImg('banner_matching_loading_text', 'mf-scene__text')}</span>
      ${['tl', 'tr', 'bl', 'br'].map((k) => html`<i key=${k} class=${`mf-scene__cross mf-scene__cross--${k}`}></i>`)}
    </div>
    <p key=${i} class="mf-search__tip">${tips.length ? tips[i % tips.length] : ''}</p>
    ${note ? html`<p class="mf-search__note">${note}</p>` : null}
    ${onStop ? html`<button type="button" class="mf-stop" onClick=${onStop} disabled=${stopping}><span class="mf-stop__x"><${Icon} name="close" /></span>${t('停止搜寻')}</button>` : null}
  </aside>`;
}

/** 搜寻成功 panel (green, lines converging on `seats` nodes); it breaks in with a green glitch (css tr-glitch-*). */
export function FoundPanel({ seats = 4, text = null, fail = false, class: cls = '' }) {
  const n = Math.max(1, Math.min(10, seats | 0));
  const xs = Array.from({ length: n }, (_, k) => 40 + (k + 0.5) * (200 / n));
  const paths = [];
  for (let k = 0; k < 14; k++) {
    const from = 10 + k * 17;
    const to = xs[k % n];
    paths.push(html`<path key=${k} style=${`--k:${k}`} d=${`M${from} -10 C${from} 120 ${to + (k % 2 ? 30 : -30)} 140 ${to} 250`} />`);
  }
  void paths;
  return html`<aside class=${`mf-found mf-found--art${fail ? ' is-fail' : ''} ${cls}`} role="status" aria-live="assertive">
    <${BrandMark} />
    <div class="mf-found__strands" aria-hidden="true"><i class="mf-found__line"></i>
      <span class="mf-found__nodes">${xs.map((x, k) => html`<i key=${k} class="mf-found__node"></i>`)}</span></div>
    <div class="mf-found__face" aria-hidden="true"><i class="mf-found__head"></i><i class="mf-found__eye"></i><i class="mf-found__wink"></i><i class="mf-found__hand"></i></div>
    <b class="mf-found__title">${fail ? t('搜寻已停止') : t('搜寻成功！')}</b>
    <span class="mf-found__sub">${text || t('正在连接中…')}</span>
  </aside>`;
}

/* 选择同盟方式 (item 9, 2026-10-27; the recording 5:22.5–5:30, 5:26 for the stills): the radar and both card pictures are
   the event's own sprites (img/official/hub/ac/ally/, copied by work/video-replica-20261027/scripts/build-ally-art.py),
   placed at the positions read off the recording by correlation (css/screens/official-pages.css, section 9). The sweep
   turns clockwise at 62°/s (5.8 s a lap, timed off 5:23.0 → 5:29.0); the bearing read-out is the pointer's own bearing,
   the range a random walk (the recording's figures wander the same way). OUR fits, not original data: the wake's
   strength over a lap (max(0, 0.15 + 0.85·cos(bearing − 10°)), read off the 0.25 s frames — strongest past the top,
   gone from ~110° to ~270°), the blips' 1.2 s fade, their positions (random, re-drawn after they fade). Held still under reduced motion. */
const AY = new URL('/ui-art/img/official/hub/ac/ally/', location.origin).href;
const ayImg = (f, cls) => html`<img class=${cls} src=${AY + f + '.png'} alt="" draggable="false" />`;
const LAP_MS = 5800;
const BLIP_MS = 1200;
const newBlip = (b) => ({ b, r: 60 + Math.random() * 140 });

export function RadarScene() {
  const root = useRef(null);
  const deg = useRef(null);
  const range = useRef(null);
  const blipEls = useRef([]);
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const blips = [newBlip(40), newBlip(160), newBlip(285)];
    let rng = 2600 + Math.floor(Math.random() * 2600), nextJump = 0, nextStep = 0, raf = 0;
    const t0 = performance.now();
    const place = (k) => {
      const node = blipEls.current[k];
      if (!node) return;
      const a = (blips[k].b - 90) * Math.PI / 180;
      node.style.setProperty('--bx', (Math.cos(a) * blips[k].r).toFixed(1));
      node.style.setProperty('--by', (Math.sin(a) * blips[k].r).toFixed(1));
    };
    blips.forEach((_, k) => place(k));
    const frame = (now) => {
      const freeze = el.dataset.freeze;
      const a = freeze != null ? Number(freeze) : still ? 228 : ((now - t0) / LAP_MS * 360) % 360;
      el.style.setProperty('--a', a.toFixed(2) + 'deg');
      el.style.setProperty('--wake', Math.max(0, 0.15 + 0.85 * Math.cos((a - 10) * Math.PI / 180)).toFixed(3));
      blips.forEach((bp, k) => {
        const age = ((a - bp.b + 360) % 360) / 360 * LAP_MS;
        const node = blipEls.current[k];
        if (node) node.style.opacity = age < BLIP_MS ? (1 - age / BLIP_MS).toFixed(3) : '0';
        if (age > LAP_MS * 0.6 && !bp.moved && freeze == null && !still) { blips[k] = { ...newBlip((a + 40 + Math.random() * 250) % 360), moved: true }; place(k); }
        else if (age < BLIP_MS) bp.moved = false;
      });
      if (deg.current) deg.current.textContent = String(Math.round(a) % 360);
      if (now > nextStep && range.current && freeze == null) {
        if (now > nextJump) { rng = 2600 + Math.floor(Math.random() * 2600); nextJump = now + 1000 + Math.random() * 1400; }
        else rng += Math.random() < 0.6 ? 1 : 0;
        range.current.textContent = String(rng);
        nextStep = now + 250;
      }
      if (!still || freeze != null) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return html`<div class="ally-radar" ref=${root} aria-hidden="true">
    ${ayImg('bg_desc_left', 'ally-radar__map')}
    <i class="ally-radar__grid"></i>
    ${ayImg('img_desc_line_01', 'ally-radar__line ally-radar__line--l')}${ayImg('img_desc_line_02', 'ally-radar__brk ally-radar__brk--l')}
    ${ayImg('img_desc_line_02', 'ally-radar__brk ally-radar__brk--r')}${ayImg('img_desc_line_01', 'ally-radar__line ally-radar__line--r')}
    ${ayImg('bg_desc_02', 'ally-radar__tag ally-radar__tag--a')}${ayImg('bg_desc_02', 'ally-radar__tag ally-radar__tag--b')}
    ${ayImg('bg_desc_01', 'ally-radar__level')}${ayImg('img_desc_cross', 'ally-radar__x')}${ayImg('img_desc_text_lower', 'ally-radar__lower')}
    <div class="ally-radar__sweep">
      <i class="ally-radar__wake"></i>
      <i class="ally-radar__fan"></i>
    </div>
    ${[0, 1, 2].map((k) => html`<i key=${k} class="ally-radar__blip" ref=${(n) => { blipEls.current[k] = n; }}><i class="ally-radar__blipgrid"></i>${ayImg('highlight_point', 'ally-radar__blipdot')}</i>`)}
    ${ayImg('img_center_circle', 'ally-radar__ring')}
    <div class="ally-radar__sweep ally-radar__sweep--top"><i class="ally-radar__pointer">${ayImg('img_pointer_desc', 'ally-radar__pdesc')}</i></div>
    <i class="ally-radar__centre"></i>
    <div class="ally-radar__count">${ayImg('img_desc_count_bg', 'ally-radar__countbg')}
      <b class="ally-radar__num ally-radar__num--deg"><span ref=${deg}>228</span>${ayImg('img_desc_degree', 'ally-radar__degree')}</b>
      <b class="ally-radar__num ally-radar__num--range" ref=${range}>5109</b></div>
  </div>`;
}

/** 创建同盟's picture (5:26): create_room_left's fanned curves and their mirror, the plus emblem between the two brackets,
 *  the four diamonds, FORM AN ALLIANCE over it, the STRONGHOLD PROTOCOL / COLLABORATIVE SYSTEM plates under it, the logo plate
 *  in the corner. */
export function CreateArt() {
  return html`<span class="ally-art ally-art--create" aria-hidden="true">
    ${ayImg('room_select_create_logo', 'ally-art__logo')}
    ${ayImg('create_room_left', 'ally-art__curve ally-art__curve--l')}${ayImg('create_room_left', 'ally-art__curve ally-art__curve--r')}
    ${ayImg('room_select_img_startroom', 'ally-art__start')}
    ${['tl', 'tr', 'bl', 'br'].map((k) => html`<img key=${k} class=${`ally-art__dot ally-art__dot--${k}`} src=${AY + 'room_select_dot.png'} alt="" draggable="false" />`)}
    ${ayImg('room_select_create_left_line', 'ally-art__brk ally-art__brk--l')}${ayImg('room_select_create_left_line', 'ally-art__brk ally-art__brk--r')}
    ${ayImg('room_select_create_middleicon', 'ally-art__mid')}
    ${ayImg('room_select_create_text_01__tex', 'ally-art__t1')}${ayImg('room_select_create_text_02__tex', 'ally-art__t2')}
  </span>`;
}

/** 加入同盟's picture (5:26): the grey blocks at either end, five pairs of orange blocks (room_select_join_middle_block every
 *  60 px, each pair in front of the next), room_select_join_middle_block_mask fading their feet into the card, the target
 *  (room_select_join_triangle over room_select_join_blank with four room_select_join_ban) on the crosshair, the logo plate
 *  and the two captions. The crosshair's thin lines are not in the pack: drawn (OUR). */
export function JoinArt() {
  return html`<span class="ally-art ally-art--join" aria-hidden="true">
    <span class="ally-art__blocks">
      ${ayImg('room_select_join_left_block', 'ally-art__blk ally-art__blk--l')}
      ${[0, 1, 2, 3, 4].map((k) => html`<img key=${k} class="ally-art__blk ally-art__blk--m" style=${`--k:${k}`} src=${AY + 'room_select_join_middle_block.png'} alt="" draggable="false" />`)}
      ${ayImg('room_select_join_right_block', 'ally-art__blk ally-art__blk--r')}
      ${ayImg('room_select_join_middle_block_mask', 'ally-art__fade')}
    </span>
    <i class="ally-art__hair ally-art__hair--h"></i><i class="ally-art__hair ally-art__hair--v"></i>
    <i class="ally-art__hair ally-art__hair--t1"></i><i class="ally-art__hair ally-art__hair--t2"></i>
    <i class="ally-art__hair ally-art__hair--s1"></i><i class="ally-art__hair ally-art__hair--s2"></i>
    ${ayImg('room_select_join_logo__tex', 'ally-art__jlogo')}${ayImg('room_select_join_text_01', 'ally-art__jt1')}${ayImg('room_select_join_text_02__tex', 'ally-art__jt2')}
    ${ayImg('room_select_join_triangle', 'ally-art__tri')}
    <span class="ally-art__target">${ayImg('room_select_join_blank', 'ally-art__blank')}
      ${[0, 1, 2, 3].map((k) => html`<img key=${k} class=${`ally-art__ban ally-art__ban--${k}`} src=${AY + 'room_select_join_ban.png'} alt="" draggable="false" />`)}</span>
  </span>`;
}
