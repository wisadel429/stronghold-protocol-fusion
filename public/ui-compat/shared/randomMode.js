// public/ui-compat/shared/randomMode.js — 宿主 randomMode.js + 分享包要的 variantRounds。
export * from '/shared/randomMode.js';
import { RANDOM_MODE } from '/shared/randomMode.js';

/**
 * 随机模式的回合数：主题拿 `.totalRounds` 显示「N 回合」。
 * 本仓 RANDOM_MODE 的条目里带 totalRounds（不支持的模式是 0），取不到就 null（主题显示 0 也不会崩）。
 * @param {string} variant
 */
export function variantRounds(variant) {
  const m = RANDOM_MODE && typeof RANDOM_MODE === 'object' ? RANDOM_MODE[variant] : null;
  const n = Number(m?.totalRounds);
  return { totalRounds: Number.isFinite(n) ? n : null };
}
