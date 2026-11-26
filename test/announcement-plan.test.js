// test/announcement-plan.test.js — 公告写入口径的回归（业主 2026-11-26 复盘的那次事故）：
//   11-26 发版时 `-Notes` 把 11-22 那条 927 字的更新说明**整条换成了 51 字**，因为旧代码固定操作 `rows[0]`。
// 现在的口径：同一天 → 当天那条上追加/覆盖；换天了 → 当天新起一条，上一条只停用、正文保留；撤下 → 只停用不清空。
// 直接跑：node --test test/announcement-plan.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

import { planAnnouncementWrite, sameLocalDay, makeAnnouncementId } from '../server/announcementPlan.js';

const OLD_TEXT = '· 11-22 的第一条\n· 11-22 的第二条';
/** 11-22 那条「长期」更新说明（业主线上那条的缩样）。 */
const oldRow = {
  id: 'old222', title: '2026-11-22 更新说明', text: OLD_TEXT,
  startAt: '2026-11-22T10:00:00+08:00', durationSeconds: 2592000, level: 'info', enabled: true,
};
// 2026-11-26 23:00 北京时间
const NOW = Date.parse('2026-11-26T23:00:00+08:00');
const plan = (over = {}) => planAnnouncementWrite({ rows: [oldRow], text: '· 今天的新改动', nowMs: NOW, ...over });

test('换天了：新起一条，上一条只停用、正文一个字都不动', () => {
  const r = plan();
  assert.equal(r.sameDay, false);
  assert.equal(r.appended, false);
  assert.equal(r.doc.announcements.length, 2, '旧条目必须还在，不能只剩一条');
  const kept = r.doc.announcements.find((x) => x.id === 'old222');
  assert.equal(kept.text, OLD_TEXT, '旧正文被改写了');
  assert.equal(kept.enabled, false, '旧条目应该被停用');
  assert.equal(r.doc.announcements[0].text, '· 今天的新改动', '新条目要放最前（后台表单读 announcements[0]）');
  assert.notEqual(r.doc.announcements[0].id, 'old222', '新条目不能沿用上一条的 id');
  assert.equal(r.doc.announcements[0].startAt.slice(0, 10), '2026-11-26');
});

test('同一天再发：追加到当天那条，不多出一条，旧的那条不动', () => {
  const first = plan();
  const second = planAnnouncementWrite({ rows: first.doc.announcements, text: '· 同一天的追加', nowMs: NOW + 60_000 });
  assert.equal(second.sameDay, true);
  assert.equal(second.appended, true);
  assert.equal(second.doc.announcements.length, 2, '同一天不应新增条目');
  assert.equal(second.row.text, '· 今天的新改动\n· 同一天的追加');
  assert.equal(second.row.id, first.row.id, '同一天沿用同一个 id');
  assert.equal(second.doc.announcements.find((x) => x.id === 'old222').text, OLD_TEXT);
});

test('同一段内容重复发：不重复追加，字数不涨', () => {
  const first = plan();
  const again = planAnnouncementWrite({ rows: first.doc.announcements, text: '· 今天的新改动', nowMs: NOW + 120_000 });
  assert.equal(again.appended, false);
  assert.equal(again.row.text, '· 今天的新改动');
});

test('撤下：只停用、不整表清空（以前撤下就再也找不回）', () => {
  const first = plan();
  const off = planAnnouncementWrite({ rows: first.doc.announcements, text: '', nowMs: NOW + 60_000 });
  assert.equal(off.doc.announcements.length, 2);
  assert.ok(off.doc.announcements.every((x) => x.enabled === false));
  assert.equal(off.doc.announcements.find((x) => x.id === 'old222').text, OLD_TEXT);
  assert.match(off.note, /撤下/);
});

test('同日覆盖（mode=replace）：整段替换当天那条，不动别条', () => {
  const first = plan();
  const rep = planAnnouncementWrite({ rows: first.doc.announcements, text: '· 重写后的正文', mode: 'replace', nowMs: NOW + 60_000 });
  assert.equal(rep.appended, false);
  assert.equal(rep.row.text, '· 重写后的正文');
  assert.equal(rep.doc.announcements.length, 2);
});

test('永久公告：durationSeconds=0（hours=0 也走永久）', () => {
  assert.equal(plan({ permanent: true }).row.durationSeconds, 0);
  assert.equal(plan({ hours: 0 }).row.durationSeconds, 0);
});

test('newId 生成：合法字符集，且不与已有条目撞号', () => {
  const id = makeAnnouncementId([{ id: 'x' }], NOW);
  assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
  assert.notEqual(id, 'x');
});

test('sameLocalDay：同一天/跨天/坏值', () => {
  assert.equal(sameLocalDay('2026-11-26T00:00:01+08:00', '2026-11-26T23:59:59+08:00'), true);
  assert.equal(sameLocalDay('2026-11-25T23:59:59+08:00', '2026-11-26T00:00:01+08:00'), false);
  assert.equal(sameLocalDay('', NOW), false);
});
