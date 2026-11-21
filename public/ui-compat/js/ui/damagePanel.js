// public/ui-compat/js/ui/damagePanel.js — 宿主 public/js/ui/damagePanel.js + 分享包要的 RoomDamageRanking。
export * from '/js/ui/damagePanel.js';

/**
 * 房间伤害排行（主题对局屏底部那一栏）。
 * 本仓 m.public 里没有「每人伤害」字段（只有每人的进度），拿不到数据就返回 null ——
 * 主题里它是 `skill ? … : null` 那样的条件渲染，null 等于不画。宁可空，也不画假排行。
 * @returns {null}
 */
export function RoomDamageRanking() { return null; }
