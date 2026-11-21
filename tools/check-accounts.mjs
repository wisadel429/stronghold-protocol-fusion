// 临时：账号系统服务端冒烟（HTTP 注册/登录 + WS 握手鉴权 + 单设备踢旧 + 云存档）。
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../shared/constants.js';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PORT = 3145, BASE = `http://127.0.0.1:${PORT}`, WSURL = `ws://127.0.0.1:${PORT}/ws`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 账号数据写到临时目录（SP_ACCOUNTS_DIR）：不污染 data/ 里的真实账号
const ACCOUNTS_DIR = mkdtempSync(path.join(tmpdir(), 'sp-accounts-check-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', SP_ACCOUNTS_DIR: ACCOUNTS_DIR }, stdio: 'ignore',
});
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch { await sleep(250); } }

const results = [];
const ok = (name, cond, extra) => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

async function api(path, { method = 'POST', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const token = /sp_acc=([^;]+)/.exec(setCookie)?.[1] || null;
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json, token, cookie: token ? `sp_acc=${token}` : null };
}

function wsHello(cookie) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WSURL, cookie ? { headers: { cookie } } : {});
    const out = { ws, welcome: null, error: null, closeCode: null };
    const timer = setTimeout(() => resolve(out), 4000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: '巡检', version: PROTOCOL_VERSION, rid: 1 })));
    ws.on('message', (data) => {
      try {
        const m = JSON.parse(String(data));
        if (m.t === 'welcome') { out.welcome = m; clearTimeout(timer); resolve(out); }
        else if (m.t === 'error') { out.error = m; clearTimeout(timer); resolve(out); }
      } catch { /* ignore */ }
    });
    ws.on('close', (code) => { out.closeCode = code; clearTimeout(timer); resolve(out); });
    ws.on('error', () => { clearTimeout(timer); resolve(out); });
  });
}

try {
  // 1) 未登录 hello 必须被拒（AUTH_REQUIRED）
  const anon = await wsHello(null);
  ok('未登录 WS 握手被拒', !!anon.error && anon.error.code === 'AUTH_REQUIRED', JSON.stringify(anon.error || anon.closeCode));

  // 2) 注册
  const user = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'); // QQ 号（5–12 位数字）
  const reg = await api('/api/account/register', { body: { username: user, password: 'correct horse 1', nickname: '巡检', agree: true } });
  ok('注册成功', reg.status === 200 && reg.json?.ok && reg.token && reg.json.account.qq === user && reg.json.account.nickname === '巡检', `status=${reg.status}`);

  // 3) 带 cookie 的 WS 握手成功
  const logged = await wsHello(reg.cookie);
  ok('登录后 WS 握手成功', !!logged.welcome && !!logged.welcome.playerId, logged.welcome ? 'playerId=' + logged.welcome.playerId : JSON.stringify(logged.error));

  // 4) 未登录调用需登录 API → 401
  const meAnon = await fetch(BASE + '/api/account/me');
  const meAnonJson = await meAnon.json().catch(() => null);
  ok('未登录 /api/account/me 返回空账号', meAnon.status === 200 && meAnonJson && meAnonJson.account === null, 'status=' + meAnon.status + ' account=' + JSON.stringify(meAnonJson && meAnonJson.account));

  // 5) 云存档写入 + 读回
  const put = await api('/api/account/save', { method: 'PUT', cookie: reg.cookie, body: { save: { stats: { wins: 3 }, loadout: { a: 1 } } } });
  const got = await api('/api/account/save', { method: 'GET', cookie: reg.cookie });
  ok('云存档写入/读回', put.json?.ok && got.json?.save?.fields?.stats?.wins === 3, JSON.stringify(got.json?.save?.fields?.stats));

  // 6) 合并（取大、并集）
  const merged = await api('/api/account/save/merge', { cookie: reg.cookie, body: { save: { stats: { wins: 5, losses: 1 }, loadout: { b: 2 } } } });
  const f = merged.json?.save?.fields || {};
  ok('云存档合并规则', f.stats?.wins === 5 && f.stats?.losses === 1 && f.loadout?.a === 1 && f.loadout?.b === 2, JSON.stringify(f));

  // 7) 单设备：再登录一次 → 旧连接收到 4001（replaced）
  const replaced = new Promise((resolve) => {
    logged.ws.on('close', (code) => resolve(code));
    setTimeout(() => resolve(null), 6000);
  });
  const login2 = await api('/api/account/login', { body: { username: user, password: 'correct horse 1' } });
  const code = await replaced;
  ok('单设备：新登录踢掉旧连接', login2.json?.ok && code === 4001, `closeCode=${code}`);

  // 8) 昵称改名（首次应允许，紧接着第二次应被 7 天冷却挡住）
  const rn1 = await api('/api/account/rename', { cookie: login2.cookie, body: { nickname: '新名字' } });
  const rn2 = await api('/api/account/rename', { cookie: login2.cookie, body: { nickname: '又一个' } });
  ok('改名 + 7 天冷却', rn1.json?.ok && rn2.json?.error === 'E_RENAME_COOLDOWN', `${rn1.json?.account?.nickname} / ${rn2.json?.error}`);

  // 9) 错误密码不给信息泄露（同一条错误）
  const bad = await api('/api/account/login', { body: { username: user, password: 'wrong wrong' } });
  const nonexist = await api('/api/account/login', { body: { username: '999999999999', password: 'whatever 1' } });
  ok('登录失败不泄露账号是否存在', bad.json?.error === 'E_LOGIN' && nonexist.json?.error === 'E_LOGIN');
} catch (e) {
  console.error('SMOKE CRASH', e);
  results.push({ name: 'crash', pass: false });
} finally {
  srv.kill();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? 'FAILED' : 'ALL PASS'} (${results.length - failed.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);
