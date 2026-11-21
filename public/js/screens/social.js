// public/js/screens/social.js — 好友 / 黑名单 / 邀请（账号系统第二期）的客户端界面。
//
// 口径（业主 2026-11-14）：好友要「添加/同意/列表/邀请进房」+ 黑名单 + 在线状态（绿点）。
// QQ 号不公开：加好友时输入框接受 **QQ 号** 或 **昵称#tag**（前者用于你知道对方 QQ 的场合），
// 服务端返回的永远只有公开身份（昵称#tag）。
//
// 入口：标题页右上角「好友」按钮（与账号按钮并列）；面板里四个页签：好友 / 请求 / 添加 / 黑名单。
// 邀请：收到好友邀请时弹一个轻量浮层（标题页或大厅都会看到），点「加入」直接进房。
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, MicroLabel } from '../ui/components.js';
import { net } from '../net.js';
import { store } from '../store.js';
import { data, useData } from '../data.js';
import { chessAvatarUrl, chessPortraitUrl } from '../ui/assetUrls.js';
import { NameCardLayer } from '../ui/namecards.js';

const CSS = `
.soc__btn{position:relative;display:inline-flex;align-items:center;gap:6px;height:max(.36rem,1.9em);padding:0 .14rem;
  font-size:calc(.15 * var(--t));font-weight:700;color:#c8e9de;background:#0d1413;border:1px solid #24312c;border-radius:.05rem;cursor:pointer}
.soc__btn b{color:#17d9a0}
.soc__dot{position:absolute;top:-3px;right:-3px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:#ff5454;
  color:#fff;font:700 10px/14px "Microsoft YaHei",sans-serif;text-align:center}
.soc{position:fixed;inset:0;z-index:2147483002;display:flex;align-items:center;justify-content:center;background:rgba(3,6,5,.62);
  font-family:"Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;color:#e6ece9;padding:20px}
.soc__card{width:min(560px,100%);max-height:82vh;display:flex;flex-direction:column;background:linear-gradient(180deg,#101614,#0b1110);
  border:1px solid #24312c;border-radius:10px;box-shadow:0 30px 80px -40px #000;overflow:hidden}
.soc__head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;border-bottom:1px solid #1c2622}
.soc__head h3{margin:0;font-size:15px;letter-spacing:.06em}
.soc__head .soc__x{padding:4px 10px;font-size:12px;color:#93a29c;background:#131a18;border:1px solid #24312c;border-radius:6px;cursor:pointer}
.soc__tabs{display:flex;gap:6px;padding:10px 16px 0}
.soc__tabs button{flex:1;padding:7px 8px;font-size:12.5px;font-weight:700;color:#93a29c;background:#0e1413;border:1px solid #24312c;border-radius:6px;cursor:pointer}
.soc__tabs button.is-on{color:#06110d;background:linear-gradient(180deg,#6bf7cd,#17d9a0);border-color:#17d9a0}
.soc__body{padding:12px 16px 16px;overflow:auto}
.soc__row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #18211e}
.soc__row:last-child{border-bottom:0}
.soc__who{flex:1;min-width:0}
.soc__who b{font-weight:700}
.soc__who span{color:#17d9a0;font-weight:700}
.soc__who small{display:block;color:#6f7f79;font-size:11px}
.soc__online{width:8px;height:8px;border-radius:50%;background:#3a4642;flex:none}
.soc__online.is-on{background:#3ddc97;box-shadow:0 0 6px #3ddc97}
.soc__act{display:flex;gap:6px}
.soc__act button{padding:5px 9px;font-size:11.5px;font-weight:700;color:#c8d6d0;background:#131a18;border:1px solid #24312c;border-radius:5px;cursor:pointer}
.soc__act button.pri{color:#06110d;background:linear-gradient(180deg,#6bf7cd,#17d9a0);border-color:#17d9a0}
.soc__act button.danger{color:#ff8a7a;border-color:#4a2a26}
.soc__empty{padding:22px 0;text-align:center;color:#6f7f79;font-size:12.5px}
/* 好友列表里的干员立绘头像（业主 2026-11-14：好友资料用立绘头像 + 名片） */
.soc__ava{width:36px;height:36px;border-radius:50%;object-fit:cover;object-position:50% 12%;flex:none;
  background:#0a1210;border:1px solid #24312c}
.soc__ava--blank{display:inline-grid;place-items:center;color:#4d5c56;font-weight:800;font-size:14px}
.soc__rowbtn{display:flex;align-items:center;gap:10px;flex:1;min-width:0;background:none;border:0;padding:0;color:inherit;
  font:inherit;text-align:left;cursor:pointer}
.soc__rowbtn:hover .soc__who b{color:#17d9a0}
/* 管理员金标（业主 2026-11-14） */
.soc__ava-wrap{position:relative;display:inline-flex;flex:none;align-items:center}
.soc__admin-badge{position:absolute;top:-5px;right:-5px;display:grid;place-items:center;width:16px;height:16px;
  border-radius:50%;background:linear-gradient(180deg,#ffe08a,#d9a520);color:#3a2a00;font-size:10px;font-style:normal;
  font-weight:900;line-height:1;border:1px solid #fff3c4;box-shadow:0 0 8px rgba(242,201,76,.65);z-index:2}
.soc__ava-wrap--lg .soc__admin-badge{width:20px;height:20px;font-size:12px;top:-6px;right:-6px}
/* 管理员的**名字**也是金色（业主 2026-11-14）；标签 #tag 保持薄荷绿。
   选择器写得比 .soc__rowbtn:hover .soc__who b 更具体，免用 !important。 */
.soc .soc__who b.is-admin,
.soc .soc-card2__who b.is-admin,
.socinvite .socinvite__who b.is-admin{color:#f2c94c;text-shadow:0 0 10px rgba(242,201,76,.45)}
.soc .soc__who b.is-admin span,
.soc .soc-card2__who b.is-admin span,
.socinvite .socinvite__who b.is-admin span{color:#17d9a0}
.soc__cardtiny{width:52px;height:20px;border-radius:3px;overflow:hidden;flex:none;border:1px solid #24312c;opacity:.9}
.soc__cardtiny > *{transform:scale(.19);transform-origin:0 0;width:274px;height:105px}
/* 邀请好友浮窗（好友列表版，业主 2026-11-14）：页面内居中小窗 + 浅遮罩 */
.socinvite{position:fixed;inset:0;z-index:2147483004;display:flex;align-items:center;justify-content:center;
  background:rgba(3,6,5,.5);font-family:"Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;animation:socFade .16s ease-out}
@keyframes socFade{from{opacity:0}}
.socinvite__box--list{width:min(720px,94vw);max-height:min(76vh,600px);display:flex;flex-direction:column;
  background:linear-gradient(180deg,#151d1a,#0a100e);border:1px solid #2b3f38;border-radius:12px;overflow:hidden;
  box-shadow:0 30px 80px -30px #000,0 0 0 1px rgba(23,217,160,.08) inset;color:#e6ece9}
.socinvite__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px 12px;
  border-bottom:1px solid #1b2724;background:linear-gradient(180deg,rgba(23,217,160,.07),transparent)}
.socinvite__titles b{display:block;font-size:16px;font-weight:900;letter-spacing:.04em}
.socinvite__titles small{display:block;margin-top:4px;font-size:11.5px;color:#7d8f88;line-height:1.5}
.socinvite__x{width:28px;height:28px;flex:none;padding:0;border:1px solid #2b3f38;border-radius:6px;
  background:rgba(10,15,14,.9);color:#c8d6d0;font-size:16px;line-height:1;cursor:pointer}
.socinvite__x:hover{border-color:#17d9a0;color:#17d9a0}
.socinvite__list{flex:1 1 auto;min-height:0;overflow:auto;padding:12px}
/* 一行两个好友，每个好友铺一张完整名片做底；比例同名片 entry（638×223） */
.socinvite__grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.socinvite__friend{position:relative;aspect-ratio:638 / 223;height:auto;border-radius:8px;overflow:hidden;
  border:1px solid #24312c;background:#0a100e;transition:border-color .15s,box-shadow .15s}
.socinvite__friend:hover{border-color:rgba(23,217,160,.5);box-shadow:0 0 0 1px rgba(23,217,160,.18) inset}
.socinvite__nc{position:absolute;inset:0}
.socinvite__nc > *{width:100%;height:100%}
.socinvite__meta{position:relative;z-index:1;display:flex;align-items:center;gap:8px;height:100%;padding:10px;
  background:linear-gradient(90deg,rgba(5,8,7,.88),rgba(5,8,7,.55) 58%,rgba(5,8,7,.22))}
.socinvite__ava-wrap{position:relative;flex:none}
.socinvite__dot{position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;border-radius:50%;
  border:2px solid #0a100e;background:#3a4642}
.socinvite__dot.is-on{background:#3ddc97;box-shadow:0 0 6px #3ddc97}
.socinvite__who{flex:1;min-width:0}
.socinvite__who b{display:block;font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.socinvite__who b span{color:#17d9a0;margin-left:3px}
.socinvite__who small{display:block;margin-top:3px;font-size:10.5px;color:#6f7f79}
.socinvite__who small.is-on{color:#3ddc97}
.socinvite__btn{padding:7px 16px;font-size:12.5px;font-weight:800;color:#06110d;border:0;border-radius:6px;cursor:pointer;
  background:linear-gradient(180deg,#6bf7cd,#17d9a0);white-space:nowrap}
.socinvite__btn--sm{padding:6px 11px;font-size:11.5px}
.socinvite__btn:disabled{opacity:.35;cursor:not-allowed;filter:grayscale(.5);background:#2a3632;color:#8fa39b}
.socinvite__empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:34px 0;color:#6f7f79;font-size:12.5px;text-align:center}
.socinvite__empty .icon{width:30px;height:30px;opacity:.5}
.socinvite__empty small{font-size:11px;color:#5a6a64}
.socinvite__msg{min-height:16px;margin:0;padding:0 18px 12px;font-size:11.5px;color:#3ddc97}

.soc__find{display:flex;gap:8px;margin-bottom:10px}
.soc__find input{flex:1;padding:9px 11px;font-size:13px;color:#e6ece9;background:#0a0f0e;border:1px solid #24312c;border-radius:6px;outline:none}
.soc__find button{padding:0 14px;font-size:12.5px;font-weight:700;color:#06110d;background:linear-gradient(180deg,#6bf7cd,#17d9a0);border:0;border-radius:6px;cursor:pointer}
.soc__msg{min-height:16px;margin:8px 0 0;font-size:12px;color:#ff8a7a}
/* 被邀请端弹窗（业主 2026-11-15「放大」）：300×12px 太小，看不清谁邀请、房间号也小。
   放大到 440 宽、正文 16px、按钮 15px，右上角加一条薄荷绿高亮条，远一点也能注意到。 */
.socinv{position:fixed;right:24px;bottom:24px;z-index:2147483003;width:440px;max-width:calc(100vw - 48px);
  padding:18px 20px;background:#0d1312;border:1px solid #2f6d5b;border-left:3px solid #17d9a0;
  border-radius:10px;box-shadow:0 24px 60px -18px #000,0 0 0 1px rgba(23,217,160,.16);
  color:#e6ece9;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}
.socinv p{margin:0 0 14px;font-size:16px;line-height:1.65}
.socinv p b{font-size:18px}
.socinv b{color:#17d9a0}
.socinv .row{display:flex;gap:10px}
.socinv button{flex:1;padding:11px;font-size:15px;font-weight:700;border-radius:8px;cursor:pointer;
  border:1px solid #24312c;background:#131a18;color:#c8d6d0}
.socinv button.pri{background:linear-gradient(180deg,#6bf7cd,#17d9a0);color:#06110d;border-color:#17d9a0}
/* ---- 好友面板美化（业主 2026-11-14：这个太单调了）--------------------------
   暗色科技风 + 薄荷绿点缀：面板圆角/内发光、标签胶囊化、行悬停高亮、空状态带图标。 */
.soc{background:radial-gradient(900px 520px at 50% 0%,rgba(23,217,160,.09),transparent 62%),rgba(3,6,5,.72);
}
.soc__card{width:min(720px,94vw);max-height:84vh;border:1px solid #2b3f38;border-radius:14px;
  background:linear-gradient(180deg,#141c19,#090f0d);overflow:hidden;
  box-shadow:0 40px 100px -40px #000,0 0 0 1px rgba(23,217,160,.06) inset}
.soc__head{padding:16px 20px 12px;background:linear-gradient(180deg,rgba(23,217,160,.09),transparent);
  border-bottom:1px solid #1b2724}
.soc__head b{font-size:16px;font-weight:900;letter-spacing:.06em}
.soc__x{padding:6px 12px;font-size:12px;font-weight:700;color:#93a29c;background:rgba(10,15,14,.8);
  border:1px solid #2b3f38;border-radius:6px;cursor:pointer}
.soc__x:hover{color:#17d9a0;border-color:#17d9a0}
.soc__tabs{gap:6px;padding:12px 20px 0}
.soc__tabs button{height:34px;font-size:12.5px;color:#93a29c;background:rgba(8,12,10,.7);
  border:1px solid #223029;border-radius:8px;transition:all .15s}
.soc__tabs button:hover{color:#c8e9de;border-color:#2e4a40}
.soc__tabs button.is-on{color:#06110d;background:linear-gradient(180deg,#6bf7cd,#17d9a0);border-color:#17d9a0;
  box-shadow:0 0 16px -4px rgba(23,217,160,.6)}
.soc__body{padding:14px 20px 20px;overflow:auto;flex:1;min-height:0}
.soc__row{padding:10px;border:1px solid transparent;border-radius:10px;transition:background .15s,border-color .15s;border-bottom:1px solid transparent}
.soc__row:hover{background:rgba(23,217,160,.055);border-color:rgba(23,217,160,.16)}
.soc__who b{font-size:14px;font-weight:800}
.soc__who small{font-size:11px}
.soc__empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  padding:44px 0;color:#6f7f79;font-size:12.5px;line-height:1.7;text-align:center}
.soc__find input{height:36px}
.soc__find button{padding:0 16px;height:36px}
.soc__msg{font-size:11.5px}
/* 好友卡片：两列 + 完整名片（业主 2026-11-14）。卡片比例跟名片主图 entry 一致（638×223），
   否则名片会被裁/留白，看起来不协调（业主：「卡片大小要和名片一致」）。 */
.soc__grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.soc-card2{position:relative;aspect-ratio:638 / 223;height:auto;border-radius:10px;overflow:hidden;
  border:1px solid #24312c;background:#0a100e;transition:border-color .15s,box-shadow .15s}
.soc-card2:hover{border-color:rgba(23,217,160,.5);box-shadow:0 0 0 1px rgba(23,217,160,.18) inset}
.soc-card2__nc{position:absolute;inset:0}
.soc-card2__nc > *{width:100%;height:100%}
.soc-card2__meta{position:relative;z-index:1;height:100%;padding:12px;display:flex;align-items:flex-end;
  background:linear-gradient(180deg,rgba(5,8,7,.04),rgba(5,8,7,.5) 58%,rgba(5,8,7,.93))}
.soc-card2__open{display:flex;align-items:center;gap:10px;width:100%;padding:0;border:0;background:none;color:inherit;
  font:inherit;text-align:left;cursor:pointer}
.soc-card2__who{flex:1;min-width:0}
.soc-card2__who b{display:block;font-size:13.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  text-shadow:0 1px 4px rgba(0,0,0,.85)}
.soc-card2__who b span{color:#17d9a0;margin-left:3px}
.soc-card2__who small{display:block;margin-top:3px;font-size:10.5px;color:#93a29c}
.soc-card2__who small.is-on{color:#3ddc97}
.soc-card2__acts{position:absolute;right:8px;bottom:8px;z-index:2;display:flex;gap:6px}
.soc-card2__acts button{padding:5px 9px;font-size:11px;font-weight:700;color:#c8d6d0;background:rgba(10,15,14,.85);
  border:1px solid #2b3f38;border-radius:5px;cursor:pointer;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}
.soc-card2__acts button.pri{color:#06110d;background:linear-gradient(180deg,#6bf7cd,#17d9a0);border-color:#17d9a0}
.soc-card2__acts button.danger{color:#ff8a7a;border-color:#4a2a26}

/* 大厅/房间里的悬浮入口（标题页自己有角落按钮，别重复） */
.social-dock{position:fixed;right:calc(var(--t, 1rem) * .35);top:calc(var(--t, 1rem) * .35);z-index:60;display:flex;gap:.06rem}
`;

function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById('sp-social-style')) return;
  const st = document.createElement('style');
  st.id = 'sp-social-style';
  st.textContent = CSS;
  document.head.append(st);
}

/** 供 UI 调用的小客户端（错误统一抛出带 code 的 Error）。 */
async function api(path, body) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  if (!res.ok || !json || json.ok === false) {
    const err = new Error((json && json.message) || '请求失败');
    err.code = (json && json.error) || 'E_HTTP';
    throw err;
  }
  return json;
}

const online = (a) => !!a && a.online === true;

/** 多久前在线（业主 2026-11-14「加上好友多久前在线」）。 */
function lastSeenText(a) {
  if (!a) return '未知';
  if (online(a)) return '在线';
  const t = Number(a.lastSeenAt) || 0;
  if (!t) return '从未登录';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚在线';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} 个月前`;
  return `${Math.floor(mo / 12)} 年前`;
}

/** 干员名册（chess 记录的数组）。 */
function chessList() {
  const raw = data.get('chess');
  if (!raw) return [];
  return Array.isArray(raw) ? raw : Object.values(raw);
}
/** charId → 名册里那条记录（优先非精英）。 */
function chessOfCharId(charId) {
  if (!charId) return null;
  return chessList().find((c) => c && c.charId === charId && !c.isDiy) || null;
}

/** 好友头像：干员立绘（avatarId = charId，avatarSkin = 立绘样式），没有立绘时显示昵称首字。
 *  管理员（admin）头像右上角带金色徽章（业主 2026-11-14）。 */
function FriendAvatar({ avatarId, avatarSkin = null, name = '', large = false, admin = false }) {
  useData('chess', 'assets'); // 名册与美术清单按需加载，到位后重渲染
  const m = data.get('assets');
  const chess = chessOfCharId(avatarId);
  const src = chess ? (chessAvatarUrl(m, chess, { skin: avatarSkin }) || chessPortraitUrl(m, chess, { skin: avatarSkin })) : null;
  const cls = large ? 'socinvite__ava' : 'soc__ava';
  return html`<span class=${`soc__ava-wrap${large ? ' soc__ava-wrap--lg' : ''}`}>
    ${src
      ? html`<img class=${cls} src=${src} alt="" loading="lazy" />`
      : html`<span class=${`${cls} soc__ava--blank`}>${[...String(name || '?')][0] || '?'}</span>`}
    ${admin ? html`<i class="soc__admin-badge" title="管理员">★</i>` : null}
  </span>`;
}

/** 一行好友/请求/黑名单。`onOpen` 有值时名字区域可点（打开邀请浮窗）。 */
function Row({ a, children, onOpen = null }) {
  const main = html`<${FriendAvatar} avatarId=${a.avatarId} avatarSkin=${a.avatarSkin} name=${a.nickname} admin=${a.admin} />
    <span class="soc__who"><b class=${a.admin ? 'is-admin' : ''}>${a.nickname || '?'}</b><span>#${a.tag || '----'}</span>
      <small>${online(a) ? '在线' : '离线'}</small></span>`;
  return html`<div class="soc__row">
    <span class=${`soc__online${online(a) ? ' is-on' : ''}`} title=${online(a) ? '在线' : '离线'}></span>
    ${onOpen
      ? html`<button type="button" class="soc__rowbtn" onClick=${onOpen} title="查看资料并邀请">${main}</button>`
      : html`<span class="soc__rowbtn">${main}</span>`}
    <span class="soc__act">${children}</span>
  </div>`;
}

/** 好友卡片（业主 2026-11-14：好友面板也要两列 + 完整名片）。 */
function FriendCard({ a, children, onOpen = null }) {
  const main = html`<${FriendAvatar} avatarId=${a.avatarId} avatarSkin=${a.avatarSkin} name=${a.nickname} admin=${a.admin} />
    <span class="soc-card2__who"><b class=${a.admin ? 'is-admin' : ''}>${a.nickname || '?'}<span>#${a.tag || '----'}</span></b>
      <small class=${online(a) ? 'is-on' : ''}>${online(a) ? '● 在线' : `○ ${lastSeenText(a)}`}</small></span>`;
  return html`<div class="soc-card2">
    <div class="soc-card2__nc" aria-hidden="true"><${NameCardLayer} card=${a.cardId || null} variant=${a.cardVariant} /></div>
    <div class="soc-card2__meta">
      ${onOpen ? html`<button type="button" class="soc-card2__open" onClick=${onOpen}>${main}</button>` : main}
    </div>
    <div class="soc-card2__acts">${children}</div>
  </div>`;
}

/**
 * 邀请好友浮窗（业主 2026-11-14）：**好友列表**形式 —— 列出全部好友，每人一颗「邀请」，
 * 离线好友按钮禁用。页面内的小窗，不是全屏页。
 */
export function InviteDialog({ friends = [], roomCode = null, onClose = () => {}, onInvited = () => {} }) {
  ensureStyle();
  useData('namecards', 'chess', 'assets'); // 名片底图与立绘
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState('');
  const invite = async (f) => {
    if (!roomCode || !online(f) || busyId) return;
    setBusyId(f.id); setMsg('');
    try {
      await api('/api/social/invite', { id: f.id, code: roomCode });
      setMsg(`已邀请 ${f.nickname}，等对方在弹窗里点「加入」`);
      onInvited(f);
    } catch (e) { setMsg(e.message || '邀请失败'); }
    finally { setBusyId(null); }
  };
  const onlineFriends = friends.filter(online).length;
  return html`<div class="socinvite" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="socinvite__box socinvite__box--list" role="dialog" aria-label="邀请好友">
      <header class="socinvite__head">
        <div class="socinvite__titles">
          <b>邀请好友</b>
          <small>${roomCode
            ? `选择一位在线好友，邀请他加入当前同盟 · ${onlineFriends}/${friends.length} 人在线`
            : '要先进入一个同盟房间才能邀请好友'}</small>
        </div>
        <button type="button" class="socinvite__x" onClick=${onClose} aria-label="关闭">×</button>
      </header>
      <div class="socinvite__list">
        ${friends.length ? html`<div class="socinvite__grid">
          ${friends.map((f) => html`<div class="socinvite__friend" key=${f.id}>
            <div class="socinvite__nc" aria-hidden="true"><${NameCardLayer} card=${f.cardId || null} variant=${f.cardVariant} /></div>
            <div class="socinvite__meta">
              <span class="socinvite__ava-wrap">
                <${FriendAvatar} avatarId=${f.avatarId} avatarSkin=${f.avatarSkin} name=${f.nickname} admin=${f.admin} />
                <span class=${`socinvite__dot${online(f) ? ' is-on' : ''}`}></span>
              </span>
              <span class="socinvite__who">
                <b class=${f.admin ? 'is-admin' : ''}>${f.nickname || '?'}<span>#${f.tag || '----'}</span></b>
                <small class=${online(f) ? 'is-on' : ''}>${online(f) ? '● 在线' : `○ ${lastSeenText(f)}`}</small>
              </span>
              <button type="button" class="socinvite__btn socinvite__btn--sm"
                disabled=${!roomCode || !online(f) || busyId === f.id}
                onClick=${() => invite(f)}>
                ${busyId === f.id ? '邀请中…' : (online(f) ? '邀请' : '不在线')}
              </button>
            </div>
          </div>`)}
        </div>` : html`<div class="socinvite__empty">
          <${Icon} name="users" />
          <p>还没有好友<br /><small>先在「添加」页按 QQ 号或「昵称#1234」加好友</small></p>
        </div>`}
      </div>
      <p class="socinvite__msg">${msg}</p>
    </div>
  </div>`;
}

/**
 * 好友面板。
 * @param {{ onClose: () => void, roomCode?: string|null }} props  roomCode 有值时好友行会多一个「邀请进房」
 */
export function SocialPanel({ onClose = () => {}, roomCode = null }) {
  ensureStyle();
  const [tab, setTab] = useState('friends');
  const [inviteOpen, setInviteOpen] = useState(false);   // 点好友行 → 打开邀请列表浮窗
  const [data, setData] = useState({ friends: [], requests: [], sent: [], blocked: [] });
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    try { const r = await api('/api/social'); setData({ friends: r.friends || [], requests: r.requests || [], sent: r.sent || [], blocked: r.blocked || [] }); }
    catch (e) { setMsg(e.message); }
  };
  useEffect(() => {
    load();
    // 好友页数据要「活着」：面板开着时每 8 秒刷一次（在线状态、待处理请求都会变）
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, []);

  const run = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true); setMsg('');
    try { await fn(); await load(); if (okMsg) setMsg(okMsg); }
    catch (e) { setMsg(e.message || '操作失败'); }
    finally { setBusy(false); }
  };

  const doFind = async () => {
    // 读 DOM 里的当前值：点「查找」与输入只隔一个 tick，闭包里的 q 可能还是旧值
    const box = document.querySelector('.soc__find input');
    const needle = String((box && box.value) || q || '').trim();
    if (!needle) return;
    setBusy(true); setMsg('');
    try {
      const r = await api('/api/social/find?q=' + encodeURIComponent(needle));
      setFound(r.accounts || []);
      if (!(r.accounts || []).length) setMsg('没找到这个人。可以输入对方的 QQ 号，或「昵称#1234」。');
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  const friends = data.friends;
  const requests = data.requests;
  const blocked = data.blocked;
  const sent = data.sent;

  return html`<div class="soc" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="soc__card" role="dialog" aria-label="好友">
      <div class="soc__head">
        <h3>好友 <${MicroLabel} tone="mint">FRIENDS</${MicroLabel}></h3>
        <button class="soc__x" type="button" onClick=${onClose}>关闭</button>
      </div>
      <div class="soc__tabs">
        <button type="button" class=${tab === 'friends' ? 'is-on' : ''} onClick=${() => setTab('friends')}>好友 (${friends.length})</button>
        <button type="button" class=${tab === 'requests' ? 'is-on' : ''} onClick=${() => setTab('requests')}>请求 (${requests.length})</button>
        <button type="button" class=${tab === 'add' ? 'is-on' : ''} onClick=${() => setTab('add')}>添加</button>
        <button type="button" class=${tab === 'blocked' ? 'is-on' : ''} onClick=${() => setTab('blocked')}>黑名单 (${blocked.length})</button>
      </div>
      <div class="soc__body">
        ${tab === 'friends' ? (friends.length ? html`<div class="soc__grid">
          ${friends.map((a) => html`<${FriendCard} a=${a} onOpen=${() => setInviteOpen(true)}>
            ${roomCode ? html`<button class="pri" type="button" disabled=${busy || !online(a)}
              onClick=${() => run(() => api('/api/social/invite', { id: a.id, code: roomCode }), `已邀请 ${a.nickname}`)}>邀请</button>` : null}
            <button class="danger" type="button" disabled=${busy} onClick=${() => run(() => api('/api/social/remove', { id: a.id }), '已删除好友')}>删除</button>
            <button type="button" disabled=${busy} onClick=${() => run(() => api('/api/social/block', { id: a.id }), '已加入黑名单')}>拉黑</button>
          <//>`)}
        </div>` : html`<div class="soc__empty">还没有好友<br /><small>切到「添加」，输入对方的 QQ 号或「昵称#1234」</small></div>`) : null}

        ${tab === 'requests' ? (requests.length ? requests.map((a) => html`<${Row} a=${a}>
          <button class="pri" type="button" disabled=${busy} onClick=${() => run(() => api('/api/social/accept', { id: a.id }), '已添加为好友')}>同意</button>
          <button type="button" disabled=${busy} onClick=${() => run(() => api('/api/social/reject', { id: a.id }), '已拒绝')}>拒绝</button>
        <//>`) : html`<p class="soc__empty">没有待处理的好友请求${sent.length ? `（你发出去 ${sent.length} 个，等对方同意）` : ''}。</p>`) : null}

        ${tab === 'add' ? html`<div class="soc__find">
          <input value=${q} placeholder="QQ 号 或 昵称#1234" onInput=${(e) => setQ(e.currentTarget.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter') doFind(); }} />
          <button type="button" disabled=${busy} onClick=${doFind}>查找</button>
        </div>
        ${found === null ? html`<p class="soc__empty">输入对方的 QQ 号，或直接输入「昵称#1234」精确查找。</p>`
          : (found.length ? found.map((a) => html`<${Row} a=${a}>
              <button class="pri" type="button" disabled=${busy} onClick=${() => run(() => api('/api/social/request', { id: a.id }), '好友请求已发出')}>加好友</button>
            <//>`) : html`<p class="soc__empty">没有匹配到人。</p>`)}` : null}

        ${tab === 'blocked' ? (blocked.length ? blocked.map((a) => html`<${Row} a=${a}>
          <button type="button" disabled=${busy} onClick=${() => run(() => api('/api/social/unblock', { id: a.id }), '已解除拉黑')}>解除拉黑</button>
        <//>`) : html`<p class="soc__empty">黑名单是空的。</p>`) : null}

        <p class="soc__msg">${msg}</p>
      </div>
    </div>
    ${inviteOpen ? html`<${InviteDialog} friends=${friends} roomCode=${roomCode} onClose=${() => setInviteOpen(false)} />` : null}
  </div>`;
}

/**
 * 标题页/大厅的「好友」按钮（带待处理请求数）。`roomCode` 有值时面板里出现「邀请进房」。
 * @param {{ roomCode?: string|null }} props
 */
export function SocialButton({ roomCode = null } = {}) {
  ensureStyle();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  const refresh = async () => {
    try { const r = await api('/api/social'); setCount((r.requests || []).length); } catch { /* 未登录/离线忽略 */ }
  };
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20000);       // 轻量轮询：好友页数据只在打开时全量拉
    const onReq = () => refresh();
    try { net.on('social.request', onReq); net.on('social.accepted', onReq); } catch { /* ignore */ }
    // 消息中心里的「查看好友」按钮走这个事件（业主 2026-11-21）：用户可能不在标题页
    const onOpen = () => setOpen(true);
    try { window.addEventListener('sp:open-social', onOpen); } catch { /* ignore */ }
    return () => { clearInterval(id); try { window.removeEventListener('sp:open-social', onOpen); } catch { /* ignore */ } };
  }, []);

  return html`<span>
    <button type="button" class="soc__btn" data-testid="title-social" onClick=${() => setOpen(true)}>
      <${Icon} name="users" /> 好友${count ? html`<b>${count}</b>` : null}${count ? html`<i class="soc__dot">${count}</i>` : null}
    </button>
    ${open ? html`<${SocialPanel} roomCode=${roomCode} onClose=${() => { setOpen(false); refresh(); }} />` : null}
  </span>`;
}

/**
 * 好友邀请浮层（收到 social.invite 时出现）：点「加入」按房间号进房。
 * 用原生 DOM 渲染，任何界面（标题页/大厅/房间）都能出现，不依赖 Preact 树。
 */
export function installSocialInvites() {
  if (typeof document === 'undefined' || !net || typeof net.on !== 'function') return () => {};
  const onInvite = (msg) => {
    const code = msg && typeof msg.code === 'string' ? msg.code : '';
    const from = (msg && msg.from) || {};
    if (!code) return;
    const el = document.createElement('div');
    el.className = 'socinv';
    el.innerHTML = `<p><b>${escapeHtml(from.nickname || '好友')}#${escapeHtml(String(from.tag || ''))}</b>
      邀请你加入模拟 <b>${escapeHtml(code)}</b></p>
      <div class="row"><button class="pri" type="button">加入</button><button type="button">忽略</button></div>`;
    const close = () => el.remove();
    el.querySelector('.pri').addEventListener('click', () => { close(); location.href = `/?room=${encodeURIComponent(code)}`; });
    el.querySelectorAll('button')[1].addEventListener('click', close);
    document.body.append(el);
    setTimeout(close, 30000);
  };
  const onAccepted = (msg) => {
    const by = (msg && msg.by) || {};
    try {
      const el = document.createElement('div');
      el.className = 'socinv';
      el.innerHTML = `<p><b>${escapeHtml(by.nickname || '')}#${escapeHtml(String(by.tag || ''))}</b> 同意了你的好友请求。</p>`;
      document.body.append(el);
      setTimeout(() => el.remove(), 6000);
    } catch { /* ignore */ }
  };
  net.on('social.invite', onInvite);
  net.on('social.accepted', onAccepted);
  return () => { /* net.off 不一定存在；这里只在页面生命周期内注册一次 */ };
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { api as socialApi };
