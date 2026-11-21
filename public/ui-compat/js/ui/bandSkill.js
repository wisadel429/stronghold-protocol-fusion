// public/ui-compat/js/ui/bandSkill.js — 分享包「策略技能」的降级桩（本仓没有这套功能）。
// 主题的 game.js 会拿 skillOf(priv) 判断有没有技能可放；恒 null → 技能按钮/面板/目标条整块不渲染。
export function skillOf() { return null; }
export function skillMode() { return 'none'; }
export function skillAvailability() { return { ok: false, usable: false, reason: 'unavailable' }; }
export function skillTargetList() { return []; }
export function skillTargetValid() { return false; }
export function skillRequestFor() { return null; }
export function skillHasTargets() { return false; }
export const TREASURE_SFX_UNIT = 'treasure';
export function BandSkillButton() { return null; }
export function BandSkillPanel() { return null; }
export function BandSkillTargetBar() { return null; }
export function BandSkillSpendFx() { return null; }
export function BandSkillTileMarks() { return null; }
