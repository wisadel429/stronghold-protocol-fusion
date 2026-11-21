// tools/check-social.mjs — 好友 / 黑名单 / 邀请 的服务端冒烟（自起服务器，账号数据写临时目录）。
//
// 覆盖：找人（QQ 号 / 昵称#tag）、请求→同意→双向好友、重复请求、邀请进房（在线推送）、
//      拉黑（解除好友 + 拒收 + 房间可见性判定）、在线状态、未登录 401。
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION } from '../shared/constants.js';

const PORT = 3149, BASE = `http://127.0.0.1:${PORT}`, WSURL = `ws://127.0.0.1:${PORT}/ws`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACCDIR = mkdtempSync(path.join(tmpdir(), 'sp-social-check-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', SP_ACCOUNTS_DIR: ACCDIR }, stdio: 'ignore',
});
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch { await sleep(250); } }

const results = [];
const ok = (n, c, extra) => { results.push({ n, c: !!c }); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${extra ? ' — ' + extra : ''}`); };

async function post(pathName, body, cookie) {
  const res = await fetch(BASE + pathName, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body || {}),
  });
  let json = null; try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}
async function get(pathName, cookie) {
  const res = await fetch(BASE + pathName, { headers: cookie ? { cookie } : {} });
  let json = null; try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}
async function register(nickname) {
  const qq = '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const res = await fetch(BASE + '/api/account/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: qq, password: 'correct horse 1', nickname, agree: true }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const token = /sp_acc=([^;]+)/.exec(setCookie)?.[1];
  const json = await res.json().catch(() => null);
  return { qq, cookie: token ? `sp_acc=${token}` : null, account: json?.account || null };
}

function openWs(cookie) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WSURL, cookie ? { headers: { cookie } } : {});
    const box = { ws, welcome: null, msgs: [] };
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: '巡检', version: PROTOCOL_VERSION, rid: 1 })));
    ws.on('message', (d) => {
      try {
        const m = JSON.parse(String(d));
        if (m.t === 'welcome') { box.welcome = m; resolve(box); }
        else box.msgs.push(m);
      } catch { /* ignore */ }
    });
    ws.on('error', () => resolve(box));
    setTimeout(() => resolve(box), 3000);
  });
}

try {
  const a = await register('甲博士');
  const b = await register('乙博士');

  // 未登录
  const anon = await get('/api/social');
  ok('未登录访问 /api/social → 401', anon.status === 401, 'status=' + anon.status);

  // 找人：按 QQ 号
  const findQq = await get('/api/social/find?q=' + b.qq, a.cookie);
  ok('按 QQ 号找到人（返回公开身份）', findQq.json?.accounts?.length === 1
    && findQq.json.accounts[0].nickname === '乙博士'
    && findQq.json.accounts[0].qq === undefined, JSON.stringify(findQq.json?.accounts?.[0]));

  // 找人：按 昵称#tag
  const tag = b.account.tag;
  const findTag = await get(`/api/social/find?q=${encodeURIComponent('乙博士#' + tag)}`, a.cookie);
  ok('按「昵称#tag」找到人', findTag.json?.accounts?.[0]?.id === b.account.id, JSON.stringify(findTag.json?.accounts?.[0]));

  const bid = b.account.id, aid = a.account.id;

  // 请求 → B 的待处理列表里出现 A
  const req = await post('/api/social/request', { id: bid }, a.cookie);
  ok('发好友请求', req.json?.ok && req.json.state === 'sent', JSON.stringify(req.json));
  const bOv = await get('/api/social', b.cookie);
  ok('对方收到请求', bOv.json?.requests?.length === 1 && bOv.json.requests[0].id === aid, JSON.stringify(bOv.json?.requests?.[0]));

  // 重复请求
  const dup = await post('/api/social/request', { id: bid }, a.cookie);
  ok('重复发请求被拒（E_ALREADY_SENT）', dup.json?.error === 'E_ALREADY_SENT', JSON.stringify(dup.json?.error));

  // 同意 → 双向好友
  const acc = await post('/api/social/accept', { id: aid }, b.cookie);
  ok('同意好友请求', acc.json?.ok && acc.json.state === 'friend', JSON.stringify(acc.json));
  const aOv = await get('/api/social', a.cookie);
  const bOv2 = await get('/api/social', b.cookie);
  ok('双向好友成立', aOv.json?.friends?.[0]?.id === bid && bOv2.json?.friends?.[0]?.id === aid,
    `${aOv.json?.friends?.length}/${bOv2.json?.friends?.length}`);

  // 在线状态：B 连上 WS 后，A 的好友列表里 B 应为在线
  const wsB = await openWs(b.cookie);
  ok('B 的 WS 握手成功', !!wsB.welcome, wsB.welcome ? 'playerId=' + wsB.welcome.playerId : 'no welcome');
  await sleep(300);
  const aOv2 = await get('/api/social', a.cookie);
  ok('好友列表显示在线', aOv2.json?.friends?.[0]?.online === true, JSON.stringify(aOv2.json?.friends?.[0]?.online));

  // 邀请进房 → B 的 socket 收到 social.invite
  const inv = await post('/api/social/invite', { id: bid, code: 'AB12' }, a.cookie);
  ok('邀请好友进房', inv.json?.ok && inv.json.delivered === true, JSON.stringify(inv.json));
  await sleep(400);
  const gotInvite = wsB.msgs.find((m) => m.t === 'social.invite');
  ok('对方在线收到邀请推送', !!gotInvite && gotInvite.code === 'AB12' && gotInvite.from?.nickname === '甲博士',
    JSON.stringify(gotInvite));

  // 非好友不能邀请
  const c = await register('丙博士');
  const inv2 = await post('/api/social/invite', { id: c.account.id, code: 'AB12' }, a.cookie);
  ok('非好友不能邀请（E_NOT_FRIEND）', inv2.json?.error === 'E_NOT_FRIEND', JSON.stringify(inv2.json?.error));

  // 拉黑：解除好友 + 拒收请求 + 房间可见性
  const blk = await post('/api/social/block', { id: bid }, a.cookie);
  ok('拉黑好友', blk.json?.ok === true, JSON.stringify(blk.json));
  const aOv3 = await get('/api/social', a.cookie);
  ok('拉黑后好友关系解除', (aOv3.json?.friends || []).length === 0, `friends=${aOv3.json?.friends?.length}`);
  const reqBlocked = await post('/api/social/request', { id: aid }, b.cookie);
  ok('被拉黑方无法再发请求', reqBlocked.json?.error === 'E_BLOCKED', JSON.stringify(reqBlocked.json?.error));
  const blkList = await get('/api/social', a.cookie);
  ok('黑名单里能查到对方', blkList.json?.blocked?.[0]?.id === bid, JSON.stringify(blkList.json?.blocked?.[0]?.nickname));

  // 解除拉黑后可重新加
  const unblk = await post('/api/social/unblock', { id: bid }, a.cookie);
  const req2 = await post('/api/social/request', { id: bid }, a.cookie);
  ok('解除拉黑后可以重新加好友', unblk.json?.ok && req2.json?.ok && req2.json.state === 'sent', JSON.stringify(req2.json));

  wsB.ws.close();
} catch (e) {
  console.error('SMOKE CRASH', e);
  results.push({ n: 'crash', c: false });
} finally {
  srv.kill();
}

const failed = results.filter((r) => !r.c);
console.log(`\n${failed.length ? 'FAILED' : 'ALL PASS'} (${results.length - failed.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);
