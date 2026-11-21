// public/ui-compat/js/nodeLatency.js — 分享包「节点延迟」store 的降级桩（本仓没有节点选择）。
const STATE = Object.freeze({ results: {}, nodes: [], updatedAt: 0 });
export const latencyStore = { get: () => STATE, subscribe: () => () => {} };
