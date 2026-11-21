// public/ui-compat/js/ui/panelDismiss.js — 分享包「点面板外关闭」的降级桩。
// 主题把它当 useEffect 的 cleanup 用；返回空函数即「什么都不装」，不会残留监听。
export function installPanelDismiss() { return () => {}; }
