// test/zhajing-fixes.test.js — 两个炸惊 bug 的回归（业主 2026-11-14）：
//   ① 惊变「追忆」(jibian_zhuiji) 必须一局只回档一次（曾经每到 R13→R14 就回 R10，整局卡在 R10–R13 无限循环）；
//   ② 炸惊的 Boss 血池要按本模式口径增长（data/bosses.json 没有 ZHAJING 列，过去退化成最小档 FUNNY 的 247,500）。
// 直接跑：node --test test/zhajing-fixes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRegistry } from '../server/match/effectsMeta.js';
import { getData } from '../server/data.js';
import { GameData } from '../server/match/gamedata.js';
import { bossPoolHp } from '../server/match/finalAssault.js';

const quietLog = { warn() {}, info() {}, error() {} };

test('追忆：一局只把 R14 改成 R10 一次，卡片保留但失效', () => {
  const reg = createRegistry({ builtins: false, content: true, log: quietLog });
  const h = reg.get('jibian:jibian_zhuiji');
  assert.ok(h, 'jibian:jibian_zhuiji 没有注册');
  const counters = {};
  const toasts = [];
  const ctx = {
    counter: (k) => (Number.isFinite(counters[k]) ? counters[k] : 0),
    setCounter: (k, v) => { counters[k] = v; return counters[k]; },
    toast: (t) => { toasts.push(t); },
  };
  const run = (round) => { const ev = { round }; h.onRoundWouldStart(ctx, ev); return ev.round; };

  assert.equal(run(14), 10, '第一次应该回档到第 10 回合');
  assert.equal(run(14), 14, '第二次必须正常进入第 14 回合（否则无限循环）');
  assert.equal(run(13), 13, '非 14 回合不动');
  assert.equal(run(14), 14, '回档次数一共只有一次');
  assert.equal(toasts.length, 1);
});

test('炸惊 Boss 血池按模式口径增长，官方模式数值不变', () => {
  const raw = getData({ log: quietLog });
  const pool = (modeId, bossId, alive = 1) => bossPoolHp(new GameData(raw, modeId, {}), bossId, alive);

  // 官方模式：bloodPoint 原值（× 在场人数）
  assert.equal(pool('mode_single_abyss', 'boss_1'), 3600000);
  assert.equal(pool('mode_multi_abyss', 'boss_1', 4), 14400000);
  assert.equal(pool('mode_single_abyss', 'boss_8'), 7200000);   // 隐秘首领，但炸惊以外没有 hiddenBossHpMul

  // 炸惊：借终极列 × modes.<id>.bossHpScale.hpMul；隐秘首领再乘 hiddenBossHpMul
  const zjMode = raw.config.modes.mode_single_zhajing;
  const hpMul = zjMode.bossHpScale.hpMul;
  const hiddenMul = zjMode.hiddenBossHpMul;
  assert.ok(hpMul > 1, '炸惊的 hpMul 必须可读（>1）');
  assert.equal(pool('mode_single_zhajing', 'boss_1'), Math.round(3600000 * hpMul));
  assert.equal(pool('mode_single_zhajing', 'boss_8'), Math.round(7200000 * hpMul * hiddenMul));
  const plain = pool('mode_single_zhajing', 'boss_1');
  assert.ok(plain > 3600000, '炸惊的 Boss 不该比终极难度还脆');
});
