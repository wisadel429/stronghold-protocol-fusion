// public/ui-compat/js/screens/stats.js — 宿主 stats.js + 分享包要的 TitleHexagon（称号六边形）。
export * from '/js/screens/stats.js';
import { html } from '/js/ui/components.js';

/**
 * 称号六边形（成就面板右侧）。本仓 stats.js 里有一个同名**私有**组件（不导出），
 * 这里按同样 props 做一个轻量版：只列称号名与次数，不画雷达与贴图。
 * @param {{ titles?: any[], manifest?: any }} props
 * @returns {any} 无称号时 null
 */
export function TitleHexagon({ titles = null } = {}) {
  const rows = Array.isArray(titles) ? titles.filter(Boolean) : [];
  if (!rows.length) return null;
  return html`<ul class="ach-hex">
    ${rows.slice(0, 6).map((x, i) => html`<li key=${i} class="ach-hex__row">
      <span class="ach-hex__name">${x?.name || x?.title || ''}</span>
      <b class="ach-hex__count num">${x?.count ?? x?.value ?? 0}</b>
    </li>`)}
  </ul>`;
}
