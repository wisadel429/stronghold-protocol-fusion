// public/js/screens/auth.js — 账号登录 / 注册表单（账号系统），以及标题页右上角的账号按钮。
//
// 口径（业主 2026-11-14）：**登录凭据是 QQ 号**（5–12 位数字，不公开，仅用于自己记忆/找回与管理员检索）；
// 开放注册（同 IP 每小时 3 个，服务端限速）；昵称不唯一、靠四位 #tag 区分，注册时自填（默认「博士」）；
// 单设备登录（新登录踢掉旧连接）；忘密码由管理员重置（页面上给出提示）；
// 头像用**干员立绘**（avatarId = charId），按业主口径**不做头像框**。
// 未登录时服务端会拒绝 WebSocket 握手（AUTH_REQUIRED），所以登录是进游戏前绕不开的一步。
//
// 两种长相（同一套表单，业主 2026-11-14 二次口径「登录直接长在标题页上」）：
//   * AuthCard  —— 标题页「开始」卡里的内嵌表单（登录页不再整屏挡板，见 screens/title.js / css/screens/title.css）；
//   * AuthScreen —— 整屏版，留给旧调用方 / 调试（boot 已不再用它）。
//
// 兼容：若服务器没有挂账号 API（SP_ACCOUNTS=off，/api/account/me 404），登录卡/登录屏都直接放行 ——
// 本地开发/测试不被卡住。
import { useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, TextField, MicroLabel } from '../ui/components.js';
import { Modal } from '../ui/components.js';
import { accountApi } from '../accountApi.js';
import { data } from '../data.js';
import { useData } from '../data.js';
import { cardOperators } from '../ui/seatArt.js';
import { chessPortraitUrl, chessAvatarUrl } from '../ui/assetUrls.js';
import { t } from '../../../shared/i18n.js';

const CSS = `
.spauth__field{display:block;margin-bottom:10px}
.spauth__field span{display:block;font-size:11px;letter-spacing:.14em;color:#6f7f79;margin-bottom:4px;text-transform:uppercase}
.spauth__field input{width:100%;box-sizing:border-box;padding:10px 12px;font-size:14px;color:#e6ece9;background:#0a0f0e;
  border:1px solid #24312c;border-radius:6px;outline:none}
.spauth__field input:focus{border-color:#17d9a0}
.spauth__err{min-height:18px;margin:10px 0 0;font-size:12.5px;color:#ff8a7a;line-height:1.5}
.spauth__account{display:inline-flex;align-items:center;gap:6px;height:max(.36rem,1.9em);padding:0 .14rem;font-size:calc(.15 * var(--t));
  font-weight:700;color:#c8e9de;background:#0d1413;border:1px solid #24312c;border-radius:.05rem;cursor:pointer}
.spauth__account b{color:#17d9a0;font-weight:800}
.spauth__avatar{width:1.15em;height:1.15em;border-radius:50%;object-fit:cover;object-position:50% 12%;background:#0a1210;flex:none}
.spauth__avatar--blank{display:inline-grid;place-items:center;color:#4d5c56;font-size:.8em}
.spauth__panel{position:fixed;z-index:2147483001;top:calc(var(--t) * .6);right:calc(var(--t) * .8);width:300px;padding:14px;
  background:#0d1312;border:1px solid #24312c;border-radius:8px;box-shadow:0 20px 50px -20px #000;color:#e6ece9;
  font-family:"Noto Sans SC","Microsoft YaHei",system-ui,sans-serif}
.spauth__panel h4{margin:0 0 8px;font-size:13px;letter-spacing:.06em}
.spauth__panel p{margin:0 0 10px;font-size:12px;color:#93a29c;line-height:1.6}
.spauth__row{display:flex;gap:8px}
.spauth__row button{flex:1;padding:8px 10px;font-size:12.5px;font-weight:700;border-radius:6px;cursor:pointer;
  background:#131a18;color:#c8d6d0;border:1px solid #24312c}
.spauth__row button.primary{background:linear-gradient(180deg,#6bf7cd,#17d9a0);color:#06110d;border-color:#17d9a0}
.spauth__row button:disabled{opacity:.5;cursor:default}
.spauth__avatars{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;max-height:46vh;overflow:auto;padding:2px}
/* 头像选择弹窗放大（业主 2026-11-14「放大一点，展示多一点」）：容器加宽 + 6 列 + 更高滚动区 */
.modal__box:has(.spauth__avatars){width:min(1180px,96vw);max-width:none}
.spauth__avatars{grid-template-columns:repeat(6,1fr);gap:10px;max-height:74vh}
.spauth__avatars button{padding:0;border:1px solid #24312c;border-radius:6px;background:#0a0f0e;cursor:pointer;overflow:hidden}
.spauth__avatars button.is-on{border-color:#17d9a0;box-shadow:0 0 0 1px #17d9a0 inset}
/* 干员头像卡：星级 + 立绘样式切换（业主 2026-11-14） */
.spauth__op{display:flex;flex-direction:column;gap:4px;min-width:0}
.spauth__op-img{aspect-ratio:1/1;display:block;width:100%}
/* 甄选干员占位卡（自选编队槽位，无固定立绘） */
.spauth__op-img--empty{display:grid;place-items:center;background:linear-gradient(135deg,#141c19,#0a0f0e);border:1px dashed #3a4a44}
.spauth__diy-glyph{font-size:max(26px,calc(.26 * var(--t, 1rem)));font-weight:900;color:#3d5a4e;
  text-shadow:0 0 14px rgba(23,217,160,.3);font-family:"Noto Sans SC",system-ui,sans-serif}
.spauth__op-img--empty:hover{border-color:#17d9a0}
.spauth__op-img--empty:hover .spauth__diy-glyph{color:#17d9a0}
.spauth__op-img img{width:100%;height:100%;object-fit:cover;object-position:50% 18%;display:block}
.spauth__op-img.is-on{outline:2px solid #17d9a0;outline-offset:-2px}
.spauth__op-name{font-size:max(10px,calc(.1 * var(--t, 1rem)));color:#c8e9de;text-align:center;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.spauth__stars{font-size:max(9px,calc(.085 * var(--t, 1rem)));color:#f2c94c;text-align:center;
  letter-spacing:-1px;line-height:1;text-shadow:0 0 6px rgba(242,201,76,.35)}
.spauth__styles{display:flex;gap:3px;flex-wrap:wrap;justify-content:center}
.spauth__styles button{padding:1px 4px;font-size:max(9px,calc(.08 * var(--t, 1rem)));line-height:1.5;color:#93a29c;
  background:#0e1413;border:1px solid #24312c;border-radius:4px;cursor:pointer;max-width:100%;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.spauth__styles button.is-on{color:#06110d;background:linear-gradient(180deg,#6bf7cd,#17d9a0);border-color:#17d9a0}
/* 两步式立绘选择（业主 2026-11-14）：第一步干员列表 → 第二步该干员的全部立绘 */
.spauth__op-count{font-size:max(9px,calc(.08 * var(--t, 1rem)));color:#6f7f79;text-align:center;line-height:1.2}
.spauth__back{margin:0 0 12px}
.spauth__backbtn{padding:6px 14px;font-size:12px;font-weight:700;color:#93a29c;background:#0a0f0e;
  border:1px solid #24312c;border-radius:6px;cursor:pointer}
.spauth__backbtn:hover{color:#17d9a0;border-color:#17d9a0}
.spauth__styles-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-height:70vh;overflow:auto;padding:2px}
.spauth__style-card{display:flex;flex-direction:column;padding:0;border:1px solid #24312c;border-radius:8px;
  background:#0a0f0e;cursor:pointer;overflow:hidden;transition:border-color .15s}
.spauth__style-card:hover{border-color:rgba(23,217,160,.5)}
.spauth__style-card.is-on{border-color:#17d9a0;box-shadow:0 0 0 1px #17d9a0 inset}
.spauth__style-card img{width:100%;aspect-ratio:3/4;object-fit:cover;object-position:50% 10%;display:block}
.spauth__style-card span{display:flex;flex-direction:column;gap:2px;padding:8px;font-size:12px;text-align:center}
.spauth__style-card b{color:#c8e9de;font-weight:800}
.spauth__style-card small{font-size:10px;color:#6f7f79}
.spauth__avatars img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;object-position:50% 12%}
.spauth__avatars span{display:block;padding:3px 4px;font-size:10px;color:#93a29c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById('sp-auth-style')) return;
  const st = document.createElement('style');
  st.id = 'sp-auth-style';
  st.textContent = CSS;
  document.head.append(st);
}

/** 服务器没挂账号 API（SP_ACCOUNTS=off → /api/account/me 404）时放行：本地开发 / 测试不被账号卡住。 */
const accountsOff = (e) => !!(e && (e.code === 'E_NOT_FOUND' || e.status === 404));

/**
 * 标题页「开始」卡里的登录 / 注册表单（业主 2026-11-14：登录直接长在标题页上，不再整屏挡板）。
 * 登录 / 注册成功后回调 `onReady(account)`；服务器没挂账号 API 时直接 `onReady(null)` 放行。
 * 样式在 css/screens/title.css 的 `.title-auth*`（跟着标题页的 rem 网格与文字大小缩放）。
 * @param {{ onReady: (account: any) => void, autoFocus?: boolean, onTabChange?: (tab: 'login'|'register') => void }} props
 */
export function AuthCard({ onReady, autoFocus = false, onTabChange = () => {} }) {
  ensureStyle();
  const [tab, setTab] = useState('login');
  const [qq, setQq] = useState('');
  const [nickname, setNickname] = useState('博士');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (ev) => {
    ev?.preventDefault?.();
    if (busy) return;
    setError('');
    const q = qq.replace(/[\s-]/g, '');
    if (!q) { setError(t('请输入 QQ 号')); return; }
    if (!/^[1-9][0-9]{4,11}$/.test(q)) { setError(t('QQ 号应为 5–12 位数字')); return; }
    if (!password) { setError(t('请输入密码')); return; }
    if (tab === 'register') {
      if ([...password].length < 8) { setError(t('密码至少 8 位')); return; }
      if (password !== password2) { setError(t('两次输入的密码不一样')); return; }
      if (!agree) { setError(t('请先阅读并同意用户协议与隐私政策')); return; }
    }
    setBusy(true);
    try {
      const res = tab === 'register'
        ? await accountApi.register({ qq: q, password, nickname: nickname.trim() || '博士', agree: true })
        : await accountApi.login({ qq: q, password });
      onReady(res.account);
    } catch (e) {
      if (accountsOff(e)) { onReady(null); return; }
      setError((e && e.message) || t('登录失败，请重试'));
    } finally { setBusy(false); }
  };
  const switchTab = (next) => { if (busy || tab === next) return; setTab(next); setError(''); onTabChange(next); };

  return html`<form class="title-auth" onSubmit=${submit}>
    <header class="title-auth__head">
      <${MicroLabel} tone="mint">STRONGHOLD ACCOUNT<//>
      <span class="title-auth__sub">${tab === 'login' ? t('登录后与全服玩家同服') : t('QQ 号不公开，昵称公开')}</span>
    </header>
    <div class="title-auth__tabs" role="tablist">
      <button type="button" role="tab" aria-selected=${tab === 'login'} class=${tab === 'login' ? 'is-on' : ''}
        onClick=${() => switchTab('login')}>${t('登录')}</button>
      <button type="button" role="tab" aria-selected=${tab === 'register'} class=${tab === 'register' ? 'is-on' : ''}
        onClick=${() => switchTab('register')}>${t('注册')}</button>
    </div>
    ${/* 注册时两列：QQ 号 | 昵称 ／ 密码 | 确认密码 —— 卡和标题页一样宽，两列让注册表单不会把标题顶出屏幕 */ ''}
    <div class=${`title-auth__grid${tab === 'register' ? ' is-two' : ''}`}>
      <${TextField} label=${t('QQ 号')} micro="不公开" value=${qq} maxLength=${14}
        placeholder=${t('5–12 位数字')} autoFocus=${autoFocus && tab === 'login'}
        onInput=${setQq} onEnter=${submit} />
      ${tab === 'register' ? html`<${TextField} label=${t('昵称')} micro="公开显示" value=${nickname} maxLength=${12}
        placeholder=${t('默认「博士」')} onInput=${setNickname} onEnter=${submit} />` : null}
      <${TextField} type="password" label=${t('密码')} value=${password} maxLength=${128}
        placeholder=${tab === 'login' ? t('输入密码') : t('至少 8 位')} onInput=${setPassword} onEnter=${submit} />
      ${tab === 'register' ? html`<${TextField} type="password" label=${t('确认密码')} value=${password2} maxLength=${128}
        placeholder=${t('再输一次')} onInput=${setPassword2} onEnter=${submit} />` : null}
    </div>
    ${tab === 'register' ? html`<label class="title-auth__agree">
      <input type="checkbox" checked=${agree} onChange=${(e) => setAgree(e.currentTarget.checked)} />
      <span>${t('我已阅读并同意')} <a href="/legal/terms.html" target="_blank" rel="noopener">${t('用户协议')}</a>
        ${t('与')} <a href="/legal/privacy.html" target="_blank" rel="noopener">${t('隐私政策')}</a></span>
    </label>` : null}
    <${Button} variant="primary" size="xl" block=${true} type="submit" loading=${busy}>
      ${busy ? t('请稍候…') : tab === 'login' ? t('登录') : t('注册并进入')}
    <//>
    <p class="title-auth__err">${error}</p>
    <p class="title-auth__hint">${t('忘了密码？请联系管理员报你的 QQ 号，由其重置。')}</p>
  </form>`;
}

/** 干员名册（chess 记录的数组）：data 里是对象表，这里统一成数组。 */
function chessList() {
  const raw = data.get('chess');
  if (!raw) return [];
  return Array.isArray(raw) ? raw : Object.values(raw);
}

/** charId → 名册里那条记录（优先非精英，cardOperators 已按稀有度排序）。 */
function chessOfCharId(charId) {
  if (!charId) return null;
  return chessList().find((c) => c && c.charId === charId && !c.isDiy) || null;
}

/** 立绘头像（avatarId = charId）：取干员立绘并按圆形裁切。 */
function AvatarImage({ charId, class: cls = 'spauth__avatar' }) {
  const m = data.get('assets');
  const chess = chessOfCharId(charId);
  const src = chess ? (chessAvatarUrl(m, chess) || chessPortraitUrl(m, chess)) : null;
  if (!src) return html`<span class=${`${cls} spauth__avatar--blank`}><${Icon} name="user" /><//>`;
  return html`<img class=${cls} src=${src} alt="" draggable=${false} />`;
}

/**
 * 立绘选择弹窗：列出可作头像的干员（复用 seatArt.cardOperators 的排序与去重）。
 * @param {{ open: boolean, current: string|null, onPick: (charId: string|null) => void, onClose: () => void }} props
 */
export function AvatarPicker({ open, current = null, currentSkin = null, onPick = () => {}, onClose = () => {} }) {
  ensureStyle();
  // 名册与美术清单是按需加载的：这个 hook 会把它们拉下来并在到位后重渲染（登录页阶段还没有数据）
  useData('chess', 'assets');
  // 两步选择（业主 2026-11-14：先选干员，再额外选款式，列出所有可选立绘）
  const [selOp, setSelOp] = useState(null);
  if (!open) return null;
  const m = data.get('assets');
  const base = cardOperators(chessList());
  const chars = (m && m.chars) || {};
  // 甄选干员（业主 2026-11-14「把甄选干员列表里的立绘拿过来，例如思衡托和 M3 这些」）：
  // 它们是 chess.json 里 visible: false 的干员（chess_zj_* / chess_char_9_*），有真实 charId + 立绘，
  // 只是被 cardOperators 的可见性过滤挡掉了。这里补进来（没立绘的跳过）。
  const seen = new Set(base.map((b) => b.charId));
  const zj = [];
  const diy = [];
  for (const c of chessList()) {
    if (!c || typeof c.charId !== 'string' || !c.charId) continue;
    if (seen.has(c.charId) || !chars[c.charId]) continue;
    seen.add(c.charId);
    if (c.isDiy) diy.push(c);
    else if (c.visible === false) zj.push(c);
  }
  const list = [...base, ...zj, ...diy];

  // 第二步：某个干员的全部立绘款式
  if (selOp) {
    const styles = avatarStyles(m, selOp);
    return html`<${Modal} open=${true} title=${`选择立绘 · ${selOp.name || selOp.charId}`} micro="AVATAR" onClose=${onClose}>
      <div class="spauth__back">
        <button type="button" class="spauth__backbtn" onClick=${() => setSelOp(null)}>← 返回干员列表</button>
      </div>
      <div class="spauth__styles-grid">
        ${styles.map((s) => html`<button type="button" key=${s.key || 'def'}
          class=${`spauth__style-card${selOp.charId === current && (currentSkin || '') === (s.key || '') ? ' is-on' : ''}`}
          onClick=${() => onPick(selOp.charId, s.key || null)}>
          <img src=${s.big || s.src} alt="" loading="lazy" draggable=${false} />
          <span><b>${s.label}</b><small>${s.tag}</small></span>
        </button>`)}
      </div>
    <//>`;
  }

  // 第一步：干员列表（点一个进入款式选择）
  return html`<${Modal} open=${true} title="选择头像立绘" micro="AVATAR" onClose=${onClose}>
    ${list.length ? html`<div class="spauth__avatars">
      ${list.slice(0, 160).map((c) => {
        const styles = avatarStyles(m, c);
        const picked = c.charId === current ? (currentSkin || '') : '';
        const active = styles.find((s) => s.key === picked) || styles[0];
        return html`<div class="spauth__op" key=${c.charId}>
          <button type="button" class=${`spauth__op-img${c.charId === current ? ' is-on' : ''}`}
            title=${c.name || c.charId}
            onClick=${() => setSelOp(c)}>
            ${active && active.src
              ? html`<img src=${active.src} alt="" loading="lazy" draggable=${false} />`
              : html`<span style="aspect-ratio:1/1"></span>`}
          </button>
          <span class="spauth__op-name">${c.name || c.charId}</span>
          <span class="spauth__stars" title=${`${c.rarity || 0} 星`}>${'★'.repeat(c.rarity || 0)}</span>
          <span class="spauth__op-count">${styles.length} 种立绘</span>
        </div>`;
      })}
    </div>` : html`<p style="color:#93a29c;font-size:13px;margin:8px 0">正在读取干员名册…</p>`}
  <//>`;
}

/** 一个干员可选的立绘样式：默认 / 精英 2 / 每套皮肤（业主 2026-11-14）。 */
function avatarStyles(m, c) {
  const out = [];
  const av = chessAvatarUrl(m, c);
  if (av) out.push({ key: '', label: '默认立绘', tag: '默认', src: av, big: chessPortraitUrl(m, c) || av });
  const ch = (m && m.chars && m.chars[c.charId]) || {};
  if (ch.avatarE2) out.push({ key: '__e2', label: '精英 2 立绘', tag: 'E2', src: ch.avatarE2, big: ch.portraitE2 || ch.avatarE2 });
  for (const [key, sk] of Object.entries(ch.skins || {})) {
    const src = sk && (sk.avatar || sk.portrait || sk.illust);
    if (src) out.push({ key, label: sk.name || key, tag: sk.group || '皮肤', src, big: sk.portrait || sk.illust || src });
  }
  return out;
}

/**
 * 标题页右上角的账号按钮：显示「昵称#tag」，点开可以改名 / 登出。
 * @param {{ account: any, onAccount?: (a: any) => void }} props
 */
export function AccountButton({ account, onAccount = () => {} }) {
  ensureStyle();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState(account || null);
  const [nick, setNick] = useState(account?.nickname || '');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  if (!me) return null;
  const doRename = async () => {
    if (busy) return;
    setBusy(true); setMsg('');
    try {
      const res = await accountApi.rename(nick.trim());
      setMe(res.account); onAccount(res.account); setMsg('已改名');
    } catch (e) {
      setMsg(e?.code === 'E_RENAME_COOLDOWN' ? (e.message || '改名冷却中') : (e?.message || '改名失败'));
    } finally { setBusy(false); }
  };
  const pickAvatar = async (charId, skin = null) => {
    setPicking(false);
    if (busy || (charId === me.avatarId && (skin || null) === (me.avatarSkin || null))) return;
    setBusy(true); setMsg('');
    try {
      const res = await accountApi.profile({ avatarId: charId, avatarSkin: skin });
      setMe(res.account); onAccount(res.account); setMsg('头像已更新');
    } catch (e) { setMsg(e?.message || '头像更新失败'); }
    finally { setBusy(false); }
  };
  const doLogout = async () => {
    if (busy) return;
    setBusy(true);
    try { await accountApi.logout(); } catch { /* 即使失败也刷新（cookie 端已清） */ }
    location.reload();
  };

  return html`<span>
    <button type="button" class="spauth__account" data-testid="title-account" title=${`${me.nickname}#${me.tag}`}
      onClick=${() => setOpen((v) => !v)}>
      <${AvatarImage} charId=${me.avatarId} /> ${me.nickname}<b>#${me.tag}</b>
    </button>
    ${open ? html`<div class="spauth__panel" onClick=${(e) => e.stopPropagation()}>
      <h4>账号</h4>
      <p>昵称 <b>${me.nickname}#${me.tag}</b>${me.qq ? html`<br />QQ 号 ${me.qq}（只有你和管理员看得到）` : null}</p>
      <div class="spauth__row" style="margin-bottom:10px">
        <button type="button" disabled=${busy} onClick=${() => setPicking(true)}>更换头像立绘</button>
      </div>
      <label class="spauth__field"><span>昵称（7 天可改一次）</span>
        <input value=${nick} maxlength=${12} onInput=${(e) => setNick(e.currentTarget.value)} />
      </label>
      <div class="spauth__row">
        <button class="primary" type="button" disabled=${busy || !nick.trim() || nick.trim() === me.nickname} onClick=${doRename}>改名</button>
        <button type="button" disabled=${busy} onClick=${() => setOpen(false)}>关闭</button>
      </div>
      <div class="spauth__row" style="margin-top:8px">
        <button type="button" disabled=${busy} onClick=${doLogout}>退出登录</button>
      </div>
      <p class="spauth__err">${msg}</p>
    </div>` : null}
    <${AvatarPicker} open=${picking} current=${me.avatarId} currentSkin=${me.avatarSkin} onPick=${pickAvatar} onClose=${() => setPicking(false)} />
  </span>`;
}
