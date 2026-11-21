// public/ui-compat/js/ui/bondHighlightPrefs.js — 分享包「盟约高亮偏好」的降级桩。
// store.get() 返回同一个稳定对象（useStore 会反复调用，返回新对象会抖动），enabled:false 让主题跳过整段追踪计算。
const STATE = Object.freeze({ enabled: false, trackedIds: [], tracked: [] });
export const bondHighlightStore = {
  get: () => STATE,
  subscribe: () => () => {},
};
