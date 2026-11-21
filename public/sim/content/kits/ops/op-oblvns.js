// server/sim/content/kits/ops/op-oblvns.js — 丰川祥子 (char_4182_oblvns) 自选 operator kit: 6★ 近卫·领主 (lord), an
// owned-6★ pick of the tier-5 and tier-6 自选 slots (the owner's decision of 2026-11-01; tools/build-data.mjs
// DIY_POOL_EXTRA puts her back into diy.ownedPool, DIY_BOND_OVERRIDES gives her 协防干员 emptyShip).
//
// 沿用炸惊模拟的那一套（业主 2026-11-01「沿用同一套 kit，技能/天赋不变」）: the builder IS ops/chess_zj_oblvns-oblvns.js's
// `chess_zj_oblvns_a` — imported, never copied, so the 炸惊 chess `chess_zj_oblvns_a` and this 自选 pick run one kit. Read
// that file for the trait, the three skills (all three already authored under `skills`, the 自选 pick chooses any) and both
// talents; every number comes from the record's own blackboards at the form's rank (a 自选 pick reads data/backups.json
// units.char_4182_oblvns at rank 4 / 7).
import zj from './chess_zj_oblvns-oblvns.js';

export default {
  char_4182_oblvns: zj.chess_zj_oblvns_a,
};
