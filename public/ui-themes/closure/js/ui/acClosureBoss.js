// Final-assault HUD scene, 06-32-56 at 30.15–33.85s. The pack uses the top red
// window, not the default theme's full-field LP-merging plate. Keep its live capsule data.
import { html } from '/js/ui/components.js';
import { useEffect, useState } from '/vendor/hooks.module.js';
import { acThemeArt } from '/js/ui/acTheme.js';
import { closureVo } from '/js/ui/acClosureVoice.js';
import { t } from '/shared/i18n.js';
const art = n => acThemeArt(n, 'ac_s_closur');
const ART = ['boss_window_back_begin','boss_window_back_expand','boss_begin_tv','boss_bat','boss_bat_light',
  'boss_begin_game_stick','boss_star','boss_battle_bat','boss_battle_count','boss_hp_bar_back','boss_hp_bar_fill','boss_hp_mark','parti_triangle'];
let ready;
export function preloadClosureBossArt() {
  if (!ready) ready = Promise.all(ART.map(n=>new Promise(resolve=>{const i=new Image();i.onload=i.onerror=resolve;i.src=art(n)})));
  return ready;
}
function useBossReady() {
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{let live=true;preloadClosureBossArt().then(()=>{if(live)setLoaded(true)});return()=>{live=false}},[]);
  return loaded;
}
export function ClosureFinalAssaultCue({ onDone }) {
  const loaded=useBossReady();
  useEffect(()=>{
    if(!loaded)return;
    const voice=setTimeout(()=>closureVo('bossRound'),250);
    const end=setTimeout(()=>onDone?.(),3750);
    return()=>{clearTimeout(voice);clearTimeout(end)};
  },[loaded]);
  return html`<span class="cfinal__announcement" role="status" aria-live="polite" data-testid="final-plate">${t('最终攻势')}</span>`;
}
const STARS=[[-12,15,26,0],[0,42,26,90],[25,16,20,140],[156,19,23,40],[173,9,19,200],[166,43,22,250]];
// Mounted inside the live fill: the origin follows the actual HP edge, including
// the existing width transition. Only the small shards drift; health never loops.
export function ClosureBossHpTrail({ empty = false }) {
  if (empty) return null;
  return html`<span class="cfinal__hp-trail" aria-hidden="true">${[0,1,2].map(i=>html`<i key=${i} style=${`--i:${i}`}></i>`)}</span>`;
}
export function ClosureBossWindow({ capsule }) {
  const loaded=useBossReady();
  return html`<div class=${`cfinal${loaded?'':' is-loading'}`} role="status">
    <i class="cfinal__begin"></i><i class="cfinal__expanded"></i>
    <span class="cfinal__intro" aria-hidden="true">
      <i class="cfinal__tv"></i><i class="cfinal__light"></i><i class="cfinal__bat"></i>
      <i class="cfinal__stick"></i><b class="cfinal__word">${t('开始作战')}</b>
      ${STARS.map(([x,y,s,d],i)=>html`<i key=${i} class="cfinal__star" style=${`--x:${x};--y:${y};--s:${s};--d:${d}ms`}></i>`)}
    </span>
    <span class="cfinal__content"><i class="cfinal__crest" aria-hidden="true"></i>${capsule}</span>
  </div>`;
}
