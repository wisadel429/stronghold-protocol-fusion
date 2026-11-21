// public/ui-compat/shared/constants.js — 宿主 shared/constants.js + 分享包要的难度辅助函数。
export * from '/shared/constants.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS } from '/shared/constants.js';
import { t } from '/shared/i18n.js';

/** 这个值是不是本仓的难度档。 */
export const isDifficulty = (d) => DIFFICULTIES.includes(d);

/** 难度名（本仓 DIFFICULTY_NAMES 里是 i18n 标记，走 t() 才是可显示字符串）。 */
export function difficultyName(d) {
  const key = DIFFICULTY_NAMES[d];
  if (!key) return '';
  try { return t(key); } catch { return typeof key === 'string' ? key : ''; }
}

/** 主题拿它当 DIFFICULTY_COLORS 的键；本仓键就是难度值本身，未知回退 FUNNY。 */
export const difficultyTheme = (d) => (Object.prototype.hasOwnProperty.call(DIFFICULTY_COLORS, d) ? d : 'FUNNY');

/** 该房间模式可选难度：本仓四档在单人与同盟都齐全。 */
export const difficultyOptions = () => DIFFICULTIES.slice();
