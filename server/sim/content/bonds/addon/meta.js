// server/sim/content/bonds/addon/meta.js — prep side of the add-on bonds (research 02 §3.14–§3.17, §3.20).
//
//   助力 deputShip  onPrepEnd: every currently active bond +`layer` (tier 2 = 3 助力 by name or elite state:
//                  +`more_layer`) — buff bond_activated_add_layer
//   远见 visiShip   every `layer` layers +`count` funds (bond_layer_gain_coin); first time at `layer1`: 远见 chess cost
//                  −`discount`; first time at `layer2`: every chess costs −`discount` instead (latched, permanent)
//   奇迹 miraShip   manual refresh with no free refresh pending → p = min(1, baseprob + prob·L) the next refresh is free;
//                  every 100 layers +20 funds (bond_layer_gain_coin). `probk` has no known meaning and is unused.
//   投资人          ×2 / ×3 "获得时" garrisons: EffectDispatcher.investRepeat (server/match/effectsMeta.js).
//   调和            +1 member count for core bonds: server/match/bondsMeta.js.
//
// Milestones read the persistent layers and pay only while the bond is active; payouts owed for layers gained while it
// was inactive ("无需激活" sources) are caught up as soon as it lights up (research 02 §8 Q7 [ASSUMED]): the onActiveBonds
// hook of the recompute that activated it — a hand gain, a temp → hand move, an effect — like 维多利亚's hammers (the
// maintainer's report of 2026-10-15 for the hammer; [ASSUMED] the same timing for these funds and 远见's discount latch,
// which share its rule), and the other hooks below catch up anything a capped nested dispatch skipped.
// Funds earned after the prep phase ended (助力 / 寒檀 / 号角 … prep-end layers — the match wipes leftover funds right
// after onPrepEnd) are paid as pending funds, credited at the next round start, so "获得…资金" is never silently lost
// [ASSUMED]; `global:bondaddon_prepend` (first in every dispatch) marks the round whose prep has ended.
// 远见's −1 (「购买价格永久-1资金」) has no floor but 0: a price of 1 (至简 / 红豆's 购买价格为1 特质, run first on onPrice;
// 休露丝's first 谢拉格) becomes 0 — the text names none (owner's decision 2026-10-04; before 0.1.3 research 02 §3.15
// assumed 1).
// Latched state lives in player counters (prefix `bondaddon:`); onPrice only reads them (pure).

import { msg, dn } from '../../../../../shared/i18n.js';

const C_VISI_PAID = 'bondaddon:visi:paid';
const C_VISI_DISC = 'bondaddon:visi:disc';
const C_MIRA_PAID = 'bondaddon:mira:paid';
const C_PREP_ENDED = 'bondaddon:prepEndedRound';
/** Hooks on which owed milestones are caught up (besides the bond's own onLayers): onActiveBonds when the bond lights up. */
const SETTLE_HOOKS = Object.freeze(['onActiveBonds', 'onRoundStart', 'onPrepStart', 'onPrepEnd', 'onBuy', 'onGain', 'onSold', 'onMerge']);

/**
 * 炸惊模拟 ·【S.E.E.S】的三个「首次获得」赠礼（data/bonds.json 的 `seesShip.zj.desc` 末三行；原包
 * `modref/v2.1/server/sim/content/bonds/addon/meta.js:229-250` 的同一张表，本仓移植 0.3.3 时整段漏掉）：
 *   虎狼丸   → 「“S.E.E.S”袖章」(`chess_item_sees_armband_a`)：戴上即算【S.E.E.S】成员 —— **只有它能把成员数
 *              推到 5**（四人 + 一名戴袖章者），也就是盟约第二档「<在场5名不同【S.E.E.S】干员>」的唯一入口；
 *   岳羽由加莉 → 「月光馆学园校服」(`chess_item_sees_uniform_a`)：攻击力 +100% / 攻击速度 +120；
 *   埃癸斯   → 「人格面具召唤器」(`chess_item_sees_evoker_a`)：装备者的【S.E.E.S】盟约效果翻倍（战斗侧见
 *              ./zjbonds.js 的 sees 分支）。
 * 同一名干员只发一次（计数器 `bondaddon:sees:gift:<flag>`，本体 `_a` 与精锐 `_b` 都算「获得」）。
 * 计数器与原包同名同形，改一处就是两处（与 core.js 的里程碑同一套「兑付一次」语义）。
 */
const SEES_GIFTS = Object.freeze([
  { flag: 'kormr', who: '虎狼丸', gift: '“S.E.E.S”袖章', chess: ['chess_zj_60_2_a', 'chess_zj_60_2_b'], item: 'chess_item_sees_armband_a' },
  { flag: 'yukari', who: '岳羽由加莉', gift: '月光馆学园校服', chess: ['chess_zj_60_4_a', 'chess_zj_60_4_b'], item: 'chess_item_sees_uniform_a' },
  { flag: 'aigis', who: '埃癸斯', gift: '人格面具召唤器', chess: ['chess_zj_60_3_a', 'chess_zj_60_3_b'], item: 'chess_item_sees_evoker_a' },
]);

const n = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** `{ ...bb, ...bbStr }` of a bond buff from the match data (ctx.data), or {}. */
function buff(ctx, bondId, key) {
  const rec = ctx.data && ctx.data.bonds ? ctx.data.bonds[bondId] : null;
  for (const b of (rec && Array.isArray(rec.buffs) ? rec.buffs : [])) {
    if (b && b.key === key) return { ...(b.bb || {}), ...(b.bbStr || {}) };
  }
  return {};
}

/** Pay "every `layer` layers +`count` funds" up to the current layers (only while active). */
function settleCoins(ctx, bondId, counterKey, label) {
  if (!ctx.bondActive(bondId)) return 0;
  const p = buff(ctx, bondId, 'bond_layer_gain_coin');
  const step = n(p.layer), count = n(p.count);
  if (!(step > 0) || !(count > 0)) return 0;
  const due = Math.floor(ctx.layers(bondId) / step);
  const paid = ctx.counter(counterKey);
  if (due <= paid) return 0;
  ctx.setCounter(counterKey, due);
  const gain = (due - paid) * count;
  if (prepEnded(ctx)) {
    ctx.addPendingFunds(gain);
    ctx.toast(msg('【{label}】层数达成，下回合开始时获得{gain}资金', { label: dn(label), gain }), 'info');
  } else {
    ctx.addFunds(gain, `bond:${bondId}`);
    ctx.toast(msg('【{label}】层数达成，获得{gain}资金', { label: dn(label), gain }), 'info');
  }
  return gain;
}

/** True between this round's onPrepEnd and the end of its PREP phase (leftover funds are about to be wiped). */
const prepEnded = (ctx) => ctx.phase === 'PREP' && ctx.counter(C_PREP_ENDED) === ctx.round;

function latchVisiDiscount(ctx) {
  if (!ctx.bondActive('visiShip')) return;
  const p = visiDiscount(ctx);
  const L = ctx.layers('visiShip');
  const cur = ctx.counter(C_VISI_DISC);
  const t = L >= n(p.layer2, Infinity) ? 2 : L >= n(p.layer1, Infinity) ? 1 : 0;
  if (t > cur) {
    ctx.setCounter(C_VISI_DISC, t);
    ctx.toast(t >= 2 ? '【远见】所有干员购买价格永久降低' : '【远见】远见干员购买价格永久降低', 'info');
  }
}

function visiDiscount(ctx) {
  const modern = buff(ctx, 'visiShip', 'bond_multi_layer_char_goods_price_bond_discount');
  if (modern.layer1 != null) return modern;
  const own = buff(ctx, 'visiShip', 'bond_layer_char_goods_price_bond_discount');
  const all = buff(ctx, 'visiShip', 'bond_layer_char_goods_price_discount');
  return { layer1: own.layer, layer2: all.layer, discount: all.discount ?? own.discount, bond: own.bond };
}

function visiSettle(ctx) {
  settleCoins(ctx, 'visiShip', C_VISI_PAID, '远见');
  latchVisiDiscount(ctx);
}
const miraSettle = (ctx) => { settleCoins(ctx, 'miraShip', C_MIRA_PAID, '奇迹'); };

/** A handler object running `fn(ctx)` on every catch-up hook and on the bond's own layer gains. */
function settler(bondId, fn) {
  const h = { onLayers(ctx, ev) { if (ev && ev.bondId === bondId) fn(ctx); } };
  for (const hook of SETTLE_HOOKS) h[hook] = (ctx) => fn(ctx);
  return h;
}

export function registerMeta(registry) {
  registry.global('bondaddon_prepend', {
    onPrepEnd(ctx) { ctx.setCounter(C_PREP_ENDED, ctx.round); },
  });

  registry.bond('deputShip', {
    onPrepEnd(ctx) {
      const me = ctx.bond('deputShip');
      if (!me || !me.active) return;
      const p = buff(ctx, 'deputShip', 'bond_activated_add_layer');
      const add = me.tier >= 2 ? n(p.more_layer, n(p.layer)) : n(p.layer);
      if (!(add > 0)) return;
      const active = Object.entries(ctx.bonds()).filter(([, b]) => b && b.active).map(([id]) => id);
      for (const id of active) ctx.addLayers(id, add, { requireActive: true, reason: 'bond:deputShip' });
    },
  });

  registry.bond('visiShip', {
    ...settler('visiShip', visiSettle),
    onPrice(ctx, ev) {
      if (!ev || ev.kind !== 'chess') return;
      const t = ctx.counter(C_VISI_DISC);
      if (t <= 0) return;
      const p = visiDiscount(ctx);
      const disc = n(p.discount);
      if (!(disc > 0)) return;
      if (t < 2) {
        const rec = ctx.chessRecord(ev.id);
        if (!rec || !Array.isArray(rec.bonds) || !rec.bonds.includes(p.bond || 'visiShip')) return;
      }
      ctx.modifyPrice(-disc); // never below 0 (ctx.modifyPrice); 1 → 0 like any price (owner's decision 2026-10-04)
    },
  });

  registry.bond('miraShip', {
    ...settler('miraShip', miraSettle),
    onRefresh(ctx, ev) {
      if (!ev || ev.trigger || !ctx.bondActive('miraShip')) return;
      if (ctx.grantFreeRefresh(0) > 0) return;
      const p = buff(ctx, 'miraShip', 'bond_refresh_shop_next_free');
      const chance = Math.max(0, Math.min(1, n(p.baseprob) + n(p.prob) * ctx.layers('miraShip')));
      if (ctx.rng() < chance) {
        ctx.grantFreeRefresh(1);
        ctx.toast('【奇迹】下次刷新不消耗资金', 'info');
      }
    },
  });

  registry.bond('skillfulShip', {
    onRefresh(ctx, ev) {
      if (ev?.trigger || !ctx.bondActive('skillfulShip') || ctx.roundStats().refreshes !== 1) return;
      const p = buff(ctx, 'skillfulShip', 'bond_layer_refresh_shop_award_equip');
      if (ctx.layers('skillfulShip') < n(p.layer, Infinity)) return;
      let left = n(p.count);
      for (const [i, slot] of ctx.shopSlots().entries()) {
        if (left <= 0) break;
        if (slot?.kind === 'item' && !slot.sold) { ctx.setShopSlot(i, { ...slot, price: n(p.price) }); left--; }
      }
    },
  });

  /**
   * 炸惊模拟 ·【S.E.E.S】的「首次获得」赠礼。**门不是盟约是否已激活**：`bond:` 作用域的 handler 在每一拍都会对每个
   * 盟约 id 跑一遍（server/match/effectsMeta.js 的 bonds 段），所以「首次获得虎狼丸」在 S.E.E.S 只凑到 1 人时也能发。
   */
  registry.bond('seesShip', {
    onGain(ctx, ev) {
      const piece = ev && ev.piece;
      if (!piece || ev.kind !== 'chess' || !piece.id) return;
      for (const g of SEES_GIFTS) {
        if (!g.chess.includes(piece.id)) continue;
        const key = `bondaddon:sees:gift:${g.flag}`;
        if (ctx.counter(key)) return; // 已经发过（同一名干员只发一次）
        ctx.setCounter(key, 1);
        if (ctx.grantItem(g.item)) ctx.toast(`【S.E.E.S】首次获得${g.who}：获得「${g.gift}」`, 'success');
        return;
      }
    },
  });
}
