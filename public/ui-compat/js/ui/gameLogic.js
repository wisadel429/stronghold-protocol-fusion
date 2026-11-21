// public/ui-compat/js/ui/gameLogic.js — 宿主 gameLogic.js + 分享包要的两个布局/草稿辅助函数。
export * from '/js/ui/gameLogic.js';

/**
 * 竞技场舞台矩形。主题只拿它算 UI 位置：优先取 spec/field 自带矩形，取不到就 null（调用方都做了空值判断）。
 * @param {any} field
 * @param {any} spec
 * @returns {{ r0?: number, c0?: number, r1?: number, c1?: number }|null}
 */
export function arenaStageRect(field, spec) {
  const cand = spec?.stageRect || field?.stageRect || spec?.rect || field?.rect || null;
  if (!cand || typeof cand !== 'object') return null;
  return cand;
}

/**
 * 还没选完策略的玩家。本仓草稿结构是 { order, picks, picks2, rounds }（见 ui/gameLogic/draft.js）。
 * @param {any} draft
 * @returns {any[]}
 */
export function pendingDraftPlayers(draft) {
  if (!draft || typeof draft !== 'object') return [];
  const order = Array.isArray(draft.order) ? draft.order : (Array.isArray(draft.players) ? draft.players : []);
  if (!order.length) return [];
  const rounds = Number.isInteger(draft.rounds) ? draft.rounds : 1;
  const b1 = draft.picks && typeof draft.picks === 'object' ? draft.picks : {};
  const b2 = draft.picks2 && typeof draft.picks2 === 'object' ? draft.picks2 : {};
  const idOf = (p) => (p && typeof p === 'object' ? p.playerId : p);
  const picked = (id) => {
    const a = b1[id] ?? b1[idOf(id)];
    const b = rounds > 1 ? (b2[id] ?? b2[idOf(id)]) : true;
    return a != null && b != null;
  };
  return order.filter((p) => !picked(idOf(p)));
}
