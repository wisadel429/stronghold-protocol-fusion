/* public/ui-theme-gate.js — 「界面主题」的记忆入口（普通脚本，先于主模块执行）。
 *
 * 做两件事（都只在「用户自己选过主题」的前提下才动作，没选过 / 选网页原版的访客完全不受影响）：
 *
 *   1) 网页原版入口 `/`：如果这台浏览器上次在 /ui-theme.html 里明确选了 initial / closure，
 *      就进对应主题入口（主界面因此是分享包那一套）；选的是「网页原版」、没选过、或存了脏值 —— 什么都不做。
 *   2) 主题入口（/ui-theme-initial.html、/ui-theme-closure.html）：
 *      如果是刚被 (1) 自动带进来的，给一条**一次性**的出口：「留在网页原版」。
 *      点了就把 sp.ui-theme.v1 记成 'web' 并回 `/`，**以后不再自动跳**；不点也会自己收起。
 *      用户自己从选择页点进来 / 刷新 / 直接打开主题入口时不会出现这条提示。
 *
 * 为什么需要它：主题是 import map + 整套 CSS 的替换，必须在任何一个 module 解析之前决定；
 * 而本仓的 CSP 是 script-src 'self' + 内联 import map 的 hash，动态注入 import map 会被拦。
 * 所以每条主题各有静态入口 HTML，这里只负责「记住上次选了哪条」+ 给一条退出通道。
 *
 * 边界：只认站点根路径（'/' 或 '/index.html'）；深链（比如 /room/ABCD）不动，免得把分享链接带跑偏。
 * 任何异常都静默 —— 门控坏了也必须能进原版界面。
 */
(function () {
  'use strict';

  var THEME_KEY = 'sp.ui-theme.v1';          // 与选择页 / 分享包同一个键
  var FROM_HOME = 'sp.ui-theme.from-home';   // sessionStorage：一次性「是被自动带进来的」标记
  var THEMES = {
    initial: { entry: '/ui-theme-initial.html', label: '卫戍协议终端' },
    closure: { entry: '/ui-theme-closure.html', label: '“全能的”可露希尔' },
  };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 隐私模式：跳过 */ } }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) { /* 同上 */ } }

  var path = location.pathname;

  // ---- 1) 网页原版入口：默认「可露希尔」，明确选过原版才留在原版 ----------------
  // 业主 2026-11-15：默认界面改为「"全能的"可露希尔」（closure）。
  //   存了 initial / closure → 进对应主题；
  //   存了 'web'（用户明确选了网页原版）→ 尊重选择，不跳；
  //   没选过 / 脏值 → 默认进 closure。
  if (path === '/' || path === '/index.html') {
    try {
      var saved = lsGet(THEME_KEY);
      if (saved === 'web') return;                       // 明确选了网页原版：不跳
      var target = THEMES[saved] ? saved : 'closure';    // 没选过 / 脏值 → 默认可露希尔
      if (!THEMES[target]) return;
      ssSet(FROM_HOME, (saved ? '' : 'default:') + target);
      location.replace(THEMES[target].entry + (location.search || '') + (location.hash || ''));
    } catch (e) { /* 不拦任何东西 */ }
    return;
  }

  // ---- 2) 主题入口：自动带进来的一次性出口「留在网页原版」-------------------
  var theme = document.documentElement.getAttribute('data-ui-theme');
  if (!theme || !THEMES[theme]) return;
  var from = ssGet(FROM_HOME);
  if (from !== theme && from !== 'default:' + theme) return;  // 自己点进来 / 刷新 / 直接打开 → 不提示
  var isDefault = from === 'default:' + theme;
  ssDel(FROM_HOME);

  function showExit() {
    if (!document.body || document.querySelector('.sp-theme-gate-exit')) return;
    var box = document.createElement('div');
    box.className = 'sp-theme-gate-exit';
    box.setAttribute('role', 'status');

    var text = document.createElement('span');
    text.className = 'sp-theme-gate-exit__text';
    text.textContent = isDefault
      ? '默认界面：「' + THEMES[theme].label + '」'
      : '已按上次的选择进入「' + THEMES[theme].label + '」界面';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sp-theme-gate-exit__btn';
    btn.textContent = isDefault ? '换成网页原版' : '留在网页原版';
    btn.addEventListener('click', function () {
      lsSet(THEME_KEY, 'web');                // 记住：以后不再自动跳
      location.replace('/');
    });

    box.appendChild(text);
    box.appendChild(btn);
    document.body.appendChild(box);
    // 不点也自己收起，别一直压着界面
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showExit, { once: true });
  else showExit();
})();
