// tools/check-ui-themes.mjs —— 界面主题（皮肤层）的冒烟 + 布局体检（无头 Edge + CDP）。
//
// 业主报过三类问题，这个脚本就围绕它们量：
//   ① 入场动画：能不能加载（.spa-entry 出现、铺满视口、内部有画面）与能不能跳过（点一下 1 秒内消失）；
//   ② 比例：根字号 / --t / 关键容器矩形是否与视口一致，页面有没有横向溢出；
//   ③ 遮盖：全屏遮罩（开场 dialog、boot 遮罩）的矩形是否正好等于视口。
// 三个入口（/、/ui-theme-initial.html、/ui-theme-closure.html）各跑一遍，数值不一致就报出来。
//
// 用法：node tools/check-ui-themes.mjs [--port 3112] [--shots <目录>]
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const argVal = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const PORT = Number(argVal('--port', '3112'));
const SHOTS = argVal('--shots', null);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP = 9412;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function openTab() {
  const tab = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    } else if (m.method) events.push(m);
  });
  const send = (method, params = {}) => {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => pending.set(id, { res, rej }));
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  return { ws, send, events, close: () => ws.close() };
}

function collect(events) {
  const errors = [], failed = [];
  const ignore = (u) => /\/ui-editor\//.test(u || '');
  for (const e of events) {
    if (e.method === 'Runtime.exceptionThrown') {
      const d = e.params.exceptionDetails;
      errors.push(`exception: ${d.exception?.description || d.text} @ ${d.url || ''}:${d.lineNumber ?? ''}`);
    } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
      errors.push('console.error: ' + e.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 300));
    } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
      const u = e.params.entry.url || '';
      if (ignore(u)) continue;
      errors.push(`log: ${e.params.entry.text.slice(0, 200)} ${u}`);
    } else if (e.method === 'Network.loadingFailed' && !e.params.canceled) {
      errors.push(`network failed: ${e.params.errorText}`);
    } else if (e.method === 'Network.responseReceived') {
      const u = e.params.response.url, st = e.params.response.status;
      if (ignore(u)) continue;
      if (st >= 400) failed.push(`${st} ${u.startsWith(BASE) ? u.slice(BASE.length) : u}`);
    }
  }
  return { errors, failed };
}

const ev = async (page, expression, opts = {}) => {
  const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, ...opts });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

const CLEAR_THEME = `(async () => { try { localStorage.removeItem('sp.ui-theme.v1'); } catch (e) {} return 1; })()`;

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name), Buffer.from(data, 'base64'));
}

/** 开场动画探针：在不在、铺没铺满、里面有没有画（canvas/img）、跳过是否生效。 */
const INTRO_PROBE = `(() => {
  const el = document.querySelector('.spa-entry');
  if (!el) return JSON.stringify({ present: false });
  const r = el.getBoundingClientRect();
  const canvas = el.querySelector('canvas');
  const stage = el.querySelector('.spa-stage');
  return JSON.stringify({
    present: true,
    rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    viewport: [innerWidth, innerHeight],
    covers: Math.abs(r.width - innerWidth) <= 2 && Math.abs(r.height - innerHeight) <= 2,
    position: getComputedStyle(el).position,
    z: getComputedStyle(el).zIndex,
    canvases: el.querySelectorAll('canvas').length,
    canvasSize: canvas ? [canvas.width, canvas.height] : null,
    imgs: el.querySelectorAll('img').length,
    stageScale: stage ? getComputedStyle(stage).transform : null,
  });
})()`;

/** 比例体检：根字号、--t、横向溢出、标题/主区域矩形。 */
const LAYOUT_PROBE = `(() => {
  const cs = getComputedStyle(document.documentElement);
  const doc = document.scrollingElement || document.documentElement;
  const pick = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  };
  return JSON.stringify({
    viewport: [innerWidth, innerHeight],
    rootFontSize: Math.round((parseFloat(cs.fontSize) || 0) * 100) / 100,
    t: cs.getPropertyValue('--t').trim(),
    scroll: [doc.scrollWidth, doc.scrollHeight],
    overflowX: doc.scrollWidth - innerWidth,
    overflowY: doc.scrollHeight - innerHeight,
    titleCn: pick('.title-cn'),
    titleMain: pick('.title-main'),
    boot: pick('#boot'),
    theme: document.documentElement.dataset.uiTheme || null,
    themeCss: [...document.styleSheets].filter((s) => (s.href || '').includes('/ui-themes/')).length,
    uiThemeBtn: !!document.querySelector('[data-testid="title-ui-theme"]'),
  });
})()`;

const LOBBY_PROBE = `(() => {
  const doc = document.scrollingElement || document.documentElement;
  const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  return JSON.stringify({
    scroll: [doc.scrollWidth, doc.scrollHeight],
    overflowX: doc.scrollWidth - innerWidth,
    overflowY: doc.scrollHeight - innerHeight,
    rootFontSize: Math.round((parseFloat(getComputedStyle(document.documentElement).fontSize) || 0) * 100) / 100,
    appRoot: pick('.app-root'),
    crashed: !!document.querySelector('.screen-crashed'),
    text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 110),
  });
})()`;

async function enterLobby(page) {
  await ev(page, `(() => {
    const input = document.querySelector('.title-login input');
    if (!input) return 'no-input';
    input.focus(); input.value = '巡检';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(400);
  const clicked = await ev(page, `(() => {
    const b = [...document.querySelectorAll('.title-login button')].find((x) => !x.disabled && /开始|START/i.test(x.textContent || ''));
    if (!b) return 'no-button';
    b.click(); return 'clicked';
  })()`);
  await sleep(6000);
  return { clicked, probe: await ev(page, LOBBY_PROBE) };
}

// ---- 起服务器 -------------------------------------------------------------
log(`server: ${BASE}`);
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const srv = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', SP_NO_BROWSER: '1' }, stdio: 'ignore',
});
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(BASE + '/healthz')).ok; } catch { await sleep(250); } }
if (!up) { srv.kill(); console.error('server not up'); process.exit(1); }

const profile = mkdtempSync(join(tmpdir(), 'ui-theme-check-'));
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--window-size=1366,768', 'about:blank'], { stdio: 'ignore' });

let ok = true;
try {
  let ver = null;
  for (let i = 0; i < 80 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json(); } catch { await sleep(250); } }
  if (!ver) throw new Error('headless browser not up');
  const page = await openTab();
  const report = {};

  for (const [name, entry] of [['web', '/'], ['initial', '/ui-theme-initial.html'], ['closure', '/ui-theme-closure.html']]) {
    page.events.length = 0;
    await ev(page, CLEAR_THEME);
    await page.send('Page.navigate', { url: BASE + entry });
    // 入场动画：出现 → 截图 → **等它挂载完成（.spa-stage 出现，跳过才被武装）** → 点一下 → 1.5s 内应消失
    await sleep(1400);
    const intro = await ev(page, INTRO_PROBE);
    await shot(page, `ui-${name}-intro.png`);
    const beforeSkip = JSON.parse(intro || '{}').present === true;
    let armed = false;
    if (beforeSkip) {
      // 「武装」= 画面已经挂上（本仓版是 .spa-stage，主题版可能直接是 canvas/图），再点才该生效
      for (let i = 0; i < 16; i++) {                       // 最多等 ~4.8s
        armed = (await ev(page, `(() => { const el = document.querySelector('.spa-entry'); if (!el) return false;
          return !!el.querySelector('.spa-stage, canvas, img, svg') || el.childElementCount > 2; })()`)) === true;
        if (armed) break;
        await sleep(300);
      }
      await shot(page, `ui-${name}-intro-armed.png`);
      await ev(page, `(() => { const el = document.querySelector('.spa-entry'); if (el) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true; })()`);
      for (let i = 0; i < 10; i++) {                       // 跳过应在 1.5s 内生效
        if ((await ev(page, `!!document.querySelector('.spa-entry')`)) === false) break;
        await sleep(150);
      }
    }
    const afterSkip = await ev(page, INTRO_PROBE);
    const skipWorked = !beforeSkip || !armed || JSON.parse(afterSkip || '{}').present === false;

    await sleep(2600);
    const layout = await ev(page, LAYOUT_PROBE);
    await shot(page, `ui-${name}-title.png`);

    const lobby = await enterLobby(page);
    await shot(page, `ui-${name}-lobby.png`);
    report[name] = { intro, skipWorked, beforeSkip, layout, lobby: lobby.clicked + ' ' + lobby.probe, ...collect(page.events) };
  }

  for (const [name, r] of Object.entries(report)) {
    const i = JSON.parse(r.intro || '{}');
    const L = JSON.parse(r.layout || '{}');
    log(`\n=== ${name}`);
    log(`  intro: present=${i.present} covers=${i.covers} rect=${JSON.stringify(i.rect)} viewport=${JSON.stringify(i.viewport)} canvas=${JSON.stringify(i.canvasSize)} stage=${i.stageScale} skip=${r.skipWorked ? 'ok' : 'FAIL'}${r.beforeSkip ? '' : '(not played)'}`);
    log(`  title: rootFont=${L.rootFontSize} --t=${L.t} overflow=${L.overflowX}/${L.overflowY} titleCn=${JSON.stringify(L.titleCn)} themeCss=${L.themeCss} btn=${L.uiThemeBtn} theme=${L.theme}`);
    log(`  lobby: ${r.lobby}`);
    if (r.failed.length) log(`  4xx: ${[...new Set(r.failed)].slice(0, 6).join(' | ')}`);
    if (r.errors.length) log(`  errors: ${[...new Set(r.errors)].slice(0, 6).join(' | ')}`);

    if (i.present && !i.covers) { log('  x overlay does not cover viewport'); ok = false; }
    if (!r.skipWorked) { log('  x skip failed'); ok = false; }
    if (L.overflowX > 2 || L.overflowY > 2) { log('  x page overflow'); ok = false; }
    if (name !== 'web' && !(L.themeCss > 0)) { log('  x theme css missing'); ok = false; }
    if (name === 'web' && L.themeCss > 0) { log('  x original loaded theme css'); ok = false; }
    if (!L.uiThemeBtn) { log('  x title ui-theme button missing'); ok = false; }
    if (r.errors.length || r.failed.length) ok = false;
  }

  await ev(page, `(async () => { try { localStorage.setItem('sp.ui-theme.v1','closure'); } catch (e) {} return 1; })()`);
  await page.send('Page.navigate', { url: BASE + '/' });
  await sleep(2000);
  const gateUrl = await ev(page, 'location.pathname');
  await ev(page, CLEAR_THEME);
  log(`\n=== gate: / -> ${gateUrl}`);
  if (!/ui-theme-closure\.html/.test(String(gateUrl))) { log('  x gate did not redirect'); ok = false; }

  page.close();
} catch (e) {
  console.error(e);
  ok = false;
} finally {
  edge.kill();
  srv.kill();
}

log(ok ? '\nOK' : '\nFAILED');
process.exit(ok ? 0 : 1);
