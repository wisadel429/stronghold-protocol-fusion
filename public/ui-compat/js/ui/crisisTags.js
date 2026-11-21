// public/ui-compat/js/ui/crisisTags.js — 分享包「危机合约」标签的降级桩（本仓无此功能）。
// 硬约定：needsCrisisCore 必须存在且恒 false，否则主题的「准备」按钮会被永久拦住。
export function needsCrisisCore() { return false; }
export function CrisisCorePrompt() { return null; }
export function CrisisTagStrip() { return null; }
export function CrisisTagButton() { return null; }
export function CrisisShopLine() { return null; }
