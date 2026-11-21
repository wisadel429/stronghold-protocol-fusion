// server/sim/content/kits/ops/op-makoto.js — 结城理 (char_4217_makoto) 自选 operator kit: 6★ 特种·傀儡师 (dollkeeper),
// an owned-6★ pick of the tier-5 and tier-6 自选 slots (the owner's decision of 2026-11-01; tools/build-data.mjs
// DIY_POOL_EXTRA puts him back into diy.ownedPool, DIY_BOND_OVERRIDES gives him 不屈 indomShip).
//
// 沿用炸惊模拟的那一套（业主 2026-11-01「沿用同一套 kit，技能/天赋不变」）: the builder IS ops/chess_zj_60_5-makoto.js's
// `chess_zj_60_5_a` — imported, never copied, so the 炸惊 chess `chess_zj_60_5_a` and this 自选 pick run one kit. Read that
// file for the trait, the three skills and both talents; every number still comes from the record's own blackboards at the
// form's rank (a 自选 pick reads data/backups.json units.char_4217_makoto at rank 4 / 7).
//
// The one difference a 自选 piece needs: it has no default skill (it chooses any of the three) and
// content/index.js selectSkillSpec never falls back to a kit's `skill` for one, so the spec the 炸惊 kit keeps outside
// `skills` — S2 人格面具, which that kit's `skill` always builds from `skchr_makoto_2`'s own blackboard (mod-tier3.js
// skillData: any id but the selected one comes from `chess.skills[]`) — is re-exposed under the map here. Same object,
// new reference: kits_layout.test.js requires every skill of every slot form under `skills`.
import zj from './chess_zj_60_5-makoto.js';

const base = zj.chess_zj_60_5_a;

export default {
  char_4217_makoto: (bb, chess, def) => {
    const kit = base(bb, chess, def);
    return { ...kit, skills: { ...kit.skills, skchr_makoto_2: kit.skill } };
  },
};
