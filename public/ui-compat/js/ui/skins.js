// public/ui-compat/js/ui/skins.js — 宿主 skins.js + 分享包要的 portraitSkinFor(chess, entries)。
export * from '/js/ui/skins.js';
import { skinFor, skinsStore } from '/js/ui/skins.js';

/**
 * 某个干员的立绘皮肤。本仓 store 里的键是 `skins`（不是主题以为的 `entries`），
 * 所以先查传入 entries，再退回宿主 store。
 * @param {any} chess 干员记录或 id
 * @param {object|null} entries
 */
export function portraitSkinFor(chess, entries = null) {
  const charId = typeof chess === 'string' ? chess : chess?.charId;
  if (!charId) return null;
  const fromEntries = entries && typeof entries === 'object' ? entries[charId] : null;
  if (fromEntries) return fromEntries;
  try { return skinFor(charId) || skinsStore?.get?.()?.skins?.[charId] || null; } catch { return null; }
}
