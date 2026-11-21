// 「全能的」可露希尔 theme — the shop ([uc]ac_s_closur panel_shop_main), drawn by ui/shopBar.js ShopBar in place of the
// default bar when the theme is on (acTheme.js). ShopBar keeps every rule (two taps, reasons, the reward offer, the
// slots' cards — ChessCard / ItemCard / MysteryCard / SoldCard / EmptyCard, restyled by css/screens/ac-closure-battle.css);
// this file only lays them out the theme's way and adds what the theme has and the default bar has not:
//   the LEVEL card on the theme's parts (upgrade_disable while it can't be bought; otherwise a grey body with the pink
//     inner_bg screen, upgrade_level tag, upgrade_lv_N numeral + bar, the flowing inner_flow cloud, upgrade_bottom_glow
//     — glow2 and 确认升级 under ▼ once armed); its price in mint while it is cheaper than when the level began
//     (footage: 5 at round 1, 4 in mint at round 2);
//   冻结 / 解冻 on frozen_bg_normal / frozen_bg_unlock, 刷新 on refresh_bg_normal with refresh_icon on refresh_icon_bg
//     (the *_disable / *_lock sprites while they can't be used);
//   Closure's lines once the thing has happened (acClosureVoice.js): 升级中心 after a level-up, 调度干员 now and then
//     after an operator was bought (its slot turned sold — not on the tap), 冻结 when frozen, 晋升机会 when the shop
//     newly shows the copy that completes a triple (ShopBar's `promo`);
//   the room at the screen's bottom-right corner: bg_open, the cube wall closure_back_active, the theme's Spine figure
//     (ac_s_closur_spine, Idle looped; Happy after a purchase or an upgrade, Interact when tapped), the funds hex
//     (bg_money) and 收起 / 展开 with close_arrow / open_arrow. The room stays mounted when the shop folds — folded, only
//     the room, 剩余可放置角色 and a small LEVEL window (level_able) are left, as in the footage.
// Measured on the theme footage (2026-11-09 recording, 1280 × 588, one design px = 0.8167 px; tools/match.py), every
// sprite 1:1 on the 1280 × 720 design grid, from the screen's bottom-right corner: bg_open at the corner; the cards
// (chess_frame_* 161 × 209) every 162 with the last one's right edge 188 from the screen's, 2.8 above its bottom; the
// LEVEL card (118 × 203) 2 left of the first card; 冻结 / 刷新 at 153.7 / 5 from the right, 220 above the bottom.
// When the cards would not fit the screen's width (the default bar's 5 operators + equipment at 16:9) the whole shop
// scales down from that corner (--cshop-k).

import { html } from '/js/ui/components.js';
import { useEffect, useLayoutEffect, useRef, useState } from '/vendor/hooks.module.js';
import { ClosureSpine } from '/js/ui/acClosureSpine.js';
import { closureVo, BUY_CHANCE } from '/js/ui/acClosureVoice.js';
import { acThemeArt } from '/js/ui/acTheme.js';
import { t } from '/shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const art = (name) => acThemeArt(name, 'ac_s_closur');

/** Design px (1280 × 720 grid) right of the card row: the room's part that no card covers. */
const ROW_RIGHT = 188;

/** Independent pieces of the first-tap purchase window (07-04-02, 105.83–106.23s). */
export function ClosurePurchaseIcon() {
  return html`<span class="cconfirm__window" aria-hidden="true">
    <i class="cconfirm__cat"></i><i class="cconfirm__cart"></i><i class="cconfirm__stamp"></i>
  </span>`;
}

/** Animate the received stock, not the refresh tap. A buy only sets sold; an upgrade opens empty slots. */
function useStockEntrance(ref, { slots, lv, owner, refreshCount, collapsed, showReward }) {
  const signature = JSON.stringify(slots.map(s => s ? [s.kind, s.id, !!s.mystery, !!s.sold] : null));
  const last = useRef(null);
  const motion = useRef(null);
  useLayoutEffect(() => {
    const now = { slots: JSON.parse(signature), lv, owner, refreshCount, collapsed, showReward };
    const before = last.current;
    last.current = now;
    if (!before || before.owner !== owner || before.lv !== lv || collapsed || before.collapsed || showReward || before.showReward) return;
    // The counter also identifies a reroll that happens to produce the same ids. Slot comparison
    // covers automatic round restocks and older snapshots without that counter.
    const counted = Number.isFinite(refreshCount) && Number.isFinite(before.refreshCount) && refreshCount > before.refreshCount;
    const replaced = now.slots.some((s, i) => s && !s[3] &&
      (!before.slots[i] || before.slots[i][3] || s.slice(0, 3).join(':') !== before.slots[i].slice(0, 3).join(':')));
    if (!counted && !replaced) return;
    motion.current?.cancel();
    if (!ref.current || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // All stock moves together; LEVEL and the room remain still. 111.95–112.13s, 60fps.
    motion.current = ref.current.animate([
      { translate: '0 calc(var(--cp) * 110)', opacity: 0, offset: 0 },
      { translate: '0 calc(var(--cp) * 90)', opacity: .28, offset: .1 },
      { translate: '0 calc(var(--cp) * 65)', opacity: .48, offset: .2 },
      { translate: '0 calc(var(--cp) * 25)', opacity: .82, offset: .4 },
      { translate: '0 calc(var(--cp) * 6)', opacity: 1, offset: .6 },
      { translate: '0 calc(var(--cp) * 1)', opacity: 1, offset: .8 },
      { translate: '0 0', opacity: 1, offset: 1 },
    ], { duration: 180, easing: 'linear' });
  }, [signature, lv, owner, refreshCount, collapsed, showReward]);
  useEffect(() => () => motion.current?.cancel(), []);
}

/** Keep the shop bottom aligned, fitting to the right of the bottom-left controls. */
function useFitScale(rowRef, deps) {
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const fit = () => {
      const host = row.closest('.gm__hud') || document.documentElement;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 100;
      const px = rem / 66.6667;
      const need = row.offsetWidth + (ROW_RIGHT + 4) * px; // offsetWidth: the row's own width, before any scale
      const controls = host.querySelector('.gm__corner');
      const left = controls ? Math.max(0, controls.getBoundingClientRect().right - host.getBoundingClientRect().left) + 16 : 0;
      const W = Math.max(1, (host.clientWidth || window.innerWidth) - left);
      const next = need > W ? Math.floor((W / need) * 1000) / 1000 : 1;
      setK((v) => (v === next ? v : next));
    };
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(row);
    const controls = row.closest('.gm__hud')?.querySelector('.gm__corner');
    if (controls) ro?.observe(controls);
    window.addEventListener('resize', fit);
    return () => { ro?.disconnect(); window.removeEventListener('resize', fit); };
  }, deps);
  return k;
}

/** The skeleton in the room: Idle looped; `cue` {name, n} plays `name` once (each new n), then Idle again. */
function ClosureFigure({ cue }) {
  // the canvas is the room's box (272 × 236 design px); the skeleton's feet origin and scale in it (footage 0:45)
  return html`<${ClosureSpine} cls="croom__fig" box=${ROOM_BOX} fig=${FIG} cue=${cue} />`;
}
const ROOM_BOX = [272, 236];
/** Skeleton placement in the room's box: design px per skeleton unit, the feet origin (from the box's top-left). */
const FIG = { scale: 0.432, x: 171.5, y: 185 };

/** A price on the theme's hexagon (cost_bg_1, cost_bg_2 when grey); `tone`: '' | 'mint' | 'red' | 'grey'. */
function PriceHex({ value, tone = '', cls }) {
  return html`<span class=${cx('chex', tone && `chex--${tone}`, cls)}><b>${value}</b></span>`;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

/** A line after what it answers has shown (the sold card, the new level) — ms. */
const VO_DELAY = 300;

/**
 * What changed in the shop since the last render, for the figure and the lines: a slot that was on offer is now sold
 * (`bought`; `boughtOp` when it was an operator), the level went up, the shop got frozen, a triple-completing copy is
 * newly on offer. A refresh or a new round replaces the slots (ids change, sold flags clear): nothing counts as bought.
 */
function useShopEvents({ slots, lv, frozen, promo }) {
  const now = { slots: slots.map((s) => (s ? { id: s.id, sold: !!s.sold, op: s.kind !== 'item' } : null)), lv, frozen, promo: new Set(promo) };
  const sig = JSON.stringify([now.slots, lv, frozen, promo]);
  const seen = useRef(null);
  const [ev, setEv] = useState({ n: 0 });
  useEffect(() => {
    const was = seen.current;
    seen.current = now;
    if (!was) { if (now.promo.size) setEv((e) => ({ n: e.n + 1, promo: true })); return; }
    const sold = now.slots.map((s, i) => s && s.sold && was.slots[i] && !was.slots[i].sold && was.slots[i].id === s.id ? was.slots[i] : null).filter(Boolean);
    const e = {
      bought: sold.length > 0, boughtOp: sold.some((s) => s.op), up: lv > was.lv, freeze: frozen && !was.frozen,
      promo: [...now.promo].some((id) => !was.promo.has(id)),
    };
    if (e.bought || e.up || e.freeze || e.promo) setEv((x) => ({ ...e, n: x.n + 1 }));
  }, [sig]);
  return ev;
}

// Upgrade acknowledgement, 07-04-02 at 278.6667s: bottom-up white wipe, pink rim,
// three large outlined stars and rising double-chevron particles, gone by ~1.15s.
const LEVEL_STARS = [
  [6, 97, 40, 40, 18, -100, '#f2a0ed', '#e8a2d0'],
  [108, 119, 42, 40, 20, -100, '#ff9cce', '#f17d9f'],
  [58, 187, 62, 90, -20, -43, '#ed9dec', '#78cff5'],
];
const LEVEL_ARROWS = [
  [-5, 125, 10, 40, 850, 95, '#ffffff'], [12, 180, 18, 90, 900, 110, '#ffffff'],
  [34, 145, 21, 110, 850, 105, '#ff77c8'], [70, 100, 20, 70, 850, 105, '#83c5ff'],
  [114, 90, 11, 50, 850, 110, '#ffffff'], [88, 225, 12, 170, 850, 105, '#ffffff'],
  [-2, 213, 9, 270, 800, 110, '#ffffff'], [30, 105, 9, 180, 800, 100, '#eeb5ff'],
  [108, 196, 18, 230, 850, 105, '#83c5ff'], [116, 172, 9, 370, 740, 110, '#ffffff'],
];
const LEVEL_SPARKS = [[-5,200,13,160],[112,154,13,100],[12,142,13,120],[118,52,10,200],[35,16,10,340],[6,75,10,470]];
function ClosureLevelSuccess() {
  return html`<span class="clv-success" aria-hidden="true">
    <i class="clv-success__wash"></i><i class="clv-success__flash"></i><i class="clv-success__edge"></i>
    ${LEVEL_STARS.map(([x,y,s,d,r,dy,c1,c2],i)=>html`<i key=${`s${i}`} class="clv-success__star"
      style=${`--x:${x};--y:${y};--s:${s};--d:${d}ms;--r:${r}deg;--dy:${dy};--c1:${c1};--c2:${c2}`}></i>`)}
    ${LEVEL_ARROWS.map(([x,y,s,d,dur,dy,c],i)=>html`<i key=${`a${i}`} class="clv-success__arrow"
      style=${`--x:${x};--y:${y};--s:${s};--d:${d}ms;--dur:${dur}ms;--dy:${dy};--c:${c}`}></i>`)}
    ${LEVEL_SPARKS.map(([x,y,s,d],i)=>html`<i key=${`p${i}`} class="clv-success__spark"
      style=${`--x:${x};--y:${y};--s:${s};--d:${d}ms`}></i>`)}
  </span>`;
}

/** The LEVEL card (same taps and titles as ShopBar's default LevelCard). */
function ClosureLevelCard({ shop, reason, armed = false, onTap, hotkey }) {
  const lv = Math.max(1, Math.min(6, Number(shop?.level) || 1));
  const max = lv >= (shop?.maxLevel ?? 6);
  const price = Number(shop?.upgradePrice) || 0;
  // the price a level starts at; a lower one later (the per-round discount) is drawn in mint
  const first = useRef({ lv, price });
  if (first.current.lv !== lv) first.current = { lv, price };
  const cheaper = price < first.current.price;
  const last = useRef({ lv, armed });
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    // Warm the small particle textures before the first successful upgrade.
    const images = ['particle_arrow', 'img_fx_star_outline2', 'tv_star_mask', 'img_fx_star_small', 'upgrade_card_flash_outline']
      .map((name) => { const image = new Image(); image.src = art(name); return image; });
    return () => { images.length = 0; };
  }, []);
  useLayoutEffect(() => {
    const before = last.current;
    last.current = { lv, armed };
    const kind = lv > before.lv ? 'up' : armed && !before.armed ? 'arm' : null;
    if (kind) setFlash((f) => ({ n: (f?.n || 0) + 1, kind }));
  }, [lv, armed]);
  const off = !!reason && !max;
  const state = max ? 'max' : off ? 'off' : armed ? 'armed' : 'on';
  const shown = armed && !max ? lv + 1 : lv;
  return html`<button type="button" class=${cx('lvcard', 'clv', `clv--${state}`, max && 'is-max', off && 'is-disabled', armed && 'is-armed')}
      onClick=${() => !reason && onTap()} aria-disabled=${reason ? 'true' : 'false'} aria-pressed=${String(!!armed)}
      title=${reason || (armed ? t('再次点击确认升级（{price} 资金）', { price }) : t('升级调度中心（{price} 资金） · {key}', { price, key: hotkey }))}>
    ${state === 'off' ? null : html`
      <i class="clv__body"></i><i class="clv__glow"></i><i class="clv__plug"></i>
      <span class="clv__screen">
        <i class="clv__flow"></i><i class="clv__tag"></i><i class="clv__arrow"></i><i class="clv__arrow clv__arrow--r"></i>
      </span>
      <i class="clv__star"></i><i class="clv__rim"></i>
      <i class="clv__pill"></i>
      <i class="clv__sticker"></i><i class="clv__deco"></i>`}
    ${armed && !max ? html`<i class="clv__lv clv__lv--old" style=${`--lv:url(${art(`upgrade_lv_${lv}`)})`} aria-hidden="true"></i>` : null}
    <i class=${cx('clv__lv', armed && !max && 'clv__lv--next')} style=${`--lv:url(${art(`upgrade_lv_${shown}`)})`} aria-hidden="true"></i>
    ${max ? null : html`<${PriceHex} value=${price} tone=${off ? 'grey' : cheaper ? 'mint' : ''} cls="clv__price" />`}
    ${armed && !max ? html`<i class="clv__caret" aria-hidden="true"></i>` : null}
    ${armed && !max ? html`<span class="clv__label clv__label--old" aria-hidden="true">${t('升级')}</span>` : null}
    <span class="clv__label">${max ? t('已满级') : armed ? t('确认升级') : t('升级')}</span>
    <b class="clv__sr">${t('调度中心等级 {lv}', { lv })}</b>
    ${flash?.kind === 'up' ? html`<${ClosureLevelSuccess} key=${`up${flash.n}`} />`
      : flash ? html`<span class="clv__fx clv__fx--arm" key=${flash.n} aria-hidden="true"><i></i></span>` : null}
  </button>`;
}

/** 冻结 / 解冻 and 刷新 (above the room, as in the footage). */
function ClosureTools({ frozen, frzReason, refReason, refreshBusy, free, refreshPrice, hotkeys, onFreeze, onRefresh }) {
  const refOff = !!refReason || refreshBusy;
  return html`<div class="cshop__tools">
    <button type="button" class=${cx('ctool', 'ctool--frz', 'toolbtn--ice', frozen && 'is-frozen')} disabled=${!!frzReason} onClick=${onFreeze}
      title=${frzReason || (frozen ? t('解冻商店 · {key}', { key: hotkeys.freeze }) : t('冻结商店（下回合保留） · {key}', { key: hotkeys.freeze }))}>
      <span class="ctool__txt">${frozen ? t('解冻') : t('冻结')}</span>
    </button>
    <button type="button" class=${cx('ctool', 'ctool--ref', 'toolbtn--amber', refreshBusy && 'is-busy')} disabled=${refOff} onClick=${onRefresh}
      title=${refReason || (refreshBusy ? t('正在刷新…') : t('刷新商店 · {key}', { key: hotkeys.refresh }))}>
      <i class="ctool__icon" aria-hidden="true"></i>
      <span class="ctool__txt">${t('刷新')}</span>
      ${free > 0 ? html`<span class="ctool__free" title=${t('免费 ×{free}', { free })}>FREE ×${free}</span>`
        : html`<${PriceHex} value=${refreshPrice} tone=${refOff ? 'grey' : ''} cls="ctool__price" />`}
    </button>
  </div>`;
}

/** The room at the corner (always mounted: the figure keeps playing while the shop folds). */
function ClosureRoom({ collapsed, funds, lv, canLevel, cue, onCue, onCollapse }) {
  return html`<div class="croom">
    <i class="croom__bg"></i>
    <i class="croom__wall"></i>
    <${ClosureFigure} cue=${cue} />
    <button type="button" class="croom__hit" onClick=${onCue} aria-label=${t('可露希尔')} tabindex="-1"></button>
    <i class="croom__deco"></i>
    ${collapsed ? html`<span class=${cx('croom__lv', canLevel && 'is-able')} aria-label=${t('调度中心等级 {lv}', { lv })}>
      <i class="croom__lvnum" style=${`--lv:url(${art(`lv_${lv}`)})`}></i></span>` : null}
    <div class="croom__funds" aria-label=${t('当前资金')}><b class="num">${funds}</b></div>
    <button type="button" class=${cx('croom__fold', collapsed && 'is-folded')} onClick=${() => onCollapse(!collapsed)}
      aria-label=${collapsed ? t('展开商店') : t('收起')} title=${collapsed ? t('展开商店') : t('收起')}>
      <span>${collapsed ? t('展开') : t('收起')}</span><i aria-hidden="true"></i>
    </button>
  </div>`;
}

/**
 * The theme's shop. Everything decided — reasons, armed state, the cards — comes from ShopBar.
 * @param {{ barRef:any, collapsed:boolean, onCollapse:(c:boolean)=>void, editable:boolean, frozen:boolean, armedAny:boolean,
 *   showReward:boolean, contract:any, tracker:any, remaining:number, funds:number, shop:any, hotkeys:any,
 *   level:{ reason:string|null, armed:boolean, onTap:Function }, tools:any, itemEls:any, cardEls:any, rewardEl:any }} p
 */
export function ClosureShop(p) {
  const { barRef, collapsed, onCollapse, editable, frozen, armedAny, showReward, contract, tracker, remaining, funds, shop, hotkeys,
    level, tools, itemEls, cardEls, rewardEl, promo = [], owner, refreshCount } = p;
  const rowRef = useRef(null);
  const stockRef = useRef(null);
  const lv = Math.max(1, Math.min(6, Number(shop?.level) || 1));
  useStockEntrance(stockRef, { slots: Array.isArray(shop?.slots) ? shop.slots : [], lv, owner, refreshCount, collapsed, showReward });
  useEffect(() => {
    // The first click should play with the tiny sprites already decoded, not load them mid-bounce.
    const images = ['doublecheck_able_1', 'doublecheck_able_2', 'doublecheck_able_3', 'doublecheck_frame',
      'doublecheck_frame_deco', 'doublecheck_frame_square', 'doublecheck_mid_bg']
      .map(name => { const image = new Image(); image.src = art(name); return image; });
    return () => { images.length = 0; };
  }, []);
  const k = useFitScale(rowRef, [collapsed, showReward]);
  // the figure's cues: Happy after a purchase (a slot turned sold) or an upgrade, Interact when tapped; and her lines —
  // one at a time: 升级中心 > 晋升机会 > 冻结 > 调度干员 (BUY_CHANCE of the operator purchases)
  const ev = useShopEvents({ slots: Array.isArray(shop?.slots) ? shop.slots : [], lv, frozen, promo });
  const [cue, setCue] = useState({ name: 'Idle', n: 0 });
  useEffect(() => {
    if (!ev.n) return undefined;
    if (ev.bought || ev.up) setCue((c) => ({ name: 'Happy', n: c.n + 1 }));
    const line = ev.up ? 'upgrade' : ev.promo ? 'promo' : ev.freeze ? 'freeze' : ev.boughtOp && Math.random() < BUY_CHANCE ? 'buy' : null;
    if (!line) return undefined;
    const id = setTimeout(() => closureVo(line), VO_DELAY);
    return () => clearTimeout(id);
  }, [ev.n]);
  const canLevel = !level.reason;
  return html`<section class=${cx('cshop', collapsed && 'is-collapsed', frozen && 'is-frozen', !editable && 'is-locked', showReward && 'has-reward', armedAny && 'has-armed')}
      ref=${barRef} aria-label=${t('调度中心')} style=${k < 1 ? `--cshop-k:${k}` : undefined}>
    <svg class="cshop__defs" width="0" height="0" aria-hidden="true" focusable="false"><filter id="cshop-ink" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.5 -0.18" /></filter></svg>
    <div class="cshop__head">${contract}${tracker}</div>
    <span class="cshop__remain">${t('剩余可放置角色：')}<b class=${cx('num', remaining === 0 && 'is-zero')}>${remaining}</b></span>
    ${collapsed ? null : html`<${ClosureTools} frozen=${frozen} ...${tools} refreshPrice=${shop?.refreshPrice ?? 1} hotkeys=${hotkeys} />`}
    <${ClosureRoom} collapsed=${collapsed} funds=${funds} lv=${lv} canLevel=${canLevel} cue=${cue}
      onCue=${() => setCue((c) => ({ name: 'Interact', n: c.n + 1 }))} onCollapse=${onCollapse} />
    ${collapsed ? null : html`<div class="cshop__row shopbar__row" ref=${rowRef}>
      <${ClosureLevelCard} shop=${shop} reason=${level.reason} armed=${level.armed} onTap=${level.onTap} hotkey=${hotkeys.level} />
      ${showReward ? rewardEl : html`<div class="cshop__stock" ref=${stockRef}>${itemEls}${cardEls}</div>`}
    </div>`}
  </section>`;
}
