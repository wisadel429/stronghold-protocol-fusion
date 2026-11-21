// 卫戍协议终端主题（2026-11 主题包）: which variant skin the match UI wears, and where its official sprites are.
// A theme build sets <html data-ac-terminal-theme="…"> (js/ui/acTerminalTheme.js, imported from index.html); the plain
// build has no attribute and every component keeps its default look. The skins are the event's own
// [uc]ac_s_closur (「全能的」可露希尔) and [uc]ac_n_iron (乌萨斯齐心团) packs, copied 1:1 into img/official/hub/ac/theme/.
// Components read the id when they mount (a theme never changes during a match).

export const AC_THEME = Object.freeze({ CLOSURE: 'ac_s_closur', URSUS: 'ac_n_iron' });

const DIR = { ac_s_closur: 'almighty_closure', ac_n_iron: 'ursus_qixintuan' };
const BASE = new URL('/ui-art/img/official/hub/ac/theme/', location.origin).href;

/** The active theme id ('ac_s_closur' | 'ac_n_iron'), or '' for the default look. */
export function acThemeId() {
  if (typeof document === 'undefined') return '';
  const id = document.documentElement.getAttribute('data-ac-terminal-theme') || '';
  return DIR[id] ? id : '';
}

/** URL of one of the theme's sprites (`name` without .png), or '' when no theme is active. */
export function acThemeArt(name, id = acThemeId()) {
  return DIR[id] ? `${BASE}${DIR[id]}/${name}.png` : '';
}
