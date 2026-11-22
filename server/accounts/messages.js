// server/accounts/messages.js — 每个账号的消息中心（业主 2026-11-21）
//
// 触发点：好友请求、后台对「问题反馈」的回复。客户端标题页的「消息」面板读取这个列表。
// 存储：data/messages.json
//   { version: 1, items: { [accountId]: Msg[] } }
//   Msg = { id, at, type: 'friend'|'feedback'|'system', title, text, action?, read }
//   action = { kind: 'friends'|'feedback'|'url', value?: string }  —— 客户端据此渲染「前往」按钮
//
// 每个账号最多保留 MAX_PER_ACCOUNT 条（新的在前），写盘走临时文件 + rename。

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const MAX_PER_ACCOUNT = 100;
const TITLE_MAX = 80;
const TEXT_MAX = 800;
const TYPES = new Set(['friend', 'feedback', 'system']);

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

export class MessageStore {
  /**
   * @param {{ dir: string, log?: any, now?: () => number,
   *           notify?: (accountId: string, row: any, unread: number) => void }} o
   *   notify: 新消息落盘后立刻调用（业主 2026-11-22「消息中心改实时推送」）。在这里而不是在各业务调用点挂钩，
   *   是因为好友请求 / 同盟邀请 / 后台回复反馈全都经由 add() —— 一处覆盖所有消息源，以后新增来源也不用再改。
   *   回调抛错不影响消息本身（已经写盘了）。
   */
  constructor({ dir, log = console, now = Date.now, notify = null }) {
    this.dir = dir;
    this.log = log;
    this.now = now;
    this.notify = typeof notify === 'function' ? notify : null;
    this.file = path.join(dir, 'messages.json');
    /** @type {Record<string, any[]>} */
    this.items = {};
    this.load();
  }

  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.items = j && typeof j.items === 'object' && j.items ? j.items : {};
    } catch { this.items = {}; }
    return this;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, items: this.items }), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) { this.log?.error?.('[messages] 写盘失败', e); }
  }

  /**
   * 给某个账号追加一条消息。
   * @param {string} accountId
   * @param {{ type?: string, title?: string, text?: string, action?: any }} msg
   * @returns {any|null} 追加的行；accountId 不合法时 null
   */
  add(accountId, msg = {}) {
    const id = String(accountId || '');
    if (!id) return null;
    const type = TYPES.has(msg.type) ? msg.type : 'system';
    const row = {
      id: 'msg_' + randomBytes(5).toString('hex'),
      at: this.now(),
      type,
      title: clean(msg.title, TITLE_MAX) || '通知',
      text: clean(msg.text, TEXT_MAX),
      ...(msg.action && typeof msg.action === 'object' ? { action: { kind: String(msg.action.kind || ''), value: msg.action.value == null ? undefined : String(msg.action.value) } } : {}),
      read: false,
    };
    const list = Array.isArray(this.items[id]) ? this.items[id] : [];
    list.unshift(row);
    this.items[id] = list.slice(0, MAX_PER_ACCOUNT);
    this.save();
    // 实时推送（业主 2026-11-22）：已经有连接在线上就直接把这条推过去，客户端立刻刷新，不用等下一轮轮询。
    // 推送失败绝不能影响消息本身 —— 它对玩家已经「存在」了（/api/messages 随时能取回）。
    if (this.notify) {
      try { this.notify(id, row, this.unread(id)); } catch (e) { this.log?.warn?.('[messages] 推送失败', e); }
    }
    return row;
  }

  /** 某账号的消息（新的在前）。 */
  list(accountId) {
    const list = this.items[String(accountId || '')];
    return Array.isArray(list) ? list.slice() : [];
  }

  /** 未读数。 */
  unread(accountId) {
    return this.list(accountId).filter((m) => m && !m.read).length;
  }

  /** 标记已读（ids 省略 = 全部）。 */
  markRead(accountId, ids = null) {
    const list = this.items[String(accountId || '')];
    if (!Array.isArray(list)) return 0;
    const want = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
    let n = 0;
    for (const m of list) {
      if (!m || m.read) continue;
      if (want && !want.has(m.id)) continue;
      m.read = true; n++;
    }
    if (n) this.save();
    return n;
  }

  /** 删一条（客户端下拉清理用）。 */
  remove(accountId, id) {
    const key = String(accountId || '');
    const list = this.items[key];
    if (!Array.isArray(list)) return false;
    const i = list.findIndex((m) => m && m.id === String(id || ''));
    if (i < 0) return false;
    list.splice(i, 1);
    if (!list.length) delete this.items[key];
    this.save();
    return true;
  }

  /** 删账号时一并清掉（admin 删号）。 */
  purge(accountId) {
    const key = String(accountId || '');
    if (!this.items[key]) return 0;
    delete this.items[key];
    this.save();
    return 1;
  }
}
