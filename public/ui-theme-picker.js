/* public/ui-theme-picker.js — 局外的「界面主题」选择页（独立页面，不依赖任何会被主题替换的模块）。
 *
 * 业主 2026-11-28：**网页原版 UI 已移除**（入口页、旧的界面代码都删了），这里只剩两套主题：
 *   initial  = 分享包的「卫戍协议终端」
 *   closure  = 分享包的「“全能的”可露希尔」（默认）
 * 选择写进 localStorage 的 sp.ui-theme.v1（与分享包同键）**和 cookie sp_ui_theme**，
 * 后者是给服务端用的：`/` 是 302，得在浏览器解析任何模块之前就知道该进哪套（见 server/http/routes.js）。
 * 入口之所以是两个静态 HTML：主题靠 import map + 整套 CSS 替换，必须在模块解析前定下来。
 */
(function () {
  'use strict';

  var KEY = 'sp.ui-theme.v1';
  var COOKIE = 'sp_ui_theme';

  var THEMES = [
    {
      id: 'initial',
      name: '卫戍协议终端',
      micro: 'TERMINAL // INITIAL',
      desc: '分享包里的原界面：盟约栏 80% 居中、禁用盟约与干员展示、地图预览都换了排版。',
      entry: '/ui-theme-initial.html',
      thumb: '/ui-art/selector/thumbnail_ac_n_initial.png',
      accent: '#c8ff6a',
    },
    {
      id: 'closure',
      name: '“全能的”可露希尔',
      micro: 'TERMINAL // CLOSURE',
      desc: '可露希尔主题：终末地风格的战斗动效、Spine、结算与商店界面，含已接好的配音。',
      entry: '/ui-theme-closure.html',
      thumb: '/ui-art/selector/thumbnail_ac_s_closur.png',
      accent: '#ff5454',
    },
    {
      id: 'ursus',
      name: '乌萨斯齐心团',
      micro: 'TERMINAL // URSUS',
      desc: '分享包里只有锁定占位卡，作者尚未开放。',
      entry: null,
      thumb: '/ui-art/selector/thumbnail_ac_n_iron.png',
      accent: '#8a8f9c',
      locked: true,
    },
  ];

  function readSaved() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'initial' || v === 'closure' ? v : 'closure';   // 没选过 / 旧值（含已移除的 'web'）→ 默认 closure
    } catch (e) { return 'closure'; }
  }

  function save(id) {
    try { localStorage.setItem(KEY, id); } catch (e) { /* 隐私模式：继续写 cookie */ }
    try {
      // 给服务端用：`/` 要 302 到对应主题入口。1 年、全站、Lax。
      document.cookie = COOKIE + '=' + encodeURIComponent(id) + '; Path=/; Max-Age=31536000; SameSite=Lax';
      return true;
    } catch (e) { return false; }
  }

  /** 当前实际在哪一套界面：只认记住的那套（没有「原版」这一档了）。 */
  function currentId() {
    return readSaved();
  }

  function card(theme, active) {
    var el = document.createElement('div');
    el.className = 'uip-card' + (active ? ' is-active' : '') + (theme.locked ? ' is-locked' : '');
    el.setAttribute('role', 'listitem');
    el.style.setProperty('--accent', theme.accent);

    var art = document.createElement('div');
    art.className = 'uip-card__art';
    if (theme.thumb) {
      var img = document.createElement('img');
      img.src = theme.thumb;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      art.appendChild(img);
    } else {
      art.classList.add('uip-card__art--plain');
      art.textContent = 'PROTOCOL';
    }
    el.appendChild(art);

    var body = document.createElement('div');
    body.className = 'uip-card__body';

    var micro = document.createElement('p');
    micro.className = 'uip-card__micro';
    micro.textContent = theme.micro;
    body.appendChild(micro);

    var h = document.createElement('h2');
    h.className = 'uip-card__name';
    h.textContent = theme.name;
    body.appendChild(h);

    var p = document.createElement('p');
    p.className = 'uip-card__desc';
    p.textContent = theme.desc;
    body.appendChild(p);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'uip-card__btn';
    if (theme.locked) {
      btn.disabled = true;
      btn.textContent = '未开放';
    } else if (active) {
      btn.disabled = true;
      btn.textContent = '当前使用中';
    } else {
      btn.textContent = '使用这套界面';
      btn.addEventListener('click', function () { choose(theme); });
    }
    body.appendChild(btn);
    el.appendChild(body);
    return el;
  }

  function note(text, kind) {
    var el = document.getElementById('uip-note');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'uip__note' + (kind ? ' is-' + kind : '');
  }

  function choose(theme) {
    if (!theme || !theme.entry) return;
    note('正在切换到「' + theme.name + '」…', 'ok');
    save(theme.id);
    location.href = theme.entry;
  }

  function render() {
    var grid = document.getElementById('uip-grid');
    if (!grid) return;
    var active = currentId();
    grid.textContent = '';
    for (var i = 0; i < THEMES.length; i++) grid.appendChild(card(THEMES[i], THEMES[i].id === active));
  }

  render();
})();
