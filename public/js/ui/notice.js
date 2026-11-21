// 全服公告条 (server announcement bar): the admin's 滚动公告 (server/admin.html → POST /admin/api/notice) arrives as
// the S2C frame `notice` (server/admin-live.js) and every connected page shows it as a strip at the very top — title,
// lobby, room and mid-match alike, because it is the server's message to whoever is connected.
//
// Layout: while a notice is on screen the app root carries `has-notice`, which reserves exactly the bar's height as
// padding-top — every screen is `position: absolute; inset: 0` against that box, so no screen has to know about the bar
// (theme.css `.app-root` / `.screen`). The 闪断预警条 sits right under it (css/flashwarn.css).
//
// The text scrolls with one transform animation (no per-frame JS, no layout reads): the duration follows the text
// length, a hover pauses it, and `prefers-reduced-motion` stops it. The server clears the notice at its TTL and
// rebroadcasts an empty frame; a page that connects while one is up gets the current one on connect.

import { html, Icon } from './components.js';
import { useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';

/** 公告条在 `.app-root` 上占用的高度（css/notice.css 的 --notice-h 也是这个值）。 */
export const NOTICE_H = 34;

/** Seconds the text takes to cross the bar: long notices scroll slower so they stay readable. */
export const scrollSeconds = (text) => Math.max(14, Math.min(60, Math.round(String(text).length * 0.42)));

/** The scrolling announcement, or nothing when the server has none (store slice `notice`: `{ text, at, until }`). */
export function NoticeBar() {
  const notice = useStore((s) => s.notice, Object.is);
  const text = notice && typeof notice.text === 'string' ? notice.text : '';
  if (!text) return null;
  return html`<div class="notice" role="status" aria-live="polite" title=${text} data-testid="notice-bar">
    <span class="notice__tag"><${Icon} name="info" />${t('公告')}</span>
    <div class="notice__track">
      <span class="notice__text" key=${`${notice.at || ''}:${text}`}
        style=${`--notice-sec:${scrollSeconds(text)}s`}>${text}</span>
    </div>
  </div>`;
}

/** Does the page have a notice bar right now (what `has-notice` on `.app-root` means)? */
export const hasNotice = (notice) => !!(notice && typeof notice.text === 'string' && notice.text);
