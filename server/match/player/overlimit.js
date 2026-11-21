// server/match/player/overlimit.js — 超限模拟「词条」（饰品 + 负面词条）的**玩家侧**状态与视图。
//
// 业主 2026-11-02：词条是「各玩家独立抽选、效果也各自独立」的。以前候选 / 已选 / 效果全挂房间级
// （`m.relicsOverlimit` 单一对象 + `m.public.sp.cards` 一手共享牌 + battleInput 读 match），于是看起来像共享。
// 现在这三样都在玩家维度：
//
//   ps.relicsOverlimit = { picked: string[], negPicked: { id, tier }[], log: [...] }   ← 他自己的已选与选取日志
//   ps.relicDraft      = { kind, round, negative, cards: [...] }                       ← 这一次三选一里**他自己**那一手
//
// 效果侧同一口径（都在别的文件里读 ps，不读 match）：
//   · battleInput().relicsOverlimit / .relicsOverlimitNegative —— 只填这名玩家自己的（player/round.js）；
//   · effectsMeta 的 ctx.overlimitRelics() / ctx.overlimitNegatives() —— 读这名玩家（match/effectsMeta.js）；
//   · LC-EX1 的经费跨回合保留 —— endPrep 只看他自己的清单（player/round.js）。
// 非超限局：`ps.relicsOverlimit` / `ps.relicDraft` 一个字段都不会被建，私有视图也不多这两把键。

import {
  negativePool, negativeTable, nextNegativeRounds, nextRelicRounds, relicPool, relicStateOf, relicTable,
} from '../relicsOverlimit.js';

export class PlayerOverlimit {
  /** 他自己的词条状态（懒建；见 relicsOverlimit.js relicStateOf）。 */
  relicState() { return relicStateOf(this); }

  /**
   * `m.private.relicsOverlimit` —— 他自己看得到的词条状态（形状与改动前一致，内容是**他自己的**）：
   *   `picked`     他选走的**饰品** id（按选取顺序）
   *   `negPicked`  他选走的**负面**词条 `{ id, tier }`（tier = 档位序号，没档位是 null）
   *   `pool`       无限段饰品池里他**还剩**什么（id 列表；正常段 R8 之前也算出来，便于预览）
   *   `negPool`    负面池里他还剩什么（有挡位恒留池里、无挡位按已选剔除，与抽取口径一致）
   *   `nextAt`     还没开过的**饰品**词条回合 / `nextNegAt` 负面词条回合（房间级排期 + 他是否已经选过）
   * 非超限局不会走到这里（privateView 的 gate 在 player/views.js 与 Match.isInfinite）。
   * @returns {{ picked: string[], negPicked: { id: string, tier: number|null }[], pool: string[], negPool: string[],
   *   nextAt: number[], nextNegAt: number[] }}
   */
  relicsView() {
    const st = this.relicState();
    const table = relicTable(this.gd);
    const negTable = negativeTable(this.gd);
    const picked = st.picked.slice();
    const negPicked = st.negPicked.map((x) => (typeof x === 'string'
      ? { id: x, tier: null }
      : { id: x.id, tier: Number.isInteger(x.tier) ? x.tier : null }));
    const pool = table ? relicPool(table, 'infinite', new Set(picked)).map((e) => e.id) : [];
    const negPool = negTable ? negativePool(negTable, negPicked).map((e) => e.id) : [];
    const m = this.m || {};
    const done = m.relicDraftRounds instanceof Set ? m.relicDraftRounds : [];
    return {
      picked, negPicked, pool, negPool,
      nextAt: nextRelicRounds(m.round, done, 3),
      nextNegAt: nextNegativeRounds(m.round, done, 3),
    };
  }

  /**
   * `m.private.relicDraft` —— 这一次词条三选一里**他自己那一手**（三张卡，服务端 relicCardView / negativeCardView
   * 的形状）。收尾即清空（`finishRelicDraft`），所以键只在三选一进行中、且这个人还没选的时候出现。
   * 公开帧 `m.public.sp` 不带任何候选 —— 别人看不到你的牌，你也看不到别人的。
   * @returns {{ kind: string, round: number, negative: boolean, cards: any[] }|null}
   */
  relicDraftView() {
    const d = this.relicDraft;
    if (!d || typeof d !== 'object' || !Array.isArray(d.cards) || !d.cards.length) return null;
    return {
      kind: d.kind,
      round: d.round,
      negative: d.negative === true,
      cards: d.cards.map((c) => ({ ...c })),
    };
  }
}
