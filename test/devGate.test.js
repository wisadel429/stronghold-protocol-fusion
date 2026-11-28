// test/devGate.test.js — /dev/** 访问闸门（2026-11-28）：开发工具只给管理员会话，或本机直连。
//
// 直接跑：node --test test/devGate.test.js
//
// 背景：public/dev/ 跟着 public/ 一起被静态服务放出去，/dev/trainer 是一套能改战斗数值的客户端工具，
// 文件公开就等于把引擎送给所有人（面板上的判断挡不住直接 import engine.js 的人）。
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDevGate, isDevPath, isProxied } from '../server/http/devGate.js';

const ADMIN = { id: 'a1', admin: true };
const USER = { id: 'u1', admin: false };

const req = (cookie = '', headers = {}) => ({ headers: { cookie, ...headers }, socket: { remoteAddress: '127.0.0.1' } });

/** 一段会话票 → 一个账号；cookie 里只有 adm / usr 两种能解析出来。 */
const accountOf = (r) => (r.headers.cookie === 'sp_acc=adm' ? ADMIN : r.headers.cookie === 'sp_acc=usr' ? USER : null);
const gate = (opts = {}) => createDevGate({ accountsOn: true, accountOf, isLocal: () => true, ...opts });

test('路径判定只认 /dev 与 /dev/**', () => {
  assert.equal(isDevPath('/dev'), true);
  assert.equal(isDevPath('/dev/game-mock.js'), true);
  assert.equal(isDevPath('/devtrainer'), false);
  assert.equal(isDevPath('/development'), false);
  assert.equal(isDevPath('/public/dev/x'), false);
});

test('反代头识别', () => {
  assert.equal(isProxied({ headers: {} }), false);
  assert.equal(isProxied({ headers: { 'x-forwarded-for': '1.2.3.4' } }), true);
  assert.equal(isProxied({ headers: { 'x-real-ip': '1.2.3.4' } }), true);
  assert.equal(isProxied({ headers: { forwarded: 'for=1.2.3.4' } }), true);
  assert.equal(isProxied({ headers: { 'x-forwarded-host': 'mon3tr.fun' } }), true);
});

test('管理员会话放行，即使经反代', () => {
  assert.equal(gate()(req('sp_acc=adm', { 'x-forwarded-for': '8.8.8.8' })), true);
});

test('普通账号被拒', () => {
  assert.equal(gate()(req('sp_acc=usr', { 'x-forwarded-for': '8.8.8.8' })), false);
});

test('无会话 + 反代 → 拒（公网主路径）', () => {
  assert.equal(gate()(req('', { 'x-forwarded-for': '8.8.8.8' })), false);
});

test('无会话 + 本机直连 → 放（RDP / 本机开发）', () => {
  assert.equal(gate()(req('')), true);
});

test('本机直连但带反代头 → 拒（防伪造）', () => {
  assert.equal(gate()(req('', { 'x-real-ip': '8.8.8.8' })), false);
});

test('非本机 + 无会话 → 拒', () => {
  assert.equal(gate({ isLocal: () => false })(req('')), false);
});

test('账号系统关闭：本机放行，反代拒绝', () => {
  const g = createDevGate({ accountsOn: false, isLocal: () => true });
  assert.equal(g(req('')), true);
  assert.equal(g(req('', { 'x-forwarded-for': '8.8.8.8' })), false);
});

test('读会话抛错时拒绝而不是崩溃', () => {
  const g = createDevGate({ accountsOn: true, accountOf: () => { throw new Error('boom'); }, isLocal: () => false });
  assert.equal(g(req('sp_acc=x')), false);
});
