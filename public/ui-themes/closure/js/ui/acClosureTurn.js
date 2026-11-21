// 06-32-56, 18.3–19.55s: the draft's own-turn cue grows out of a small group,
// with Closure, three TVs, cyan lettering, floating letters and a purple floor grid.
import { html } from '/js/ui/components.js';
import { useEffect, useLayoutEffect, useState } from '/vendor/hooks.module.js';
import { ClosureSpine, preloadClosureSpine } from '/js/ui/acClosureSpine.js';
import { acThemeArt } from '/js/ui/acTheme.js';
import { t } from '/shared/i18n.js';
const art = n => acThemeArt(n, 'ac_s_closur');
const ART = ['bg','img_screen_line_hori','turn_tvs','turn_label_left','turn_label_right','turn_cube','turn_burst','tv_desc_left','tv_desc_right',
  'desc_your_turn','desc_4','desc_5','desc_y','desc_o','desc_u','desc_r','desc_t','desc_n','img_hand','tv_star_mask'];
let ready;
export function preloadClosureTurnArt() {
  if (!ready) ready = Promise.all([...ART.map(n=>new Promise(resolve=>{const i=new Image();i.onload=i.onerror=resolve;i.src=art(n);})),preloadClosureSpine()]);
  return ready;
}
const LETTERS = [['y',-183,-1],['o',-136,1],['u',-89,0],['r',-42,2],['t',5,0],['u',52,1],['r',119,0],['n',166,-1]];
const SPARKS = [[421,371,20,0],[438,399,12,70],[505,322,10,110],[788,355,13,100],[840,397,16,80],[487,410,12,160],[801,431,12,210]];
function TurnGrid() {
  const cols=Array.from({length:17},(_,i)=>640+(i-8)*47);
  return html`<svg class="cturn__grid" viewBox="0 0 1280 720" preserveAspectRatio="none">
    <g fill="none" stroke="#a4a0cf" stroke-width=".75">
      ${[408,426,449,478,514,560].map(y=>html`<line x1="255" y1=${y} x2="1025" y2=${y} />`)}
      ${cols.map(x=>html`<line x1=${x} y1="408" x2=${640+(x-640)*2.4} y2="560" />`)}
      ${[112,133,152,169,184].map(y=>html`<line x1="255" y1=${y} x2="1025" y2=${y} />`)}
      ${cols.map(x=>html`<line x1=${x} y1="184" x2=${640+(x-640)*1.8} y2="112" />`)}
    </g>
  </svg>`;
}
export function ClosureTurnPopup({ onDone }) {
  const [artReady,setArtReady]=useState(false),[figureReady,setFigureReady]=useState(false);
  const loaded=artReady&&figureReady;
  useEffect(()=>{let live=true;preloadClosureTurnArt().then(()=>{if(live)setArtReady(true)});return()=>{live=false}},[]);
  useLayoutEffect(()=>{if(!loaded)return;const id=setTimeout(()=>onDone?.(),1250);return()=>clearTimeout(id)},[loaded]);
  return html`<div class=${`mpop cturn${loaded?'':' is-loading'}`} role="status" aria-live="assertive" data-testid="turn-popup" aria-label=${t('轮到你选')}>
    <div class="cturn__stage" aria-hidden="true">
      <i class="cturn__floor"></i><${TurnGrid} /><i class="cturn__scan"></i><i class="cturn__burst"></i>
      <i class="cturn__tvs"><i class="cturn__screen cturn__screen--l"></i><i class="cturn__screen cturn__screen--r"></i></i>
      <i class="cturn__label cturn__label--l"></i><i class="cturn__label cturn__label--r"></i><i class="cturn__cube"></i>
      <${ClosureSpine} cls="cturn__fig" box=${[430,320]} fig=${{scale:.55,x:220,y:300}} onReady=${()=>setFigureReady(true)} />
      <span class="cturn__bubble">CLOSURE</span><i class="cturn__brand"></i><i class="cturn__brand-more"></i><i class="cturn__pointer"></i>
      <span class="cturn__letters">${LETTERS.map(([n,x,y],i)=>html`<i key=${i} style=${`--x:${x};--y:${y};--d:${i*32}ms;background-image:url(${art(`desc_${n}`)})`}></i>`)}</span>
      <b class="cturn__title">${t('轮到你选')}</b><i class="cturn__caption"></i><i class="cturn__hand"></i>
      ${SPARKS.map(([x,y,s,d],i)=>html`<i key=${i} class="cturn__spark" style=${`--x:${x};--y:${y};--s:${s};--d:${d}ms`}></i>`)}
    </div>
  </div>`;
}
