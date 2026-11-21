// public/ui-compat/js/ui/loadoutModel.js — 宿主 loadoutModel.js + 分享包要的 mergeSkins。
export * from '/js/ui/loadoutModel.js';

/**
 * 合并两份皮肤配置（导入用）：对象浅合并且 incoming 优先；数组拼接去重；undefined 安全。
 * @param {any} base
 * @param {any} incoming
 */
export function mergeSkins(base, incoming) {
  if (Array.isArray(base) || Array.isArray(incoming)) {
    const a = Array.isArray(base) ? base : [];
    const b = Array.isArray(incoming) ? incoming : [];
    return [...new Set([...a, ...b])];
  }
  const isObj = (v) => v && typeof v === 'object';
  if (!isObj(base) && !isObj(incoming)) return incoming ?? base ?? null;
  return { ...(isObj(base) ? base : {}), ...(isObj(incoming) ? incoming : {}) };
}
