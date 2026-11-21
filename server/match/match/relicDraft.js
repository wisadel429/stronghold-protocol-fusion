// server/match/match/relicDraft.js — 超限模拟「词条」（饰品）的三选一阶段（业主 2026-10-31；2026-11-02 改为**每人一份**）。
//
// **不发明新协议**：整个阶段复用既有的 机变/惊变 三选一通道 ——
//   · 阶段 = PHASE.SP_DRAFT（客户端本来就有这个阶段的全屏浮层与倒计时语义）；
//   · 数据 = m.private.relicDraft { kind, round, negative, cards: [...] }（**每名玩家一手，各自抽选**）+
//     m.public.sp 的阶段骨架 { family: 'overlimit', relicKind, round, negative, untimed, picks }（不含候选）；
//   · 选卡 = 既有 `g.choice { idx }` → MatchSpDraft.pickCard → MatchRelicDraft.pickRelic（见 spDraft.js）；
//   · 收尾 = MatchSpDraft.finishSpDraft → finishRelicDraft（把同一回合的机变 / 无限段的词条抉择串起来）。
//
// 触发（业主定稿）：
//   · 正常段：R3 与 R8 各一次，池 = **还没选过的 LC**（7 → 6 → 5）；R5 / R11 抽负面池（见下）；
//   · 无限段：每个 Boss 轮（R20/25/30…）打完后的下一回合一次，池 = SP + EX + FGO-SP + FGO-Ⅹ + 普通 FGO +
//     未被选走的 LC（去掉所有已选过的）。抽饰品还是负面由 `relicDraftKind` 按 Boss 轮交替决定
//     （R21/R31/R41 负面、R26/R36/R46 饰品）。
//
// **每人独立（业主 2026-11-02）**：以前这里抽一次 3 张给全房、`m.relicsOverlimit.picked` 也是房间级单一对象，
// 于是「候选共享、已选共享、效果共享」。现在：
//   · 候选：`drawRelicHand(ps, …)` 按**每名玩家自己的**剩余池各抽一手 → `ps.relicDraft`（只进 m.private）；
//   · 已选：`ps.relicsOverlimit.picked / negPicked / log`（每人一份，无放回只在他自己的池子里成立）；
//   · 排期：match 级只剩 `m.relicDraftRounds`（哪几回合开过，**不是**词条数据）。
// 单人局（只有一名存活玩家）由第一个庄家沿用旧 RNG salt，抽到的牌与效果逐字节不变（见 drawRelicHand）。
//
// 效果分两半（业主 2026-10-31 第二批起）——**两半都只作用于选走它的那名玩家**：
//   · **整备期**：选中的瞬间到账（LC-SP1 的 10 资金）、每回合收入（FGO-09 / FGO-14）、每回合免费刷新（FGO-17）、
//     价格（LC-EX3）、跨回合经费（LC-EX1）—— 见 relicsOverlimit.js 与 content/overlimitRelics.js 的 registerMeta；
//   · **战斗**：sim 的 content/overlimitRelics.js 读 `PlayerBattleInput.relicsOverlimit`（`[{ id, at }]`），
//     而 battleInput 只填这名玩家自己的那份。
// 全部 gate 在 `this.isInfinite`，普通 / 湮灭 / 炸惊一帧不变。

import { PHASE, ERR } from '../../../shared/constants.js';
import {
  RELIC_CARD_FAMILY, RELIC_INFINITE_FROM, RELIC_NEGATIVE_KIND,
  drawRelicHand, negativeTable, relicDraftKind, relicStateOf, relicTable,
} from '../relicsOverlimit.js';
import { OK, fail, DELAYS } from './common.js';

/** 无限段的 Boss 轮口径（与 server/match/infiniteWaves.js isInfiniteBossRound 一致：R20/25/30…）。 */
const isInfiniteBossRound = (r) => Number.isInteger(r) && r >= 20 && r % 5 === 0;

/**
 * 这一回合要不要开词条三选一（**任何一个池子**：饰品或负面，见 relicsOverlimit.js relicDraftKind）。
 *
 * 正常段：R3 / R8（饰品 LC）、R5 / R11（负面）—— 还没开过就开。
 * 无限段：上一回合是 Boss 轮，**并且那只领袖真的被消灭了** —— 与 wantsTraitDraft 同一口径
 * （`_infBossClearedRound` 由 settle 在推进回合前写入；漏了 Boss 就不给词条）。
 * 抽哪个池由 `relicDraftKind` 决定（无限段按 Boss 轮交替：R21/R31/R41 负面、R26/R36/R46 饰品），这里只管「要不要开」。
 * 「开过没」读的是房间级排期 `m.relicDraftRounds`（一回合开一次，全房同时进场，各抽各的）。
 * @param {any} m Match
 * @param {number} round
 * @returns {boolean}
 */
export function wantsRelicDraft(m, round) {
  if (!m || m.isInfinite !== true) return false;
  const r = Number(round);
  if (!Number.isInteger(r) || r < 1) return false;
  const done = m.relicDraftRounds instanceof Set ? m.relicDraftRounds : null;
  if (done && done.has(r)) return false;
  if (relicDraftKind(m, r) == null) return false;
  if (r < RELIC_INFINITE_FROM) return true;              // 正常段：R3 / R5 / R8 / R11
  if (!isInfiniteBossRound(r - 1)) return false;
  if (m._infBossClearedRound != null) return m._infBossClearedRound === r - 1;
  return true;
}

export class MatchRelicDraft {
  /**
   * 房间级的**排期**（不是词条状态）：哪几回合已经开过词条三选一。
   * 词条本身（候选 / 已选 / 日志）全部在玩家维度：`ps.relicDraft` 与 `ps.relicsOverlimit`（见 relicsOverlimit.js）。
   * @returns {Set<number>}
   */
  relicRoundsDone() {
    if (!(this.relicDraftRounds instanceof Set)) this.relicDraftRounds = new Set();
    return this.relicDraftRounds;
  }

  /**
   * 开一次词条三选一：**给每名存活玩家各抽一手**（池子按 `relicDraftKind` 决定：正常段 R3/R8 = LC、
   * R5/R11 = 负面、无限段按 Boss 轮交替 = 负面 / 饰品），候选进各自的 `ps.relicDraft`，然后进入 SP_DRAFT。
   *
   * 负面池的两条额外规则（业主 2026-10-31 第三单，实现都在 relicsOverlimit.js）：
   *   · **档位按回合过滤**：R5/R11 只出 Ⅰ 档条目；无限段 R50 前 = Ⅱ 档 + 无挡位、R50 起 = Ⅲ 档 + 无挡位；
   *   · **权重 1.0 / 0.5**：有挡位的留在池里（可反复抽），无挡位的抽中即移出（`negativePool` 按 `negPicked` 剔）。
   * 两个池子的「已选走」都只按**这名玩家自己**的记录算。没有时限（untimed）—— 每人选完就等别人。
   * @param {number} round
   * @returns {boolean} 是否真的开起来了
   */
  enterRelicDraft(round = this.round) {
    if (this.isInfinite !== true) return false;
    const r = Number(round);
    const kind = relicDraftKind(this, r);
    if (kind == null) return false;
    const negative = kind === RELIC_NEGATIVE_KIND;
    const table = negative ? negativeTable(this.gd) : relicTable(this.gd);
    if (!table) return false;
    const alive = this.alivePlayers();
    if (!alive.length) return false;
    // 每人一手：各自从**自己的**剩余池抽 RELIC_CARD_COUNT 张。第一位庄家沿用旧 salt（单人 ⇒ 与改动前同牌）。
    const dealt = [];
    for (const ps of alive) {
      const cards = drawRelicHand(ps, kind, r, { first: dealt.length === 0 });
      if (!cards.length) continue;
      ps.relicDraft = { kind, round: r, negative, cards };
      dealt.push(ps);
    }
    if (!dealt.length) return false;
    const order = this.humansFirst(dealt.map((p) => p.playerId));
    this.phase = PHASE.SP_DRAFT;
    // 阶段骨架：**一份候选都不带**（牌在 m.private.relicDraft，每名玩家只看得到自己那三张）。
    // 形状照旧（order / picks / untimed …）—— 客户端的 normalizeSp 与「谁已选完」的状态位都还认得。
    this.sp = {
      family: RELIC_CARD_FAMILY,
      relicKind: kind,
      negative,
      round: r,
      // 卡面抬头由客户端出（t('词条抉择') / 眉题 OVERLIMIT // NEGATIVE）；服务端不发 UI 文案，name/desc 保持 null
      name: null,
      desc: null,
      cards: [],
      order, idx: 0, picks: {}, taken: {}, untimed: true, turnDeadline: 0,
    };
    this.relicRoundsDone().add(r);
    this.setDeadline(0);
    this.markPublic();
    // m.private.relicsOverlimit（已选 / 池子 / 下次回合）与 m.private.relicDraft（这一手候选）要立刻到端上
    for (const ps of alive) this.markPrivate(ps);
    this.scheduleRelicBots();
    return true;
  }

  /**
   * AI / 托管的席位各自选掉自己那一手（无人值守时不卡阶段）：拿第一张可选卡 —— 与旧的 scheduleSpBot 同一口径
   * （机器人没有可评估的数值模型）。每名玩家各自一条定时器，互不等待。
   * @returns {void}
   */
  scheduleRelicBots() {
    for (const ps of this.alivePlayers()) if (ps.botControlled) this.scheduleRelicBotFor(ps);
  }

  /**
   * 给**一名**刚被 AI 接管的席位补一次选牌（`kickBot` 用：托管在阶段中途打开时，这一手不会自己消失）。
   * @param {any} ps
   * @returns {void}
   */
  scheduleRelicBotFor(ps) {
    if (!ps || !ps.botControlled || !ps.relicDraft) return;
    this.later(this.scaled(DELAYS.BOT_ACTION), () => {
      if (this.phase !== PHASE.SP_DRAFT || !this.sp || this.sp.family !== RELIC_CARD_FAMILY) return;
      const cur = this.players.get(ps.playerId);
      if (!cur || !cur.alive || !cur.relicDraft || cur.relicDraft !== ps.relicDraft) return;
      const hand = cur.relicDraft;
      if (!hand || !Array.isArray(hand.cards) || !hand.cards.length) return;
      if (this.sp.picks[cur.playerId] != null) return;
      this.pickRelic(cur, 0);
    });
  }

  /**
   * 记下**这名玩家**选走的词条，并立刻结算「获得该饰品后」的整备期那一半（业主 2026-10-31 第二批）。
   *
   * 战斗侧的那一半由 content/overlimitRelics.js 读 `battleInput.relicsOverlimit` 实现；这里只做**选中的瞬间**
   * 就该到账的东西：LC-SP1「WOC，是⚪神」的「并获得 10 资金」—— **只发给选走它的这名玩家**（业主 2026-11-02：
   * 效果各自独立；以前是全房每名存活玩家各 +10）。
   * 无放回是**每人一份**：同一条对同一名玩家不会出现第二次，重复记同一 id 直接拒绝（他自己的 `picked` 里已经有它）。
   * @param {any} ps
   * @param {any} card sp.cards 的一项（现在来自 ps.relicDraft.cards）
   * @returns {boolean}
   */
  takeOverlimitRelic(ps, card) {
    if (!ps || !card || typeof card.id !== 'string' || !card.id) return false;
    if (card.negative === true) return this.takeNegativeRelic(ps, card);
    const st = relicStateOf(ps);
    if (st.picked.includes(card.id)) return false;
    st.picked.push(card.id);
    // 「只记录 / 已实装」的证据：这名玩家拿了什么、哪一回合、实装状态
    st.log.push({
      id: card.id, group: card.group || null, round: this.round,
      impl: typeof card.impl === 'string' ? card.impl : 'pending',
    });
    // 选取即到账（业主表「获得该饰品后…并获得 N 资金」）：LC-SP1 +10（这条没有失效条款）。
    if (card.id === 'LC-SP1') ps.addFunds(10, { reason: 'relic' });
    if (typeof ps.dirty === 'function') ps.dirty();
    return true;
  }

  /**
   * 记下**这名玩家**选走的负面词条（id + 档位），与饰品分开一条记录：`ps.relicsOverlimit.negPicked` /
   * `ps.relicsOverlimit.log`（带 `neg: true`）/ `battleInput.relicsOverlimitNegative`。
   * 负面词条不给任何「获得瞬间」的整备收益 —— 它的效果全是惩罚，由 sim 的 content/overlimitNegative.js 在战斗侧兑现。
   *
   * 放回规则（业主 2026-10-31 第三单）：**有挡位**的负面词条抽中后留在池里，所以同一条会被再次抽到 ——
   * 这时不叠加两份，而是把档位**升到更高的那一档**（`[ASSUMED]`：Ⅱ 期抽过 D01 = −4，Ⅲ 期又抽到 = −6 覆盖前值；
   * 记录仍只有一条，战斗侧按一条结算）。档位相同 / 更低 / 任一侧没有档位 ⇒ 按「已拥有」处理，返回 false、不动数值。
   * **无挡位**的负面词条抽中即出池（`negativePool` 按 `negPicked` 剔），正常路径不会重复到达这里。
   * @param {any} ps
   * @param {any} card sp.cards 的一项（`negative: true`）
   * @returns {boolean} 这次选取有没有改变本局的状态
   */
  takeNegativeRelic(ps, card) {
    if (!ps || !card || typeof card.id !== 'string' || !card.id) return false;
    const st = relicStateOf(ps);
    const tier = Number.isInteger(card.tierIndex) ? card.tierIndex : null;
    const at = st.negPicked.findIndex((x) => (typeof x === 'string' ? x : x && x.id) === card.id);
    if (at >= 0) {
      const cur = st.negPicked[at];
      const before = typeof cur === 'object' && cur ? cur.tier : null;
      if (!(Number.isInteger(tier) && Number.isInteger(before) && tier > before)) return false;
      cur.tier = tier;   // 同一回合的阶段更高 ⇒ 取更强的那一档（不叠加两份）
    } else {
      st.negPicked.push({ id: card.id, tier });
    }
    st.log.push({
      id: card.id, group: card.group || 'neg', round: this.round,
      impl: typeof card.impl === 'string' ? card.impl : 'pending', neg: true, tier,
    });
    if (typeof ps.dirty === 'function') ps.dirty();
    return true;
  }

  /**
   * 一名玩家选掉自己那一手里的第 idx 张（`g.choice { idx }` 的落点，见 spDraft.js pickCard）。
   * 每人一手、互不抢：别人的选取既不出现在我的候选里，也不会把我看中的那张拿走。
   * 全体都选完（每名**拿到了手牌**的存活玩家都选过）就收尾。
   * @param {any} ps
   * @param {number} idx
   * @returns {{ ok: true } | { error: string }}
   */
  pickRelic(ps, idx) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp || this.sp.family !== RELIC_CARD_FAMILY) return fail(ERR.WRONG_PHASE);
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    const hand = ps.relicDraft;
    if (!hand || !Array.isArray(hand.cards) || !hand.cards.length) return fail(ERR.WRONG_PHASE);
    if (this.sp.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    if (!Number.isInteger(idx) || idx < 0 || idx >= hand.cards.length) return fail(ERR.BAD_TARGET);
    // 负面词条升档失败（已拥有同档 / 更高档）时 take 返回 false，但这次「三选一」仍然算用掉了 —— 与改动前一致。
    this.takeOverlimitRelic(ps, hand.cards[idx]);
    this.sp.picks[ps.playerId] = idx;
    // 这一手用完即弃：私有视图里的候选随之消失（客户端收起浮层、等别人），已选的记录留在 ps.relicsOverlimit。
    ps.relicDraft = null;
    if (typeof ps.dirty === 'function') ps.dirty();
    this.markPrivate(ps);
    this.markPublic();
    if (this.relicAllPicked()) this.finishRelicDraft();
    return OK;
  }

  /**
   * 每名**拿到手牌**的存活玩家都选过了？（没拿到手的 = 池子已经空了，不参与这一次）
   * @returns {boolean}
   */
  relicAllPicked() {
    const s = this.sp;
    if (!s || s.family !== RELIC_CARD_FAMILY) return true;
    return this.alivePlayers().every((p) => !p.relicDraft || s.picks[p.playerId] != null);
  }

  /**
   * 三选一结束：清掉每名玩家的手牌与 sp，然后接下一个阶段。
   *
   *  - 无限段（`_relicPendingRound` = 下一回合号）：先把既有的词条抉择（TRAIT_DRAFT）走完（它自己会 startRound），
   *    没有再 startRound；
   *  - 正常段（R3 / R8）：同一回合的机变先走完，然后进整备。
   * @returns {void}
   */
  finishRelicDraft() {
    const pending = this._relicPendingRound;
    this._relicPendingRound = null;
    this.sp = null;
    // 手牌只是这一次三选一的临时物：收尾后从每名玩家的私有视图里消失（已选的记录留在 ps.relicsOverlimit）
    for (const ps of this.players.values()) {
      if (!ps.relicDraft) continue;
      ps.relicDraft = null;
      if (typeof ps.dirty === 'function') ps.dirty();
    }
    for (const ps of this.alivePlayers()) this.markPrivate(ps);
    if (Number.isInteger(pending) && pending > 0) {
      // 与 bossRounds.js 的时点一致：这时 this.round 还是刚打完的 Boss 轮
      this._traitDoneRound = this.round;
      this._traitPendingRound = pending;
      if (this.enterTraitDraft(pending)) return;
      this._traitPendingRound = null;
      this.startRound(pending);
      return;
    }
    if (this.gd.spRounds().includes(this.round)) {
      this.enterSpDraft();
      return;
    }
    this.beforePrepOffers();
  }

  /**
   * 调试 / 测试用：直接选一张（跳过 g.choice 的入参校验），语义与 pickCard 完全一致。
   * 正式路径永远是 `g.choice { idx }`（pickCard）。
   * @param {any} ps @param {number} idx
   */
  pickRelicAt(ps, idx) {
    return this.pickRelic(ps, idx);
  }
}
