// public/js/ui/fullscreen.js — F11 全屏切换（业主 2026-11-21「F11 可全屏」）
//
// 为什么需要：电脑版是 WebView2 内嵌宿主（Stronghold.exe），Chromium 自带的 F11 在嵌入式宿主里
// 不会触发（那是浏览器 chrome 层的行为）。所以由页面自己接管：
//   · 在启动器里（window.chrome.webview 存在）→ F11 切换 document 全屏；
//   · 在普通浏览器里 → 不接管，交给浏览器自己的 F11（否则会切换两次）。
//
// 切换目标用 documentElement（不是某个容器），这样布局跟着视口走，和浏览器全屏观感一致。

/** 是否跑在启动器的 WebView2 里（有宿主消息通道）。 */
export function isEmbedded(win = globalThis) {
  try { return !!(win && win.chrome && win.chrome.webview); } catch { return false; }
}

/** 当前是否处于全屏。 */
export function isFullscreen(win = globalThis) {
  const d = win && win.document;
  return !!(d && (d.fullscreenElement || d.webkitFullscreenElement));
}

/**
 * 切换全屏；返回是否发出了切换请求。
 * @param {any} [win]
 */
export function toggleFullscreen(win = globalThis) {
  const d = win && win.document;
  if (!d) return false;
  if (isFullscreen(win)) {
    const exit = d.exitFullscreen || d.webkitExitFullscreen;
    if (typeof exit !== 'function') return false;
    try { exit.call(d); } catch { return false; }
    return true;
  }
  const el = d.documentElement || d.body;
  if (!el) return false;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (typeof request !== 'function') return false;
  try {
    // navigationUI 让浏览器全屏时隐藏地址栏；嵌入式宿主忽略这个参数
    const r = request.call(el, { navigationUI: 'hide' });
    if (r && typeof r.catch === 'function') r.catch(() => {});   // 被策略拒绝时不要抛未捕获异常
  } catch { return false; }
  return true;
}

/**
 * 装 F11 快捷键。已装过就不重复装（返回上一次的卸载函数）。
 * @param {any} [win]
 * @param {{ onlyEmbedded?: boolean }} [opts]
 * @returns {() => void} 卸载
 */
export function installFullscreenHotkey(win = globalThis, { onlyEmbedded = true } = {}) {
  if (!win || !win.document || typeof win.addEventListener !== 'function') return () => {};
  const flag = '__spFullscreenHotkey';
  if (typeof win[flag] === 'function') return win[flag];

  const onKeyDown = (e) => {
    if (!e) return;
    const isF11 = e.key === 'F11' || e.keyCode === 122 || e.which === 122;
    if (!isF11) return;
    if (onlyEmbedded && !isEmbedded(win)) return;   // 浏览器里交给浏览器自己
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (e.repeat) return;                            // 长按不反复切
    toggleFullscreen(win);
  };

  win.addEventListener('keydown', onKeyDown, true);
  const uninstall = () => { win.removeEventListener('keydown', onKeyDown, true); win[flag] = null; };
  win[flag] = uninstall;
  return uninstall;
}
