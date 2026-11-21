// tools/collect-theme-art.mjs —— 跑一遍主题页面（含**登录**与**真对局**），把 404 的 /ui-art/ 文件从分享包里补进来。
//
// 为什么不用静态扫描：主题 JS 大量用模板串拼素材路径（`icon_' + id + '.png'`、`map-${n}-1.png`），静态扫不到；
// 整包 64 MB 又太肥。这里用真实请求的 404 清单补，跑 2–3 轮就收敛。
//
// 2026-11-14 升级：加了账号登录（现在未登录进不了大厅）与「独立模拟 → 建房 → 整备 → 战斗」流程，
// 否则对局内的素材（地图、emoji、升级卡）永远补不到。
//
// 用法：node tools/collect-theme-art.mjs --pack <解包目录> [--rounds 3] [--theme closure]
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const PACK = argVal('--pack', null);
const ROUNDS = Number(argVal('--rounds', '3'));
const THEME = argVal('--theme', 'closure');
if (!PACK) { console.error('用法: node tools/collect-theme-art.mjs --pack <解包目录> [--rounds 3] [--theme closure]'); process.exit(2); }

const PORT = 3153, CDP = 9453, BASE = `http://127.0.0.1:${PORT}`;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = 'E:/stronghold/Stronghold-Protocol-v0.3.3-Fusion';
const PUBLIC = join(ROOT, 'public');
const ACCDIR = mkdtempSync(join(tmpdir(), 'sp-art-acc-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', SP_ACCOUNTS_DIR: ACCDIR }, stdio: 'ignore',
});
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch { await sleep(250); } }

// 临时账号（每轮共用一个即可）
const qq = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
const reg = await fetch(BASE + '/api/account/register', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: qq, password: 'correct horse 1', nickname: '采集', agree: true }),
});
const TOKEN = /sp_acc=([^;]+)/.exec(reg.headers.get('set-cookie') || '')?.[1] || '';

const profile = mkdtempSync(join(tmpdir(), 'theme-art-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) { try { await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); break; } catch { await sleep(250); } }

const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
let seq = 0; const pending = new Map(); const missing = new Set();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  else if (m.method === 'Network.responseReceived') {
    const u = m.params.response.url;
    if (m.params.response.status === 404 && u.includes('/ui-art/')) missing.add(decodeURIComponent(new URL(u).pathname.replace('/ui-art/', '')));
  }
});
const send = (mm, p = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method: mm, params: p })); return new Promise((res, rej) => pending.set(id, { res, rej })); };
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Network.setCookie', { name: 'sp_acc', value: TOKEN, domain: '127.0.0.1', path: '/' });

/** 跳过开场动画，等标题页。 */
async function toTitle(url) {
  await send('Page.navigate', { url });
  await sleep(1200);
  for (let i = 0; i < 16; i++) { if (await ev(`!!document.querySelector('.spa-entry .spa-stage, .spa-entry canvas, .spa-entry img')`)) break; await sleep(300); }
  await ev(`(() => { const el=document.querySelector('.spa-entry'); if (el) el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); return 1; })()`);
  for (let i = 0; i < 30; i++) { if (await ev(`!!document.querySelector('.title-cn')`)) break; await sleep(400); }
}

/** 标题页 → 大厅。 */
async function toLobby() {
  await ev(`(() => { const i=document.querySelector('.title-login input'); if(!i) return 0;
    const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i,'采集'); i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
  await sleep(400);
  await ev(`(() => { const b=[...document.querySelectorAll('.title-login button')].find(x=>!x.disabled&&/开始|START/i.test(x.textContent||'')); if(b)b.click(); return !!b; })()`);
  for (let i = 0; i < 40; i++) { if (await ev(`!document.querySelector('.title-cn')`)) break; await sleep(400); }
  await sleep(1500);
}

/** 大厅 → 独立模拟 → 难度 → 建房 → 开始模拟 → 整备 → 战斗（尽可能把对局内页面都走一遍）。 */
async function runMatch() {
  const click = (re) => ev(`(() => { const b=[...document.querySelectorAll('button, [role="button"], a, [class*="card"]')].find(x=>${re}.test((x.textContent||'').replace(/\\s+/g,' ')) && !x.disabled); if(!b) return 'no'; b.click(); return 'ok'; })()`);
  console.log('  独立模拟:', await click(/独立模拟/)); await sleep(1800);
  console.log('  难度:', await click(/标准模拟|险境模拟|绝境模拟|终极模拟/)); await sleep(1800);
  console.log('  建房:', await click(/创建|开始|进入|确定/)); await sleep(4000);
  // 房间：立绘/名片/开始按钮
  await sleep(2500);
  console.log('  开始模拟:', await click(/开始模拟/)); await sleep(4000);
  // 简报 / 策略 / 整备 / 战斗
  for (const [label, ms] of [['简报', 3000], ['策略', 3000], ['整备', 5000], ['战斗', 8000]]) {
    await sleep(ms);
    console.log(`  ${label}阶段 innerText:`, String(await ev(`(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,50)`)));
  }
}

let totalCopied = 0;
for (let round = 1; round <= ROUNDS; round++) {
  missing.clear();
  // 1) 大厅 / SWEEP / 添加好友（覆盖挂载页面）
  await toTitle(`${BASE}/ui-theme-${THEME}.html`);
  await toLobby();
  await sleep(2500);
  for (const [label, sel] of [['S.W.E.E.P.', /S\.W\.E\.E\.P/i], ['成就', /成就统计|成就/]]) {
    await ev(`(() => { const b=[...document.querySelectorAll('button, [role="button"]')].find(x=>${sel}.test(x.textContent||'')); if(b) b.click(); return !!b; })()`);
    await sleep(3000);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await sleep(1200);
    console.log(`  ${label} 已打开`);
  }
  // 2) 真对局
  await runMatch();

  if (!missing.size) { console.log(`round ${round}: 没有 404，收敛`); break; }
  let copied = 0, bytes = 0, gone = 0;
  for (const rel of missing) {
    const src = join(PACK, 'assets', rel);
    if (!existsSync(src)) { gone++; continue; }
    const dst = join(PUBLIC, 'ui-art', rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    copied++; bytes += statSync(src).size;
  }
  totalCopied += copied;
  console.log(`round ${round}: 404 ${missing.size} 个 → 补 ${copied} 个 (${(bytes / 1048576).toFixed(1)} MB)${gone ? `，包里也没有 ${gone} 个` : ''}`);
  if (!copied) break;
}

console.log(`done, 共补 ${totalCopied} 个素材文件`);
ws.close(); edge.kill(); srv.kill();
process.exit(0);
