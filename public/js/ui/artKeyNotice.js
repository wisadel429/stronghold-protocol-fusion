// public/js/ui/artKeyNotice.js — 「资源密钥没拿到」的持久提示（业主 2026-11-15）。
//
// 背景：美术资源是加密落盘的（server/http/artLock.js），密钥由服务端在启动时向主服务器领取。
//       如果领不到（断网 / 服务器维护），加密资源会变成破图 —— 以前玩家只看到一片裂图，不知道为什么。
//
// 这个模块挂在 buildGuard 的 onHealth 上：`/healthz.artKey === 'missing'` 就显示一条醒目提示，
// 变成 'ok' 就自动收掉。用原生 DOM，不依赖 Preact 树，标题页 / 大厅 / 房间 / 对局里都能出现。

const ID = 'sp-artkey-notice';

function ensureStyle() {
  if (document.getElementById(`${ID}-style`)) return;
  const st = document.createElement('style');
  st.id = `${ID}-style`;
  st.textContent = `
#${ID}{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483005;
  display:flex;align-items:center;gap:12px;max-width:min(680px,92vw);padding:12px 16px;
  background:#1a1206;border:1px solid #b8860b;border-left:4px solid #f2c94c;border-radius:10px;
  box-shadow:0 18px 50px -16px #000,0 0 0 1px rgba(242,201,76,.18);
  color:#f4e7c8;font:13px/1.55 "Noto Sans SC","Microsoft YaHei",sans-serif}
#${ID} .ak-ico{flex:none;width:22px;height:22px;display:grid;place-items:center;border-radius:50%;
  background:#f2c94c;color:#231a03;font-weight:900;font-size:14px}
#${ID} .ak-body{flex:1;min-width:0}
#${ID} .ak-title{font-weight:800;color:#f2c94c;margin:0 0 2px}
#${ID} .ak-sub{margin:0;color:#d8cba8}
#${ID} .ak-btn{flex:none;padding:6px 12px;border-radius:6px;cursor:pointer;
  border:1px solid #b8860b;background:#2a1e08;color:#f2c94c;font:600 12px/1 inherit}
#${ID} .ak-btn:hover{background:#3a2909;color:#fff}
@media (max-width:560px){#${ID}{flex-wrap:wrap}}
`;
  document.head.appendChild(st);
}

/**
 * 根据 /healthz 的结果显示或收起提示。
 * @param {'ok'|'missing'|null|undefined} status
 * @param {{ retry?: () => void }} [opts] retry：点「重试」时做什么（默认调 /healthz 再判断一次）
 */
export function updateArtKeyNotice(status, opts = {}) {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(ID);
  if (status !== 'missing') {
    if (existing) existing.remove();
    return;
  }
  if (existing) return; // 已经在显示，不重复插

  ensureStyle();
  const box = document.createElement('div');
  box.id = ID;
  box.setAttribute('role', 'alert');

  const ico = document.createElement('span');
  ico.className = 'ak-ico';
  ico.textContent = '!';

  const body = document.createElement('div');
  body.className = 'ak-body';
  const title = document.createElement('p');
  title.className = 'ak-title';
  title.textContent = '资源密钥未获取，部分图片显示不出来';
  const sub = document.createElement('p');
  sub.className = 'ak-sub';
  sub.textContent = '游戏需要联网向主服务器领取一次资源密钥。请检查网络后点「重试」，或重启游戏。';
  body.appendChild(title);
  body.appendChild(sub);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ak-btn';
  btn.textContent = '重试';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '检查中…';
    try {
      if (opts.retry) await opts.retry();
      else {
        const r = await fetch('/healthz', { cache: 'no-store' });
        const j = await r.json();
        updateArtKeyNotice(j?.artKey);
      }
    } catch { /* 还是连不上：保持提示 */ }
    if (document.body.contains(btn)) { btn.disabled = false; btn.textContent = '重试'; }
  });

  box.appendChild(ico);
  box.appendChild(body);
  box.appendChild(btn);
  document.body.appendChild(box);
}
