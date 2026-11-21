// public/ui-compat/js/battle/observe.js — 宿主 public/js/battle/observe.js + 分享包要的 isGuichengUnite。
export * from '/js/battle/observe.js';

/**
 * 「本场是不是顾城联合（unite）那种特殊战场」。
 * 宿主 useFieldView/战场对象用 `kind` 区分（normal / unite / boss / hidden），非对象或字段缺失一律 false。
 * @param {{ kind?: string, local?: boolean }|null|undefined} field
 * @returns {boolean}
 */
export function isGuichengUnite(field) {
  if (!field || typeof field !== 'object') return false;
  return field.kind === 'unite' || field.unite === true;
}
