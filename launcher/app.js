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
  $('localCard').addEventListener('click', () => {
    if (state.busy) return;
    state.busy = true;
    showLoading('正在启动服务器');
    post({ t: 'start-local' });
  });

  $('publicCard').addEventListener('click', () => {
    if (state.busy) return;
    state.busy = true;
    showLoading('正在部署公开服务器');
    post({ t: 'start-public' });
  });

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
  const noticeState = { notice: null, fetchedAt: 0 };
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
        if (j && j.announcement && j.announcement.text) { noticeState.notice = j.announcement; noticeState.fetchedAt = Date.now(); return noticeState.notice; }
      } catch { /* 不是公告 JSON */ }
    }
    return null;
  }
  function onHostAnnouncement(body) {
    try {
      const j = JSON.parse(body);
      if (j && j.announcement && j.announcement.text) {
        noticeState.notice = j.announcement;
        noticeState.fetchedAt = Date.now();
        paintNotice();
        openNotice();          // 启动即弹
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
  function openNotice() {
    const modal = $('announceModal');
    if (!modal) return;
    const n = noticeState.notice;
    if (!n) {
      setAddrStatus('off', '当前没有公告');
      return;
    }
    const level = n.level || 'info';
    const color = level === 'urgent' ? '#e2534a' : (level === 'warning' ? '#ffc65c' : '#50e0b0');
    const label = level === 'urgent' ? '紧急' : (level === 'warning' ? '警告' : '公告');
    const bar = $('announceBar'); if (bar) bar.style.background = color;
    const kicker = $('announceKicker'); if (kicker) { kicker.textContent = label + ' · ANNOUNCEMENT'; kicker.style.color = color; }
    const title = $('announceTitle');
    if (title) { title.textContent = n.title || ''; title.hidden = !n.title; }
    const text = $('announceText'); if (text) text.textContent = n.text || '';
    const meta = $('announceMeta');
    if (meta) {
      const end = n.expiresAt ? new Date(Number(n.expiresAt)) : null;
      meta.textContent = noticeState.fetchedAt
        ? '来自服务器公告 · 更新于 ' + new Date(noticeState.fetchedAt).toLocaleString() + (end ? ' · 截止 ' + end.toLocaleString() : '')
        : '';
    }
    modal.hidden = false;
  }
  function closeNotice() {
    const modal = $('announceModal');
    if (modal) modal.hidden = true;
  }

  setAddrText();
  post({ t: 'ready' });

  // 公告初始化（弹层在脚本之后解析，所以等 DOM 就绪）
  function initNotice() {
    const btn = $('noticeBtn');
    if (btn) btn.addEventListener('click', () => { if (!noticeState.notice) void fetchAnnouncement().then(() => { paintNotice(); openNotice(); }); else openNotice(); });
    const ok = $('announceOk');
    if (ok) ok.addEventListener('click', closeNotice);
    const modal = $('announceModal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeNotice(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNotice(); });
    // 每次打开启动器拉一次；有内容就自动弹（和游戏内表现一致）
    void fetchAnnouncement().then((n) => { paintNotice(); if (n) setTimeout(openNotice, 400); });
    // 每 10 分钟刷新一次未读标记
    setInterval(() => { void fetchAnnouncement().then(paintNotice); }, 600000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initNotice);
  else initNotice();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUpdate);
  else initUpdate();

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
