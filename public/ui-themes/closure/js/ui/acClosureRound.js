// 「全能的」可露希尔 theme — the round-start window ([uc]ac_s_closur Banner/round_start), drawn by ui/matchPopups.js
// RoundPopup in place of the default plate when the theme is on. Same props, same place (.mpop, the screen's middle,
// pointer-events none).
// Reference: 07-04-02, 101.1167–103.900 s. The complete visual lasts 2.8 s, independently of server phase length.
// Glitch/window expansion -> figure/stickers -> old/new round at .50 s -> income flash/coin fragments at .86 s
// -> hold -> the hand cursor travels to the close button at 2.30–2.60 s -> stars and a 200 ms dissolve.
// All coordinates use the 1280×720 grid.
// Keep the timeline paused until images and the Spine canvas are ready, including on the first round.

import { html } from '/js/ui/components.js';
import { useEffect, useLayoutEffect, useState } from '/vendor/hooks.module.js';
import { ClosureSpine, preloadClosureSpine } from '/js/ui/acClosureSpine.js';
import { closureVo } from '/js/ui/acClosureVoice.js';
import { t } from '/shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const two = (n) => String(Math.max(0, Math.trunc(Number(n) || 0)) % 100).padStart(2, '0');

/** On screen until the out starts (ms), and the out. */
export const CLOSURE_ROUND_MS = 2600;
const LEAVE_MS = 200;

/** Spine canvas: its size in design px (placed at 330, 140 by the CSS, .crs__fig) and the skeleton in it. */
const SPINE_BOX = [430, 320];
const SPINE_FIG = { scale: 0.695, x: 220, y: 288.6 };
const SPINE_BG = 0.82;

const GLITCH = [
  // [top, left, width, height, delay ms, tone] — the streaks the window grows out of (footage f8–f19)
  [355, 490, 300, 12, 0, 'n'], [363, 510, 280, 14, 0, 'n'], [370, 540, 175, 14, 20, 'm'],
  [345, 500, 230, 12, 5, 'n'], [350, 455, 300, 7, 25, 'n'], [348, 630, 240, 14, 35, 'n'],
  [326, 380, 260, 4, 90, 'n'], [270, 600, 320, 4, 130, 'n'], [336, 560, 330, 5, 150, 'n'],
  [262, 390, 210, 3, 170, 'm'],
];
const SPARKS = [
  [418, 300, 32, 0], [470, 410, 24, 20], [540, 270, 18, 40], [655, 300, 26, 20],
  [720, 400, 24, 0], [790, 286, 26, 40], [846, 360, 20, 10], [898, 278, 30, 20],
  [610, 425, 20, 30], [452, 350, 26, 10], [762, 336, 18, 0], [380, 395, 22, 40],
];
const COINS = [[-22,-5,8,0],[-9,-15,6,35],[8,-9,7,60],[23,2,8,10],[14,13,5,70],[-18,12,6,45]];
const ROUND_ART = ['window_main_frame','window_main_bg','window_main_desc','window_small','img_tv_3',
  'main_window_dec','img_logo','desc_1','desc_2','window_main_lower_desc','img_bg','wire_left_2','wire_right_1','img_round','img_sources',
  'img_sources_icon','window_down_dec','img_hand','avatar_pop','sticker_1','sticker_2','avatar_desc',
  'img_fx_star_small','tv_star_mask','disturb img_bg_mask','disturb img_bg_sheet',
  'tag_help_battle','tag_help_battle_col','tag_help_battle_mask','tag_help_battle_arrow',
  'tag_round_end_miss','tag_round_end_miss_icon','img_fx_star_outline2'];
const ART_ROOT = new URL('/ui-art/img/official/hub/ac/theme/almighty_closure/', location.origin).href;
let roundArtReady;
const heldRoundArt = [];
export function preloadClosureRoundArt() {
  if (!roundArtReady) {
    const images = ROUND_ART.map((name) => new Promise((resolve) => {
      const im = new Image(); heldRoundArt.push(im); im.onload = im.onerror = resolve;
      im.src = `${ART_ROOT}${encodeURIComponent(name)}.png`;
    }));
    roundArtReady = Promise.all([...images, preloadClosureSpine().catch(() => {})]);
  }
  return roundArtReady;
}

export function ClosureRoundPopup(props) { return html`<${ClosureWindowPopup} ...${props} />`; }
export function ClosurePhasePopup({ title, sub, onDone }) {
  return html`<${ClosureWindowPopup} variant="unite" title=${title} sub=${sub} onDone=${onDone} />`;
}
export function ClosureBattleOverPopup({ kind = 'perfect', title, sub, loss = 0, onDone }) {
  return html`<${ClosureWindowPopup} variant=${`end-${kind}`} title=${title} sub=${sub} loss=${loss}
    voice=${kind === 'perfect' ? 'perfect' : kind === 'loss' ? 'imperfect' : null} onDone=${onDone} />`;
}

function WindowMessage({ variant, title, loss }) {
  const perfect = variant === 'end-perfect';
  return html`<div class=${cx('crs__message', perfect && 'is-perfect')}>
    <b class="crs__message-title">${title}</b>
    ${perfect ? html`<span class="crs__perfect">${t('完美作战!')}</span>
      <span class="crs__celebrate">${[[10,20,26,0], [170,16,32,40], [104,70,28,90], [-5,60,14,130], [182,73,12,170], [65,-8,10,220]].map(([x,y,s,d],i)=>html`<i key=${i} style=${`--x:${x};--y:${y};--s:${s};--d:${d}ms`}></i>`)}</span>`
      : variant === 'unite' ? html`<span class="crs__help"><i class="crs__help-sweep"></i><span>${[0,1,2].map(i=>html`<i key=${i} style=${`--i:${i}`}></i>`)}</span></span>`
      : variant === 'end-loss' ? html`<span class="crs__loss">${t('生命值减少')}<i></i><b class="num">${Math.max(0, Math.trunc(Number(loss) || 0))}</b></span>` : null}
  </div>`;
}

function ClosureWindowPopup({ variant = 'round', round, gain = null, left = null, sub = null, watching = false, title, loss, voice, onDone }) {
  const [leaving, setLeaving] = useState(false);
  const [artReady, setArtReady] = useState(false);
  const [figureReady, setFigureReady] = useState(false);
  const ready = artReady && figureReady;
  useEffect(() => {
    let mounted = true;
    preloadClosureRoundArt().then(() => { if (mounted) setArtReady(true); });
    return () => { mounted = false; };
  }, []);
  useLayoutEffect(() => {
    if (!ready) return;
    const a = setTimeout(() => setLeaving(true), CLOSURE_ROUND_MS);
    const b = setTimeout(() => onDone?.(), CLOSURE_ROUND_MS + LEAVE_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [ready]);
  useEffect(() => {
    if (!ready || !voice) return;
    const id = setTimeout(() => closureVo(voice), 350);
    return () => clearTimeout(id);
  }, [ready]);
  const n = !watching && Number.isFinite(gain) && gain > 0 ? Math.trunc(gain) : null;
  return html`<div class=${cx('mpop', 'crs', `crs--${variant}`, !ready && 'is-loading', watching && 'is-watching', leaving && 'is-leaving')} role="status" aria-live="polite"
      aria-label=${variant === 'round' ? t('第 {r} 回合', { r: round }) : sub ? `${title} ${sub}` : title}
      data-testid=${variant === 'round' ? 'round-popup' : variant === 'unite' ? 'phase-popup' : 'battle-over-popup'} data-kind=${variant.startsWith('end-') ? variant.slice(4) : null}>
    <div class="crs__stage" aria-hidden="true">
      <span class="crs__glitch">${GLITCH.map(([y, x, gw, gh, d, tone], i) => html`<i key=${i} class=${`is-${tone}`}
        style=${`--x:${x};--y:${y};--w:${gw};--h:${gh};--d:${d}ms`}></i>`)}</span>
      <i class="crs__back crs__back--l"></i>
      <i class="crs__wire crs__wire--l"></i>
      <i class="crs__wire crs__wire--r"></i>
      <i class="crs__noise"></i>
      <i class="crs__small"></i>
      <div class="crs__main">
        <i class="crs__band"><i></i></i>
        <i class="crs__back crs__back--r"></i>
        <i class="crs__bg"></i>
        <i class="crs__desc"></i>
        <i class="crs__frame"></i>
        <i class="crs__dec"></i>
        <i class="crs__tvs"></i>
        <i class="crs__down"></i>
        <span class="crs__tag crs__tag--a">ON-AIR</span><span class="crs__tag crs__tag--b">1.23 FM</span>
        <span class="crs__tag crs__tag--c">ON-AIR</span><span class="crs__tag crs__tag--d">1.23 FM</span>
        ${variant === 'round' ? html`<div class="crs__cell crs__cell--round">
          <span class="crs__k">${t('回合')}</span>
          <span class="crs__roll num"><b class="crs__old">${two(round - 1)}</b><b class="crs__new">${two(round)}</b></span>
        </div>
        ${watching ? null : html`<div class=${cx('crs__cell', 'crs__cell--gold', n && 'has-gain')} data-testid="round-popup-gain">
          <span class="crs__k">${t('获得')}</span>
          <i class="crs__flash"></i>
          <span class="crs__gain"><i class="crs__ico"></i>${n ? html`<b class="crs__plus num">+${n}</b>` : null}</span>
          ${n ? html`<span class="crs__coins">${COINS.map(([x,y,size,delay],i)=>html`<i key=${i}
            style=${`--x:${x};--y:${y};--s:${size};--d:${delay}ms`}></i>`)}</span>` : null}
        </div>`}` : html`<${WindowMessage} variant=${variant} title=${title} loss=${loss} />`}
        <i class="crs__narrow"></i>
        <i class="crs__hand"></i>
        <i class="crs__star"></i>
        <i class="crs__star crs__star--tv"></i>
        <i class="crs__tint"></i>
      </div>
      <${ClosureSpine} cls="crs__fig" box=${SPINE_BOX} fig=${SPINE_FIG} bg=${SPINE_BG} onReady=${() => setFigureReady(true)} />
      <i class="crs__pop"></i>
      <i class="crs__stk crs__stk--2"></i>
      <i class="crs__stk crs__stk--1"></i>
      <i class="crs__strokes"></i>
      ${variant === 'unite' ? html`<span class="crs__unite-sparks">${[[430,353,38,720],[890,276,42,850],[408,420,24,1120],[684,388,25,620],[858,389,19,1050]].map(([x,y,s,d],i)=>html`<i key=${i} style=${`--x:${x};--y:${y};--s:${s};--d:${d}ms`}></i>`)}</span>` : null}
      ${left ? html`<span class="crs__left">${t('剩余 {n} 回合', { n: left })}</span>` : null}
      <i class="crs__out-scan"></i>
      <span class="crs__sparks">${SPARKS.map(([x, y, s, d], i) => html`<i key=${i} style=${`--x:${x};--y:${y};--s:${s};--d:${d}ms`}></i>`)}</span>
    </div>
    ${watching && sub ? html`<div class="crs__line">${sub}</div>` : null}
  </div>`;
}
