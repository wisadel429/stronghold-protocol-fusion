// public/ui-compat/js/ui/uiThemePicker.js — 分享包的主题选择器接口 → 本仓局外选择页。
import { html } from '/js/ui/components.js';
import { UiThemeButton } from '/js/ui/uiThemeSwitch.js';

/**
 * 主题大厅里那颗按钮：直接复用本仓的 UiThemeButton（同一份选择、同一个选择页）。
 * @param {{ class?: string }} props
 */
export function UIThemeButton({ class: cls } = {}) {
  return html`<${UiThemeButton} class=${cls || 'ui-theme-picker'} />`;
}

/** 有些屏只调用函数：打开选择页。 */
export function openUiThemePicker() { location.href = '/ui-theme.html'; }
