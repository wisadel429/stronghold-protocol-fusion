// public/js/ui/uiThemeSwitch.js — 「界面主题」的局外入口（标题页右上角那颗按钮）。
//
// 与「皮肤 / SKINS」系统完全无关：这里切的是**整套 UI**（本仓原版 / 分享包的「卫戍协议终端」/「可露希尔」），
// 切换靠跳到各自的入口 HTML（见 public/ui-theme-initial.html、public/ui-theme-closure.html）——
// 主题是 import map + 整套 CSS 的替换，没法在同一份文档里热切，所以只做「记住选择 + 跳转」。
//
// 选择的键与分享包一致：localStorage 的 `sp.ui-theme.v1`（'web' = 网页原版，'initial' / 'closure' = 两套主题）。
// 真正兑现选择的是 public/ui-theme-gate.js（在 index.html 里先于主模块跑）与 public/ui-theme.html（选择页）。
import { html, Button } from './components.js';
import { t } from '../../../shared/i18n.js';

/** localStorage 键：与分享包同键，互换主题包时选择不会丢。 */
export const UI_THEME_KEY = 'sp.ui-theme.v1';

/** 三套可用界面的入口（'web' 就是本仓原版，保持原 index.html）。 */
export const UI_THEME_ENTRIES = Object.freeze({ web: '/', initial: '/ui-theme-initial.html', closure: '/ui-theme-closure.html' });

/** 当前这一页是哪个界面：先看主题入口写在 <meta name="sp-ui-theme"> 的标记，再退回 localStorage。 */
export function currentUiTheme() {
  const el = typeof document !== 'undefined' ? document.querySelector('meta[name="sp-ui-theme"]') : null;
  const marked = el && el.getAttribute('content');
  if (marked && Object.prototype.hasOwnProperty.call(UI_THEME_ENTRIES, marked)) return marked;
  let saved = null;
  try { saved = localStorage.getItem(UI_THEME_KEY); } catch { /* 隐私模式：当作没选过 */ }
  if (typeof document !== 'undefined' && document.documentElement.dataset.uiTheme) return document.documentElement.dataset.uiTheme;
  return saved && Object.prototype.hasOwnProperty.call(UI_THEME_ENTRIES, saved) ? saved : 'web';
}

/** 打开局外的界面选择页（独立页面，不依赖被主题替换掉的任何模块）。 */
export function openUiThemePicker() {
  location.href = '/ui-theme.html';
}

/**
 * 标题页右上角的入口。`class` 交给调用方定位（.title-corner__tools 里和「统计」「语言」一排）。
 * @param {{ class?: string }} props
 */
export function UiThemeButton({ class: cls } = {}) {
  const theme = currentUiTheme();
  const label = theme === 'web' ? t('界面') : (theme === 'closure' ? t('界面 · 可露希尔') : t('界面 · 终端'));
  return html`<${Button} variant="ghost" size="sm" class=${`title-ui-theme${cls ? ' ' + cls : ''}`}
    onClick=${openUiThemePicker} title=${t('切换整套界面（网页原版 / 卫戍协议终端 / 可露希尔）')}
    data-testid="title-ui-theme">${label}<//>`;
}
