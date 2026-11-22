// 启动页逻辑：只通过 WebView2 的 postMessage 和宿主通信；宿主负责真正启动 node / 跳转游戏。
(function () {
  const $ = (id) => document.getElementById(id);
  const bridge = window.chrome && window.chrome.webview ? window.chrome.webview : null;
  const post = (msg) => { try { bridge && bridge.postMessage(msg); } catch (e) { console.warn(e); } };

  const DEFAULT_SERVER = '';

  // ---------- 服务器地址规范化 ----------
  // 业主 2026-11-21 最终口径：「手动输入的服务器不要被补 :3000」。
  //
  // 宿主 Stronghold.exe 的实测规则（见 launcher.log 的 enter server / nav 记录）：
  //   · 只给**裸域名**（无协议头、无端口）→ 它自己走 https://域名/，不会塞端口   ✅
  //   · 给了协议头或端口 → 它按「游戏服地址」处理，强制补成 http://主机:3000     ❌（mon3tr.fun:80 → http://mon3tr.fun:3000）
  // 所以这里做的是：**去掉协议头**，保留 主机[:端口]，其余一概不加。
  //   mon3tr.fun            → mon3tr.fun        → 宿主开 https://mon3tr.fun/
  //   https://mon3tr.fun    → mon3tr.fun        → 同上
  //   8.134.50.56           → 8.134.50.56       → 宿主开 http://8.134.50.56:3000（游戏服默认端口）
  //   8.134.50.56:3000      → 8.134.50.56:3000  → 原样
  function normalizeAddr(input) {
    let v = String(input || '').replace(/\s+/g, '');
    if (!v) return '';
    v = v.replace(/^[<"'(（【]+/, '').replace(/[>"')）】]+$/, '');
    // 去掉协议头（宿主看到协议头会改端口）
    let rest = v.replace(/^(wss?|https?):\/\//i, '');
    rest = rest.replace(/^\/+/, '').replace(/\/.*$/, '');
    const at = rest.lastIndexOf('@');
    if (at >= 0) rest = rest.slice(at + 1);
    return rest;
  }

  const state = { busy: false, server: normalizeAddr(localStorage.getItem('sp.launcher.server') || DEFAULT_SERVER), list: localStorage.getItem('sp.launcher.list') || '', listBackup: '' };
  let tick = 0, tickTimer = 0, tipTimer = 0;
  const TIPS = [
    '首次启动需要建立资源索引，请稍候',
    '正在把干员、皮肤和特效读进内存',
    '启动完成后这个窗口会直接进入游戏',
    '卡住超过一分钟可以点“返回启动页”重试',
  ];

  function setAddrText() {
    $('addr').value = state.server;
    $('remoteAddr').textContent = '服务器列表（默认）';
    $('listStatus').textContent = '默认使用服务器列表，点「服务器游玩」打开';
  }

  function setAddrStatus(kind, text) {
    $('addrDot').className = 'dot dot--' + kind;
    $('addrStatus').textContent = text;
  }

  // ---------- 启动中页面 ----------
  function showLoading(title) {
    document.body.classList.add('is-loading');
    $('loading').classList.remove('is-error');
    $('loadingBack').hidden = true;
    $('loadingBar').style.width = '4%';
    $('loadingTitle').textContent = title || '正在启动服务器';
    $('loadingStep').textContent = title === '正在启动服务器' || title === '正在部署公开服务器'
      ? '正在检查本地服务器…'
      : '正在检查可用列表…';
    $('loadingTime').textContent = '0.0s';
    tick = 0;
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      tick += 0.1;
      $('loadingTime').textContent = tick.toFixed(1) + 's';
    }, 100);
    let i = 0;
    $('loadingTip').textContent = title === '正在启动服务器' || title === '正在部署公开服务器'
      ? TIPS[0]
      : '正在从列表里找到可用节点';
    clearInterval(tipTimer);
    tipTimer = setInterval(() => { i = (i + 1) % TIPS.length; $('loadingTip').textContent = TIPS[i]; }, 5000);
  }

  function hideLoading() {
    document.body.classList.remove('is-loading');
    clearInterval(tickTimer); clearInterval(tipTimer);
  }

  function setStep(text, pct) {
    if (text) $('loadingStep').textContent = text;
    if (typeof pct === 'number') $('loadingBar').style.width = Math.max(4, Math.min(100, pct)) + '%';
  }

  function failLoading(text) {
    $('loading').classList.add('is-error');
    setStep(text || '启动失败', 100);
    $('loadingBack').hidden = false;
    clearInterval(tickTimer); clearInterval(tipTimer);
    state.busy = false;
  }

  // ---------- 交互 ----------
  // 业主 2026-11-22：开始前若登记了两个及以上版本 → 先弹窗选版本；只有一个就直接开
  function startLocalFlow() {
    if (state.busy) return;
    if (versionState.items.length >= 2) {
      pkOpen('version', (id) => {
        state.busy = true;
        showLoading('正在启动服务器');
        post({ t: 'version-enter', id });
      });
      return;
    }
    state.busy = true;
    showLoading('正在启动服务器');
    post({ t: 'start-local' });
  }

  function startPublicFlow() {
    if (state.busy) return;
    if (versionState.items.length >= 2) {
      pkOpen('version', (id) => {
        state.busy = true;
        showLoading('正在部署公开服务器');
        post({ t: 'version-active', id });
        post({ t: 'start-public' });
      });
      return;
    }
    state.busy = true;
    showLoading('正在部署公开服务器');
    post({ t: 'start-public' });
  }

  $('localCard').addEventListener('click', (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest('[data-verpick]')) return;   // 版本切换自己处理
    startLocalFlow();
  });

  $('publicCard').addEventListener('click', (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest('[data-verpick]')) return;
    startPublicFlow();
  });

  // 卡片上的「版本：xxx · 切换」（改当前版本，不启动）
  for (const el of document.querySelectorAll('[data-verpick]')) {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      pkOpen('version', (id) => post({ t: 'version-active', id }));
    });
  }

  $('loadingBack').addEventListener('click', () => {
    hideLoading();
    state.busy = false;
    setAddrStatus('bad', '已取消等待；服务器可能仍在后台启动');
  });

  function openServerList() {
    if (state.busy) return;
    state.busy = true;
    showLoading('正在连接服务器列表');
    post({ t: 'open-list' });
  }
  $('remoteGo').addEventListener('click', openServerList);
  $('onlineCard').addEventListener('click', openServerList);
  $('listPanel').addEventListener('click', openServerList);

  /**
   * 把「主机[:端口]」拼成完整 URL（页面自己跳转用）。
   * 业主 2026-11-21：宿主对手动地址会强制 http://主机:3000，所以带端口/域名的目标改由页面自己导航。
   */
  function fullUrlOf(addr) {
    const s = String(addr || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s.replace(/\/?$/, '/');
    // 有显式端口：保持 http（游戏服通常是明文 3000）
    if (/:\d{1,5}$/.test(s)) return 'http://' + s + '/';
    // 裸域名 / IP：域名走 https，IP 走 http
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(s);
    return (isIp ? 'http://' : 'https://') + s + '/';
  }

  function connectAddr() {
    const typed = ($('addr').value || '').trim();
    if (!typed) { setAddrStatus('bad', '先填写服务器地址'); $('addr').focus(); return; }
    const addr = normalizeAddr(typed) || typed;
    if (addr !== typed) $('addr').value = addr;
    state.server = addr;
    localStorage.setItem('sp.launcher.server', addr);
    setAddrText();
    state.busy = true;
    showLoading('正在进入服务器');
    setAddrStatus('wait', '正在连接 ' + addr + ' …');
    $('remoteState').textContent = '状态：连接中…';

    // 业主 2026-11-21：宿主对手动地址会强制拼 :3000（https://mon3tr.fun → http://mon3tr.fun:3000），
    // 所以这里**先由页面自己跳转**（WebView2 会原样打开 https/http 地址）；
    // 若宿主拦截了这次导航（页面还在、1.2 秒后没走），再回退到宿主原来的 start-remote。
    const target = fullUrlOf(addr);
    let navigated = false;
    try {
      location.href = target;
      navigated = true;
    } catch { navigated = false; }
    if (navigated) {
      setTimeout(() => {
        // 还在这儿 = 宿主取消了导航，走回退
        setAddrStatus('wait', '页面跳转被拦截，改用宿主连接 ' + addr + ' …');
        post({ t: 'start-remote', addr });
      }, 1200);
      return;
    }
    post({ t: 'start-remote', addr });
  }
  $('connectAddr').addEventListener('click', connectAddr);

  $('saveAddr').addEventListener('click', () => {
    const typed = ($('addr').value || '').trim();
    state.server = typed ? (normalizeAddr(typed) || typed) : '';
    localStorage.setItem('sp.launcher.server', state.server);
    setAddrText();
    setAddrStatus(state.server ? 'ok' : 'off', state.server ? '已保存：' + state.server : '已清空');
    post({ t: 'save-server', addr: state.server });
  });

  $('resetAddr').addEventListener('click', () => {
    state.server = DEFAULT_SERVER;
    localStorage.removeItem('sp.launcher.server');
    setAddrText();
    setAddrStatus('off', '已恢复默认（待配置）');
    post({ t: 'save-server', addr: DEFAULT_SERVER });
  });

  $('quit').addEventListener('click', () => post({ t: 'quit' }));

  // ---------- 导入热更包 ----------
  // 宿主 Stronghold.exe 没有导入消息，所以这里走本地服务器的 /api/update/import：
  // 页面把 zip 原样 POST 过去，服务器校验路径后解压到安装目录，重启启动器时生效。
  function localBase() {
    const q = new URLSearchParams(location.search).get('port');
    const saved = localStorage.getItem('sp.launcher.port');
    return 'http://127.0.0.1:' + (q || saved || '3000');
  }
  function setUpdateStatus(kind, text) {
    $('updateDot').className = 'dot dot--' + kind;
    $('updateStatus').textContent = text;
  }
  const updateBtn = $('importUpdate');
  const updateInput = $('updateFile');
  if (updateBtn && updateInput) {
    updateBtn.addEventListener('click', () => updateInput.click());
    updateInput.addEventListener('change', async () => {
      const file = updateInput.files && updateInput.files[0];
      if (!file) return;
      $('updateFileText').textContent = file.name + ' (' + (file.size / 1024 / 1024).toFixed(1) + ' MB)';
      updateBtn.disabled = true;
      setUpdateStatus('wait', '正在导入 ' + file.name + ' …');
      try {
        const res = await fetch(localBase() + '/api/update/import', {
          method: 'POST',
          headers: { 'content-type': 'text/plain;charset=UTF-8' },
          body: file,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.ok !== true) {
          const why = (data && (data.message || data.error)) || ('HTTP ' + res.status);
          setUpdateStatus('bad', '导入失败：' + why);
        } else {
          const tail = data.kind === 'update' ? '官方更新包' : '文件覆盖包';
          setUpdateStatus('ok', '已导入 ' + data.files + ' 个文件（' + tail + '）。' + (data.message || '请重启启动器生效'));
          $('updateFileText').textContent = '导入完成，重启启动器生效';
        }
      } catch (e) {
        setUpdateStatus('bad', '连不上本地服务器：先点「本地游戏」把服务器启动起来再导入');
      } finally {
        updateBtn.disabled = false;
        updateInput.value = '';
      }
    });
  }

  // ---------- 问题反馈 ----------
  // 玩家只要写一句「什么情况下出的问题」，诊断信息自动带上，一键复制就能贴到群里。
  let feedbackUrl = localStorage.getItem('sp.launcher.feedback') || '';
  function setFbStatus(kind, text) {
    $('fbDot').className = 'dot dot--' + kind;
    $('fbStatus').textContent = text;
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  async function collectDiag() {
    let version = '未知'; let build = '未知';
    try {
      const r = await fetch(localBase() + '/healthz', { cache: 'no-store' });
      if (r.ok) {
        const b = await r.json().catch(() => ({}));
        version = b.version || (b.app ? b.app : version);
        build = b.build || build;
      }
    } catch { /* 本地服务器没起来也照常反馈 */ }
    const d = new Date();
    const when = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const server = (($('addr') && $('addr').value) || state.server || '').trim() || '本机';
    return [
      `版本: ${version}  (build ${build})`,
      `服务器: ${server}`,
      `时间: ${when}`,
      `系统: ${navigator.userAgent}`,
      `分辨率: ${screen.width}x${screen.height} @${window.devicePixelRatio || 1}`,
      `语言: ${navigator.language}`,
    ].join('\n');
  }
  async function composeFeedback(withDiag) {
    const what = ($('fbText').value || '').trim();
    const head = what ? `【问题描述】\n${what}` : '【问题描述】\n（没写描述，只有诊断信息）';
    if (!withDiag) return head;
    return `${head}\n\n【诊断信息】\n${await collectDiag()}`;
  }
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext !== false) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* 落到下面的兜底 */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
  const fbCopy = $('fbCopy');
  if (fbCopy) {
    fbCopy.onclick = async () => {
      const text = await composeFeedback(true);
      const ok = await copyText(text);
      if (ok) setFbStatus('ok', `已复制（${text.length} 字），直接粘到反馈群即可`);
      else {
        $('fbText').value = text;
        setFbStatus('bad', '自动复制被拦截了：内容已填到上面的输入框，手动全选复制');
      }
    };
    $('fbDiag').onclick = async () => {
      const text = await composeFeedback(false);
      const ok = await copyText(text);
      setFbStatus(ok ? 'ok' : 'bad', ok ? '已复制问题描述' : '复制失败，请手动选择文本');
    };
    $('fbOpen').onclick = async () => {
      const text = ($('fbText').value || '').trim();
      if (!text) { setFbStatus('bad', '先写一句问题描述再提交'); $('fbText').focus(); return; }
      const diag = await collectDiag();
      // 提交到「他正在连的那台服务器」，管理员在后台就能看到；没填地址就交本机
      const raw = (state.server || '').trim();
      const base = raw ? (/^https?:\/\//i.test(raw) ? raw : 'http://' + raw) : localBase();
      setFbStatus('wait', '正在提交到 ' + base + ' …');
      try {
        const r = await fetch(base.replace(/\/+$/, '') + '/api/feedback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, diag, name: localStorage.getItem('sp.launcher.nick') || '' }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || j.ok !== true) throw new Error((j && (j.message || j.error)) || ('HTTP ' + r.status));
        setFbStatus('ok', `已提交（编号 ${j.id}），管理员在后台「问题反馈」里能看到`);
        $('fbText').value = '';
      } catch (e) {
        setFbStatus('bad', '提交失败：' + (e && e.message || e) + '；可以点「复制反馈内容」发到群里');
      }
    };
    if (!feedbackUrl) $('fbStatus').textContent = '提交后会直接进服务器后台；也可以「复制反馈内容」发到群里';
  }

  function onHostMessage(data) {
    if (!data || typeof data !== 'object') return;
    if (data.t === 'boot') {
      setStep(data.text, data.pct);
    } else if (data.t === 'status') {
      const text = data.text || '';
      if (text) $('loadingStep').textContent = text;
      if (data.kind === 'bad') failLoading(text);
    } else if (data.t === 'server-started') {
      setStep('服务器已就绪，正在进入游戏…', 100);
      clearInterval(tickTimer); clearInterval(tipTimer);
      $('loadingTime').textContent = tick.toFixed(1) + 's';
      $('localCard').classList.add('is-on');
      $('localState').textContent = '状态：已启动';
      if (data.lan) $('lanUrls').textContent = data.lan;
    } else if (data.t === 'public-started') {
      // 服务器就绪：后台页面已经在同一窗口打开了（不进入游戏画面）
      state.busy = false;
      hideLoading();
      $('publicCard').classList.add('is-on');
      $('publicState').textContent = data.ok === false ? '状态：已启动（旧进程没有后台）' : '状态：已部署';
      $('localCard').classList.add('is-on');
      $('localState').textContent = '状态：已启动';
      if (data.lan) $('lanUrls').textContent = data.lan;
      if (data.warn) setAddrStatus('bad', data.warn);
      else setAddrStatus('ok', '后台已打开：' + (data.url || ''));
    } else if (data.t === 'remote-started') {
      $('remoteState').textContent = '状态：已连接 ' + data.addr;
      setAddrStatus('ok', '已连接 ' + data.addr);
    } else if (data.t === 'error') {
      failLoading(data.text || '出错');
    } else if (data.t === 'art') {
      const pct = data.files ? Math.min(100, Math.round((data.checked / data.files) * 100)) : 100;
      $('artBar').style.width = pct + '%';
      $('artText').textContent = pct >= 100 ? '本地资源已就绪' : '正在检查本地资源…';
      $('artCount').textContent = data.files ? (data.checked + ' / ' + data.files + ' 文件') : '';
    } else if (data.t === 'update-available') {
      onUpdateAvailable(data);
    } else if (data.t === 'update-none') {
      showUpdateBar('已经是最新版本', false);
      setTimeout(hideUpdateBar, 3000);
    } else if (data.t === 'update-status') {
      onUpdateStatus(data);
    } else if (data.t === 'update-done') {
      onUpdateDone(data);
    } else if (data.t === 'versions') {
      renderVersions(data);
    } else if (data.t === 'fs') {
      pkRenderFs(data);
    } else if (data.t === 'fs-detail') {
      pkRenderDetail(data);
    } else if (data.t === 'version-status') {
      const msg = $('versionMsg');
      if (msg) {
        msg.textContent = data.text || '';
        msg.style.color = data.kind === 'bad' ? '#e05a4f' : '#7bf0b0';
      }
      post({ t: 'versions' });   // 状态变了就刷新一次列表（运行点/端口）
    } else if (data.t === 'announcement') {
      // 宿主启动时就取好了公告，页面一收到就弹（业主 2026-11-21「启动软件就弹」）
      onHostAnnouncement(data.body || '');
    } else if (data.t === 'config') {
      if (data.server) { state.server = normalizeAddr(data.server) || data.server; localStorage.setItem('sp.launcher.server', state.server); }
      if (data.list) { state.list = data.list; localStorage.setItem('sp.launcher.list', data.list); }
      if (data.listBackup) state.listBackup = data.listBackup;
      setAddrText();
    }
  }

  if (bridge) bridge.addEventListener('message', (e) => onHostMessage(e.data));
  else setAddrStatus('off', '未在启动器窗口中运行');

  const stopped = new URLSearchParams(location.search).get('stopped');
  if (stopped) {
    $('localState').textContent = '状态：本地服务器已停止';
    setAddrStatus('bad', stopped);
    $('localCard').classList.remove('is-on');
  }

  // ---------- 邀请粘贴（业主 2026-11-21）----------
  // 玩家从群里复制的邀请通常是一整段：「https://mon3tr.fun/?room=9680 某某邀请你加入…【绝境模拟】」。
  // 这里只取网址里的 room= 房间号，存进 localStorage('sp.launcher.room')；
  // 点「本地游戏 / 服务器游玩」时，loading.html 会把它拼到要跳转的地址上，进游戏后自动加入该房间。
  const ROOM_RE = /[?&#]\s*room\s*=\s*([A-Za-z0-9]{4,6})/i;
  function roomCodeOf(text) {
    const s = String(text || '');
    const m = s.match(ROOM_RE);
    if (m) return m[1].toUpperCase();
    const t = s.trim();
    return /^[A-Za-z0-9]{4,6}$/.test(t) ? t.toUpperCase() : '';
  }
  function applyInvite(text) {
    const code = roomCodeOf(text);
    if (!code) { setAddrStatus('bad', '没在这段文字里找到房间号（应包含 ?room=XXXX）'); return false; }
    try { localStorage.setItem('sp.launcher.room', code); } catch { /* 隐私模式 */ }
    setAddrStatus('ok', '已识别房间 ' + code + '，点「本地游戏」或「服务器游玩」后自动进入');
    return true;
  }
  // 启动器窗口里任意位置 Ctrl+V 都能识别（输入框自己有粘贴行为时也走这里）
  document.addEventListener('paste', (e) => {
    const cd = e.clipboardData || globalThis.clipboardData;
    const text = cd && typeof cd.getData === 'function' ? cd.getData('text') : '';
    if (text && roomCodeOf(text)) { applyInvite(text); }
  }, true);

  // ---------- 热更新（业主 2026-11-22）----------
  // 宿主启动即检查 /launcher-pkg/manifest.json；有新版本推送 {t:'update-available'}。
  // 这里只负责显示提示、发起更新、展示进度。**更新包只含代码，不含美术资源**（白名单在宿主里）。
  const upd = { pending: null, busy: false };
  function showUpdateBar(text, canGo) {
    const bar = $('updateBar');
    const txt = $('updateText');
    const go = $('updateGo');
    if (!bar || !txt) return;
    txt.textContent = text;
    bar.hidden = false;
    if (go) go.hidden = !canGo;
  }
  function hideUpdateBar() { const bar = $('updateBar'); if (bar) bar.hidden = true; }

  function onUpdateAvailable(data) {
    upd.pending = { version: data.version || '', notes: data.notes || '' };
    showUpdateBar('发现新版本 ' + (data.version || '') + (data.notes ? '：' + data.notes : '') + '（只更新代码，不含美术资源）', true);
  }
  function onUpdateStatus(data) {
    const kind = data.kind || 'wait';
    const text = data.text || '';
    if (kind === 'ok' || kind === 'bad') {
      showUpdateBar(text, false);
      if (kind === 'bad') upd.busy = false;
      return;
    }
    upd.busy = true;
    showUpdateBar(text, false);
  }
  function onUpdateDone(data) {
    upd.busy = false;
    upd.pending = null;
    showUpdateBar('已更新到 ' + (data.version || '') + '，正在重新加载…', false);
    setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 1200);
  }

  function initUpdate() {
    const go = $('updateGo');
    const later = $('updateLater');
    const btn = $('updateBtn');
    if (go) go.addEventListener('click', () => {
      if (upd.busy) return;
      upd.busy = true;
      showUpdateBar('准备更新…', false);
      post({ t: 'update-now' });
    });
    if (later) later.addEventListener('click', hideUpdateBar);
    if (btn) btn.addEventListener('click', () => {
      showUpdateBar('正在检查更新…', false);
      post({ t: 'update-check' });
      setTimeout(() => { if (!upd.pending && !upd.busy) showUpdateBar('已经是最新版本', false); }, 6000);
    });
  }


  // 内容统一在 8.134.50.56 的后台管理（/admin → 公告 → 弹窗公告 → 写 data/announcement.json）。
  // 启动器页是 https://app.local，直接 fetch http://… 会被当成混合内容拦掉，
  // 所以优先让**宿主代为请求**（{t:'fetch'} → {t:'fetch-ok'}）；宿主不支持时退回直接 fetch。
  const NOTICE_SOURCES = [
    'http://8.134.50.56:3000/api/announcement',
    'https://mon3tr.fun/api/announcement',
  ];
  // history：服务端 /api/announcement 给的**历史公告**（新的在前）
  // shown  ：当前正文正在显示的那一条（可能是历史里的旧公告，也可能是最新那条）
  const noticeState = { notice: null, history: [], shown: null, fetchedAt: 0 };
  // 三档的表现，与游戏内 public/js/ui/announcementPopup.js 的 LEVELS 保持同一套色值
  const NOTICE_TONE = {
    info: { color: '#50e0b0', label: '公告', sev: '低', pips: 1, soft: 'rgba(80,224,176,.14)', edge: 'rgba(80,224,176,.55)', tint: '#18332b' },
    warning: { color: '#ffc65c', label: '警告', sev: '中', pips: 2, soft: 'rgba(255,198,92,.14)', edge: 'rgba(255,198,92,.60)', tint: '#31301f' },
    urgent: { color: '#e2534a', label: '紧急', sev: '高', pips: 3, soft: 'rgba(226,83,74,.16)', edge: 'rgba(226,83,74,.85)', tint: '#31211e' },
  };
  const noticeTone = (n) => NOTICE_TONE[(n && n.level) || 'info'] || NOTICE_TONE.info;
  /** 历史卡片上的时间：历史条目有收录/开始时间；当前这条只有 expiresAt，就显示「至 xx」。 */
  function noticeTime(n) {
    const start = Number(n && (n.startAt || n.at)) || 0;
    const end = Number(n && n.expiresAt) || 0;
    const p = (v) => String(v).padStart(2, '0');
    const fmt = (ms) => { const d = new Date(ms); return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
    if (start) return fmt(start);
    if (end) return '至 ' + fmt(end);
    return '';
  }
  /** 列表标题：有标题用标题，否则截正文。 */
  function noticeListTitle(n) {
    const t = (n && (n.title || n.text)) || '';
    return t.length > 18 ? t.slice(0, 18) + '…' : t;
  }

  /** 自绘滚动条（业主 2026-11-22：不要浏览器原生那根）。原生条由 CSS 隐藏，这里画轨道与滑块。 */
  function attachSlimScroll(el, className) {
    if (!el || !el.parentElement) return null;
    const host = el.parentElement;
    const track = document.createElement('div');
    track.className = className;
    const thumb = document.createElement('i');
    track.appendChild(thumb);
    host.appendChild(track);
    const sync = () => {
      const hr = host.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const sh = el.scrollHeight;
      const ch = el.clientHeight;
      if (sh <= ch + 1 || er.height <= 0) { track.style.display = 'none'; return; }
      track.style.display = '';
      track.style.top = (er.top - hr.top) + 'px';
      track.style.height = er.height + 'px';
      const h = Math.max(26, Math.round((ch * ch) / sh));
      thumb.style.height = h + 'px';
      const max = sh - ch;
      const top = max > 0 ? Math.round((el.scrollTop / max) * (ch - h)) : 0;
      thumb.style.transform = 'translateY(' + top + 'px)';
    };
    // 内容变化时在**下一帧**再量（否则新文字还没排版，会被误判成「不需要滚动条」）
    const scheduleSync = () => setTimeout(sync, 16);
    el.addEventListener('scroll', scheduleSync, { passive: true });
    if (typeof ResizeObserver === 'function') new ResizeObserver(scheduleSync).observe(el);
    if (typeof MutationObserver === 'function') new MutationObserver(scheduleSync).observe(el, { childList: true, subtree: true });
    let dragging = false;
    let startY = 0;
    let startTop = 0;
    thumb.addEventListener('pointerdown', (e) => {
      dragging = true; startY = e.clientY; startTop = el.scrollTop;
      track.classList.add('is-drag');
      try { thumb.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    });
    thumb.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const sh = el.scrollHeight;
      const ch = el.clientHeight;
      const h = Math.max(26, Math.round((ch * ch) / sh));
      const ratio = (sh - ch) / Math.max(1, ch - h);
      el.scrollTop = startTop + (e.clientY - startY) * ratio;
    });
    const stop = () => { dragging = false; track.classList.remove('is-drag'); };
    thumb.addEventListener('pointerup', stop);
    thumb.addEventListener('pointercancel', stop);
    sync();
    setTimeout(scheduleSync, 0);
    setTimeout(scheduleSync, 120);
    setTimeout(scheduleSync, 400);
    setTimeout(scheduleSync, 900);
    return { sync, track };
  }
  const bridgeFetch = (url) => new Promise((resolve) => {
    if (!bridge) { resolve(null); return; }
    const id = 'nf' + Math.random().toString(36).slice(2, 8);
    let done = false;
    const onMsg = (e) => {
      const d = e && e.data;
      if (!d || d.t !== 'fetch-ok' || d.id !== id) return;
      done = true;
      try { bridge.removeEventListener('message', onMsg); } catch { /* ignore */ }
      resolve(typeof d.body === 'string' ? d.body : null);
    };
    try { bridge.addEventListener('message', onMsg); } catch { /* ignore */ }
    post({ t: 'fetch', id, url });
    setTimeout(() => { if (!done) { try { bridge.removeEventListener('message', onMsg); } catch { /* ignore */ } resolve(null); } }, 6000);
  });
  async function fetchAnnouncement() {
    for (const url of NOTICE_SOURCES) {
      let text = null;
      // 1) 宿主代取（能绕开混合内容限制）
      text = await bridgeFetch(url);
      // 2) 退回直接 fetch（本机/同源时可用）
      if (!text) {
        try {
          const r = await fetch(url, { cache: 'no-store' });
          if (r.ok) text = await r.text();
        } catch { /* 被拦或离线 */ }
      }
      if (!text) continue;
      try {
        const j = JSON.parse(text);
        // 历史公告随时刷新（弹窗开着时左侧列表也要能跟上）
        if (j && Array.isArray(j.history)) noticeState.history = j.history;
        if (j && j.announcement && j.announcement.text) { noticeState.notice = j.announcement; noticeState.fetchedAt = Date.now(); return noticeState.notice; }
      } catch { /* 不是公告 JSON */ }
    }
    return null;
  }
  function noticeSnoozed(n) {
    try {
      const raw = localStorage.getItem('sp.announce.snooze');
      if (!raw) return false;
      const s = JSON.parse(raw);
      // 业主 2026-11-22：「今日不再弹出」→「下次更新前不再弹出」：只比 id，不再按天过期。
      // 内容一更新（id 变）立刻重新弹，玩家不会被"今天"这个界限卡住。
      return !!s && !!s.id && s.id === (n && n.id);
    } catch { return false; }
  }
  function snoozeNotice(n) {
    try {
      const box = $('announceSnooze');
      if (!box || !box.checked || !n) return;
      localStorage.setItem('sp.announce.snooze', JSON.stringify({ id: n.id, at: Date.now() }));
    } catch { /* ignore */ }
  }
  function onHostAnnouncement(body) {
    try {
      const j = JSON.parse(body);
      if (j && Array.isArray(j.history)) noticeState.history = j.history;
      if (j && j.announcement && j.announcement.text) {
        noticeState.notice = j.announcement;
        noticeState.fetchedAt = Date.now();
        paintNotice();
        if (!noticeSnoozed(j.announcement)) openNotice();   // 启动即弹（勾了「今天不再弹」且同一条则跳过）
        return true;
      }
    } catch { /* 不是公告 JSON */ }
    return false;
  }
    function paintNotice() {
    const btn = $('noticeBtn');
    const dot = $('noticeDot');
    if (!btn) return;
    const has = !!(noticeState.notice && noticeState.notice.text);
    if (dot) dot.hidden = !has;
    btn.title = has ? '公告（有新内容）' : '公告';
  }
  /** 左侧历史列表：**最新公告永远置顶**（右上角挂档位色 NEW），正在看的那一行用档位色高光包裹。 */
  function renderNoticeList() {
    const box = $('announceHistory');
    if (!box) return;
    const rows = [];
    if (noticeState.notice) rows.push(Object.assign({}, noticeState.notice, { __latest: true }));
    for (const h of noticeState.history) if (!noticeState.notice || h.id !== noticeState.notice.id) rows.push(h);
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'announce__hist-empty';
      empty.textContent = '暂无历史公告';
      box.appendChild(empty);
      return;
    }
    for (const n of rows) {
      const tone = noticeTone(n);
      const viewing = !!noticeState.shown && n.id === noticeState.shown.id;
      const row = document.createElement('div');
      row.className = 'announce__row' + (viewing ? ' is-on' : '');
      row.setAttribute('data-nid', String(n.id));
      row.title = (n.title || n.text || '') + (n.__latest ? '（最新）' : '');
      if (viewing) {
        // 高光 = 该档位色的描边 + 外发光 + 同色实底（不是"查看中"文字）
        row.style.borderColor = tone.color;
        row.style.boxShadow = '0 0 0 1px ' + tone.edge + ', 0 0 12px ' + tone.soft;
        row.style.background = tone.tint;
      }
      const dot = document.createElement('span');
      dot.className = 'announce__row-dot';
      dot.style.background = tone.color;
      const main = document.createElement('span');
      main.className = 'announce__row-main';
      const t = document.createElement('div');
      t.className = 'announce__row-t';
      t.textContent = noticeListTitle(n);
      const m = document.createElement('div');
      m.className = 'announce__row-m';
      m.textContent = tone.label + ' · 紧急程度 ' + tone.sev;
      main.appendChild(t);
      main.appendChild(m);
      const end = document.createElement('span');
      end.className = 'announce__row-end';
      if (n.__latest) {
        const badge = document.createElement('span');
        badge.className = 'announce__row-new';
        badge.textContent = 'NEW';
        badge.style.color = tone.color;
        badge.style.background = tone.soft;
        end.appendChild(badge);
      }
      const time = document.createElement('span');
      time.className = 'announce__row-time';
      time.textContent = noticeTime(n);
      end.appendChild(time);
      row.appendChild(dot);
      row.appendChild(main);
      row.appendChild(end);
      box.appendChild(row);
    }
  }

  /** 把一条公告画到右侧正文（含档位配色），并刷新左侧列表。 */
  function paintNoticeCard(n) {
    const modal = $('announceModal');
    if (!modal) return;
    const level = n.level || 'info';
    const tone = noticeTone(n);
    const urgent = level === 'urgent';
    noticeState.shown = n;
    const card = modal.querySelector('.announce__card');
    if (card) {
      card.setAttribute('data-level', level);
      card.style.borderColor = tone.edge;
      // tint 是不透明的深色：业主 2026-11-22「不要半透明背景」（原来用 soft 会透出后面的画面）
      card.style.background = 'linear-gradient(180deg, ' + (tone.tint || '#0f1715') + ', #0f1715 42%)';
      card.style.boxShadow = urgent
        ? '0 18px 60px rgba(0,0,0,.65), 0 0 0 1px ' + tone.edge + ', 0 0 28px ' + tone.soft
        : '';
    }
    const bar = $('announceBar'); if (bar) bar.style.background = tone.color;
    const kicker = $('announceKicker'); if (kicker) { kicker.textContent = tone.label + ' · ANNOUNCEMENT'; kicker.style.color = tone.color; }
    const pips = $('announcePips');
    if (pips) {
      // 用 DOM 拼（不用 innerHTML）：格数 = 1/2/3，配合文字一起表达紧急程度
      while (pips.firstChild) pips.removeChild(pips.firstChild);
      for (let i = 1; i <= 3; i++) {
        const dot = document.createElement('i');
        if (i <= tone.pips) { dot.className = 'on'; dot.style.background = tone.color; }
        pips.appendChild(dot);
      }
    }
    const sev = $('announceSev');
    if (sev) { sev.textContent = '紧急程度 ' + tone.sev; sev.style.color = tone.color; }
    // 业主 2026-11-22：所有档位都给「今天不再弹出」（含紧急，与游戏内一致）
    const snooze = modal.querySelector('.announce__snooze');
    if (snooze) snooze.style.display = '';
    const ok = $('announceOk');
    if (ok) { ok.style.background = tone.color; ok.style.color = '#06110d'; }
    const title = $('announceTitle');
    if (title) { title.textContent = n.title || ''; title.hidden = !n.title; }
    const text = $('announceText'); if (text) text.textContent = n.text || '';
    const meta = $('announceMeta');
    if (meta) {
      const isCurrent = !!(noticeState.notice && n.id === noticeState.notice.id);
      const end = n.expiresAt ? new Date(Number(n.expiresAt)) : null;
      if (isCurrent) {
        meta.textContent = noticeState.fetchedAt
          ? '来自服务器公告 · 更新于 ' + new Date(noticeState.fetchedAt).toLocaleString() + (end ? ' · 截止 ' + end.toLocaleString() : '')
          : '';
      } else {
        meta.textContent = '历史公告 · ' + (noticeTime(n) || '已存档');
      }
    }
    modal.hidden = false;
    renderNoticeList();
  }

  /** 打开公告弹窗：不传参数 = 最新那条；传一条 = 切到那一条（不关弹窗）。 */
  function openNotice(which) {
    const n = (which && which.text) ? which : noticeState.notice;
    if (!n) {
      setAddrStatus('off', '当前没有公告');
      return;
    }
    paintNoticeCard(n);
  }
  function closeNotice() {
    const modal = $('announceModal');
    if (modal) modal.hidden = true;
  }

  // ---------- 多版本（业主 2026-11-22：启动器独立于游戏版本）----------
  const versionState = { active: '', items: [] };

  function renderVersions(data) {
    versionState.active = data.active || '';
    versionState.items = Array.isArray(data.items) ? data.items : [];
    // 卡片上的「版本：xxx」跟着当前版本走
    const cur = versionState.items.find((v) => v.id === versionState.active);
    const label = cur ? (cur.name || cur.id) + '（:' + cur.port + '）' : '未登记';
    if ($('localVerName')) $('localVerName').textContent = label;
    if ($('publicVerName')) $('publicVerName').textContent = label;
    const box = $('versionList');
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!versionState.items.length) {
      const d = document.createElement('div');
      d.className = 'vempty';
      d.textContent = '还没有登记任何版本，点下面「导入游戏目录…」选一个';
      box.appendChild(d);
      return;
    }
    for (const it of versionState.items) {
      const row = document.createElement('div');
      row.className = 'vrow' + (it.id === versionState.active ? ' is-active' : '');
      row.setAttribute('data-vid', String(it.id));
      const dot = document.createElement('span');
      dot.className = 'vrow__dot' + (it.running ? ' is-run' : '');
      const main = document.createElement('div');
      main.className = 'vrow__main';
      const name = document.createElement('div');
      name.className = 'vrow__name';
      name.appendChild(document.createTextNode(it.name || it.id));
      const tag = document.createElement('span');
      tag.className = 'vrow__tag ' + (it.running ? 'vrow__tag--run' : 'vrow__tag--off');
      tag.textContent = (it.running ? 'RUNNING :' : ':') + it.port;
      name.appendChild(tag);
      if (it.id === versionState.active) {
        const t = document.createElement('span');
        t.className = 'vrow__tag';
        t.textContent = '当前';
        name.appendChild(t);
      }
      if (!it.game) {
        const t = document.createElement('span');
        t.className = 'vrow__tag vrow__tag--off';
        t.textContent = '非游戏目录';
        name.appendChild(t);
      }
      const p = document.createElement('div');
      p.className = 'vrow__path';
      p.textContent = it.dir || '';
      main.appendChild(name);
      main.appendChild(p);
      const acts = document.createElement('div');
      acts.className = 'vrow__acts';
      const mk = (label, act, primary, disabled) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.setAttribute('data-act', act);
        if (primary) b.className = 'is-primary';
        if (disabled) b.disabled = true;
        return b;
      };
      acts.appendChild(mk('进入游戏', 'enter', true, !it.game));
      acts.appendChild(mk(it.running ? '已开服' : '开服', 'start', false, it.running || !it.game));
      acts.appendChild(mk('停止', 'stop', false, !it.running));
      if (it.id !== versionState.active) acts.appendChild(mk('设为当前', 'active', false, false));
      if (it.id !== versionState.active) acts.appendChild(mk('移除', 'remove', false, false));
      row.appendChild(dot);
      row.appendChild(main);
      row.appendChild(acts);
      box.appendChild(row);
    }
  }

  function initVersions() {
    const box = $('versionList');
    if (box) {
      box.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('button[data-act]') : null;
        if (!btn || btn.disabled) return;
        const row = btn.closest('[data-vid]');
        if (!row) return;
        const id = row.getAttribute('data-vid');
        const act = btn.getAttribute('data-act');
        if (act === 'start') post({ t: 'version-start', id });
        else if (act === 'stop') post({ t: 'version-stop', id });
        else if (act === 'active') post({ t: 'version-active', id });
        else if (act === 'remove') post({ t: 'version-remove', id });
        else if (act === 'enter') post({ t: 'version-enter', id });
        $('versionMsg').textContent = '已下发：' + btn.textContent;
      });
    }
    const imp = $('versionImport');
    if (imp) imp.addEventListener('click', () => pkOpen('folder'));
    const rf = $('versionRefresh');
    if (rf) rf.addEventListener('click', () => post({ t: 'versions' }));
    post({ t: 'versions' });
  }

  // ---------- 选择器（版本选择 / 目录选择；版式参考 UI 编辑器的选择页）----------
  const pkState = { mode: 'version', sel: null, info: null, cb: null, items: [], path: '' };
  const pkEl = (id) => document.getElementById(id);

  function pkOpen(mode, cb) {
    pkState.mode = mode;
    pkState.sel = null;
    pkState.info = null;
    pkState.cb = cb || null;
    pkState.items = [];
    pkEl('pk').hidden = false;
    pkEl('pkPathbar').hidden = mode !== 'folder';
    pkEl('pkBadge').hidden = true;
    pkEl('pkChecks').textContent = '';
    pkEl('pkDName').textContent = '未选择';
    pkEl('pkDPath').textContent = '在上面的列表里选一项';
    pkEl('pkOk').disabled = true;
    while (pkEl('pkDrives').firstChild) pkEl('pkDrives').removeChild(pkEl('pkDrives').firstChild);
    if (mode === 'version') {
      pkEl('pkEyebrow').textContent = 'GAME VERSION · 选择版本';
      pkEl('pkTitle').textContent = '选择要使用的游戏版本';
      pkEl('pkHint').textContent = '每个版本独立目录、独立端口、独立存档';
      pkEl('pkUp').hidden = true;
      pkRenderVersions();
    } else {
      pkEl('pkEyebrow').textContent = 'GAME ROOT · 游戏目录';
      pkEl('pkTitle').textContent = '选择游戏文件夹';
      pkEl('pkHint').textContent = '需要包含 server/index.js 的那一层';
      pkEl('pkUp').hidden = false;
      pkLoadFs('');
    }
  }

  function pkClose() { pkEl('pk').hidden = true; }

  function pkSay(text) {
    const el = pkEl('pkState');
    el.hidden = !text;
    el.textContent = text || '';
  }

  function pkRenderVersions() {
    const box = pkEl('pkList');
    while (box.firstChild) box.removeChild(box.firstChild);
    pkState.items = versionState.items.slice();
    if (!pkState.items.length) { pkSay('还没有登记版本，先用「导入游戏目录…」加一个'); return; }
    pkSay('');
    for (const it of pkState.items) {
      const row = document.createElement('div');
      row.className = 'pk__row';
      row.setAttribute('data-pk', String(it.id));
      const left = document.createElement('div');
      left.style.minWidth = '0';
      const nm = document.createElement('div');
      nm.className = 'pk__rname';
      nm.appendChild(document.createTextNode(it.name || it.id));
      const tag = document.createElement('span');
      tag.className = 'pk__rtag ' + (it.running ? '' : 'pk__rtag--off');
      tag.textContent = (it.running ? 'RUNNING :' : ':') + it.port;
      nm.appendChild(tag);
      const p = document.createElement('div');
      p.className = 'pk__rpath';
      p.textContent = it.dir || '';
      left.appendChild(nm);
      left.appendChild(p);
      row.appendChild(left);
      box.appendChild(row);
    }
    pkSelect(pkState.items[0].id);
  }

  function pkRenderFs(msg) {
    pkState.path = msg.path || '';
    pkState.parent = msg.parent || '';
    pkEl('pkPath').value = pkState.path || '（驱动器列表）';
    const box = pkEl('pkList');
    while (box.firstChild) box.removeChild(box.firstChild);
    const drives = pkEl('pkDrives');
    while (drives.firstChild) drives.removeChild(drives.firstChild);
    pkState.items = Array.isArray(msg.items) ? msg.items : [];
    // 面包屑：驱动器 → 每一级目录，都可以点（业主 2026-11-22：路径要能点击并跳到那层）
    const crumbs = pkEl('pkCrumbs');
    while (crumbs.firstChild) crumbs.removeChild(crumbs.firstChild);
    if (pkState.path) {
      const parts = String(pkState.path).split('\\').filter((s) => s.length > 0);
      let acc = '';
      parts.forEach((seg, i) => {
        acc = i === 0 ? seg + '\\' : acc.replace(/\\$/, '') + '\\' + seg;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pk__crumb' + (i === parts.length - 1 ? ' is-here' : '');
        b.textContent = seg;
        b.onclick = () => pkLoadFs(acc);
        crumbs.appendChild(b);
        if (i < parts.length - 1) {
          const s = document.createElement('span');
          s.className = 'pk__sep';
          s.textContent = '›';
          crumbs.appendChild(s);
        }
      });
    }
    if (!pkState.path) {
      for (const it of pkState.items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pk__drive';
        b.textContent = (it.path || '') + (it.free ? '  ' + it.free : '');
        b.onclick = () => pkLoadFs(it.path);
        drives.appendChild(b);
      }
    }
    pkSay(pkState.items.length ? (msg.error ? '读取失败：' + msg.error : '') : '这个文件夹里没有子文件夹');
    // 「↑ 上一级」（业主 2026-11-22：目录选择要能回到子文件夹/上级）
    if (pkState.path && msg.parent) {
      const up = document.createElement('div');
      up.className = 'pk__row pk__row--up';
      up.setAttribute('data-up', String(msg.parent));
      const l = document.createElement('div');
      l.style.minWidth = '0';
      const n = document.createElement('div');
      n.className = 'pk__rname';
      n.textContent = '↑ 上一级';
      const pth = document.createElement('div');
      pth.className = 'pk__rpath';
      pth.textContent = msg.parent;
      l.appendChild(n);
      l.appendChild(pth);
      up.appendChild(l);
      box.appendChild(up);
    }
    for (const it of pkState.items) {
      const row = document.createElement('div');
      row.className = 'pk__row' + (it.game ? ' pk__row--game' : '');
      row.setAttribute('data-pk', String(it.path));
      row.setAttribute('data-game', it.game ? '1' : '');
      const left = document.createElement('div');
      left.style.minWidth = '0';
      const nm = document.createElement('div');
      nm.className = 'pk__rname';
      nm.appendChild(document.createTextNode(it.name || it.path));
      if (it.game) {
        const t = document.createElement('span');
        t.className = 'pk__rtag';
        t.textContent = '游戏目录';
        nm.appendChild(t);
      }
      const p = document.createElement('div');
      p.className = 'pk__rpath';
      p.textContent = it.path || '';
      left.appendChild(nm);
      left.appendChild(p);
      row.appendChild(left);
      box.appendChild(row);
    }
    pkClearSel();
  }

  function pkClearSel() {
    pkState.sel = null;
    pkState.info = null;
    pkEl('pkOk').disabled = true;
    pkEl('pkBadge').hidden = true;
    pkEl('pkDName').textContent = '未选择';
    pkEl('pkDPath').textContent = '在上面的列表里选一项';
    pkEl('pkChecks').textContent = '';
  }

  function pkSelect(key) {
    const box = pkEl('pkList');
    for (const r of box.querySelectorAll('.pk__row')) {
      r.classList.toggle('is-on', r.getAttribute('data-pk') === String(key));
    }
    pkState.sel = key == null ? null : String(key);
    const item = pkState.mode === 'version'
      ? pkState.items.find((x) => String(x.id) === String(key))
      : pkState.items.find((x) => String(x.path) === String(key));
    if (!item) { pkClearSel(); return; }
    const isGame = pkState.mode === 'version' ? !!item.game : !!item.game;
    pkState.info = item;
    pkEl('pkDName').textContent = (item.name || item.path || '');
    pkEl('pkDPath').textContent = (item.dir || item.path || '');
    pkEl('pkBadge').hidden = !isGame;
    pkEl('pkChecks').textContent = pkState.mode === 'version'
      ? ('端口 ' + (item.port || '—') + (item.running ? ' · 运行中' : ' · 未运行'))
      : (isGame ? '✓ 含 server/index.js，可以开服（正在读取版本与体积…）' : '✗ 不是游戏目录（可以进去再选一层）');
    pkEl('pkOk').disabled = pkState.mode === 'version' ? false : !isGame;
    // 目录模式下再问一次详情（版本号 / 体积 / 文件数 / 是否自带 node、data）
    if (pkState.mode === 'folder') post({ t: 'fs-detail', path: item.path });
  }

  /** 目录详情回来之后补到右侧说明里（业主 2026-11-22：要标出包内版本与整体情况）。 */
  function pkRenderDetail(d) {
    if (!d || pkState.mode !== 'folder') return;
    if (pkState.sel == null || String(d.path) !== String(pkState.sel)) return;
    const parts = [];
    if (d.version) parts.push('版本 ' + d.version);
    if (d.files) parts.push(d.files + ' 个文件');
    if (d.bytes) parts.push((d.bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB');
    if (d.partial) parts.push('（体积为估算，目录太大）');
    parts.push(d.node ? '自带 node' : '用启动器自带 node');
    parts.push(d.data ? '有 data（存档/账号）' : '没有 data（首次启动会新建）');
    if (d.assets) parts.push('含美术资源');
    pkEl('pkChecks').textContent = (d.game ? '✓ 可以开服 · ' : '✗ 不是游戏目录 · ') + parts.join(' · ');
  }

  function pkLoadFs(path) {
    pkSay('正在读取…');
    post({ t: 'fs-list', path: path || '' });
  }

  function initPicker() {
    const list = pkEl('pkList');
    if (list) {
      list.addEventListener('click', (ev) => {
        const row = ev.target && ev.target.closest ? ev.target.closest('.pk__row') : null;
        if (!row) return;
        const up = row.getAttribute('data-up');
        if (up) { pkLoadFs(up); return; }
        pkSelect(row.getAttribute('data-pk'));
      });
      list.addEventListener('dblclick', (ev) => {
        const row = ev.target && ev.target.closest ? ev.target.closest('.pk__row') : null;
        if (!row || pkState.mode !== 'folder') return;
        const up = row.getAttribute('data-up');
        if (up) { pkLoadFs(up); return; }
        const p = row.getAttribute('data-pk');
        if (p) pkLoadFs(p);
      });
    }
    if (pkEl('pkUp')) pkEl('pkUp').onclick = () => pkLoadFs(pkState.parent || '');
    if (pkEl('pkPath')) {
      pkEl('pkPath').addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { pkLoadFs(pkEl('pkPath').value.replace('（驱动器列表）', '').trim()); }
      });
    }
    if (pkEl('pkClose')) pkEl('pkClose').onclick = pkClose;
    if (pkEl('pkCancel')) pkEl('pkCancel').onclick = pkClose;
    if (pkEl('pk')) pkEl('pk').addEventListener('click', (ev) => { if (ev.target === pkEl('pk')) pkClose(); });
    if (pkEl('pkOk')) pkEl('pkOk').onclick = () => {
      if (pkEl('pkOk').disabled || !pkState.sel) return;
      if (pkState.mode === 'version') {
        const cb = pkState.cb;
        const id = pkState.sel;
        pkClose();
        if (cb) cb(id);
        post({ t: 'versions' });
      } else {
        const dir = pkState.sel;
        pkClose();
        post({ t: 'version-import', dir });
      }
    };
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !pkEl('pk').hidden) pkClose();
    });
  }

  // ---------- 启动器自己的版本号（业主 2026-11-22）----------
  // 与游戏热更包的 version（YYYYMMDD-NN）无关：改启动器界面/宿主能力时改 launcher/version.json。
  // 宿主也会读同一个文件（日志与窗口标题），所以只有一个真相来源。
  async function loadLauncherVersion() {
    let v = '';
    try {
      const r = await fetch('version.json?v=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        v = (j && j.launcher) || '';
      }
    } catch { /* 读不到就保持占位符 */ }
    const el = $('launcherVer');
    if (el) {
      el.textContent = '启动器 v' + (v || '—');
      el.title = '启动器版本（独立于游戏热更包）' + (v ? '：' + v : '');
    }
    return v;
  }

  setAddrText();
  post({ t: 'ready' });

  // 公告初始化（弹层在脚本之后解析，所以等 DOM 就绪）
  function initNotice() {
    const btn = $('noticeBtn');
    if (btn) btn.addEventListener('click', () => { if (!noticeState.notice) void fetchAnnouncement().then(() => { paintNotice(); openNotice(); }); else openNotice(); });
    const ok = $('announceOk');
    // 勾选作用于**当前正在看的那一条**（切到历史公告后再关，记的是那条的 id）
    if (ok) ok.addEventListener('click', () => { snoozeNotice(noticeState.shown || noticeState.notice); closeNotice(); });
    const hist = $('announceHistory');
    // 自绘滚动条：正文 + 历史列表（弹窗是常驻 DOM，挂一次即可；显示时 ResizeObserver 会重算）
    const modalEl = $('announceModal');
    if (modalEl) attachSlimScroll(modalEl.querySelector('.announce__body'), 'announce__slim');
    attachSlimScroll(hist, 'announce__slim');
    if (hist) hist.addEventListener('click', (e) => {
      const row = e.target && e.target.closest ? e.target.closest('[data-nid]') : null;
      if (!row) return;
      const id = row.getAttribute('data-nid');
      // 三级查找：先比最新，再比正在看的，最后查历史 —— 保证"点了最新能切回来"（CL-25 的同一个坑）
      const target = (noticeState.notice && noticeState.notice.id === id) ? noticeState.notice
        : ((noticeState.shown && noticeState.shown.id === id) ? noticeState.shown
          : noticeState.history.find((h) => h.id === id));
      if (target) openNotice(target);
    });
    const modal = $('announceModal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeNotice(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNotice(); });
    // 每次打开启动器拉一次；有内容就自动弹（勾过「今天不再弹」且同一条则跳过）
    void fetchAnnouncement().then((n) => { paintNotice(); if (n && !noticeSnoozed(n)) setTimeout(openNotice, 400); });
    // 每 10 分钟刷新一次未读标记
    setInterval(() => { void fetchAnnouncement().then(paintNotice); }, 600000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initNotice);
  else initNotice();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUpdate);
  else initUpdate();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadLauncherVersion);
  else loadLauncherVersion();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initVersions);
  else initVersions();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPicker);
  else initPicker();

  // ---------- F11 全屏（业主 2026-11-21）----------
  // 启动器窗口是 WebView2 内嵌宿主，Chromium 自带的 F11 在宿主里不触发，所以这个页面自己接管：
  // F11 → 切换 document 全屏；再按一次退出。
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'F11' && e.keyCode !== 122) return;
    e.preventDefault();
    if (e.repeat) return;
    const d = document;
    const fsEl = d.fullscreenElement || d.webkitFullscreenElement;
    if (fsEl) {
      const exit = d.exitFullscreen || d.webkitExitFullscreen;
      if (typeof exit === 'function') { try { exit.call(d); } catch { /* 忽略 */ } }
      return;
    }
    const el = d.documentElement || d.body;
    const req = el && (el.requestFullscreen || el.webkitRequestFullscreen);
    if (typeof req === 'function') {
      try { const r = req.call(el, { navigationUI: 'hide' }); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* 被策略拒绝 */ }
    }
  }, true);
})();
