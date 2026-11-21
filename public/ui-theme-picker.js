/* public/ui-theme-picker.js — 局外的「界面主题」选择页（独立页面，不依赖任何会被主题替换的模块）。
 *
 * 三个可选界面 + 一张未开放的锁定卡：
 *   web      = 网页原版（本服务器当前这套界面，保持原样）
 *   initial  = 分享包的「卫戍协议终端」
 *   closure  = 分享包的「“全能的”可露希尔」
 * 选择写进 localStorage 的 sp.ui-theme.v1（与分享包同键），然后跳到对应入口。
 * 入口之所以是三个 HTML：主题靠 import map + 整套 CSS 替换，必须在模块解析前定下来。
 */
(function () {
  'use strict';

  var KEY = 'sp.ui-theme.v1';

  var THEMES = [
    {
      id: 'web',
      name: '网页原版',
      micro: 'ORIGINAL WEB',
      desc: '本服务器当前这套界面，一个像素都不改。想回到原来的样子就选它。',
      entry: '/',
      thumb: null,
      accent: '#17d9a0',
    },
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
    try { return localStorage.getItem(KEY) || 'web'; } catch (e) { return 'web'; }
  }

  function save(id) {
    try { localStorage.setItem(KEY, id); return true; } catch (e) { return false; }
  }

  /** 当前实际在哪一套界面：主题入口会写 <meta name="sp-ui-theme">，原版没有这个标记。 */
  function currentId() {
    var saved = readSaved();
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === saved && THEMES[i].entry) return saved;
    return 'web';
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
    if (!save(theme.id)) {
      note('这台浏览器不允许写入本地存储（隐私模式？），选择不会被记住，但本次仍会切换。', 'warn');
    } else {
      note('正在切换到「' + theme.name + '」…', 'ok');
    }
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
