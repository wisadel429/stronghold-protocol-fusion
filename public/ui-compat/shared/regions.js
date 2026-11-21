// public/ui-compat/shared/regions.js — 分享包「复合战场分区」的降级桩（本仓舞台都是整张 19×21）。
// regionsOf 恒 null（本仓舞台没有 regions 字段）；stageForField 原样把舞台交回去 —— 主题下游
// placementContext / view.setStage 拿到的就是宿主自己那张图，部署点不会失效。
import { GEO } from '/shared/constants.js';

const ROWS = Number.isInteger(GEO?.ROWS) ? GEO.ROWS : 19;
const COLS = Number.isInteger(GEO?.COLS) ? GEO.COLS : 21;

export function regionsOf(stage) {
  if (!stage || typeof stage !== 'object') return null;
  return Array.isArray(stage.regions) && stage.regions.length ? stage.regions : null;
}

export function stageForField(stage, _seat, opts) {
  if (!stage || typeof stage !== 'object') return null;
  const size = Array.isArray(stage.size) ? stage.size : null;
  if (!size || (size[0] === ROWS && size[1] === COLS)) return stage;   // 标准舞台：原样返回（= 宿主自己的用法）
  const rect = opts?.rect || stage.rect;
  if (!rect) return stage;                                             // 不猜：宁可画整张
  try {
    const r0 = Math.max(0, Math.min(ROWS - 1, rect.r0 ?? rect.y ?? 0));
    const c0 = Math.max(0, Math.min(COLS - 1, rect.c0 ?? rect.x ?? 0));
    const rows = Array.isArray(stage.rows) ? stage.rows.slice(r0, r0 + ROWS) : null;
    return rows ? { ...stage, size: [ROWS, COLS], rows: rows.map((row) => (Array.isArray(row) ? row.slice(c0, c0 + COLS) : row)) } : stage;
  } catch { return stage; }
}
