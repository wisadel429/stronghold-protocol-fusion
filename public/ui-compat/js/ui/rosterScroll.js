// public/ui-compat/js/ui/rosterScroll.js — 分享包「座位列表横向翻页」的降级桩。
// 主题把返回值的 prev/next 当布尔用（disabled=${!r.prev}），返回函数会画出一条永远可点、点了没反应的条，
// 所以这里一律 false → 翻页条整条不渲染。零副作用（不碰 DOM、不订阅）。
const CACHE = new WeakMap();
export function useRosterScroll(ref) {
  if (ref && typeof ref === 'object') {
    if (!CACHE.has(ref)) CACHE.set(ref, { ref, active: false, prev: false, next: false, canPrev: false, canNext: false, page: 0, pageCount: 1, scrollTo() {}, pageTo() {} });
    return CACHE.get(ref);
  }
  return { ref, active: false, prev: false, next: false, canPrev: false, canNext: false, page: 0, pageCount: 1, scrollTo() {}, pageTo() {} };
}
