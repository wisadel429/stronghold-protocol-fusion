// server/accounts/social.js — 好友 / 黑名单 / 好友邀请（账号系统第二期）。
//
// 口径（业主 2026-11-14）：
//   · 好友：请求 → 同意 → 列表 → 删除；可以「邀请好友进房」（好友在房间里时一键发邀请）。
//   · 黑名单：拉黑后对方不能给他发好友请求/邀请，大厅里也看不到他开的房（房间可见性由 lobby 侧调用 canSee 判断）。
//   · 在线状态：green dot 来自当前 WS 连接（accountId → 是否有活跃 socket），由 Network 现算，不落盘。
//   · QQ 号不公开：加好友可以用 **QQ 号**（你知道对方 QQ 时最方便），也可以用 **昵称#tag**（公开身份）。
//     服务端只在「你输入的那一段」里做匹配，返回给请求方的仍是「昵称#tag」。
//
// 存储：data/social.json
//   { version: 1, friends: { [accountId]: string[] }, requests: { [accountId]: [{ from, at }] },
//     sent: { [accountId]: string[] }, block: { [accountId]: string[] } }
//   friends 是**双向**的：A 加 B 成功后两边各存一份。
import path from 'node:path';
import { readJson, writeJson } from './store.js';

const DEFAULT = () => ({ version: 1, friends: {}, requests: {}, sent: {}, block: {} });
const MAX_FRIENDS = 200;
const MAX_REQUESTS = 100;
const fail = (status, code, message) => Object.assign(new Error(message || code), { status, code });

export class SocialStore {
  /** @param {{ dir: string, log?: object, flushDelayMs?: number }} opts */
  constructor({ dir, log = console, flushDelayMs = 150 }) {
    this.file = path.join(dir, 'social.json');
    this.log = log;
    this.doc = readJson(this.file, DEFAULT);
    this.doc.friends ||= {};
    this.doc.requests ||= {};
    this.doc.sent ||= {};
    this.doc.block ||= {};
    this._timer = null;
    this._delay = flushDelayMs;
  }

  touch() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, this._delay);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  flush() { try { writeJson(this.file, this.doc); } catch (e) { this.log.error?.('[social] 写入失败', e); } }
  close() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } this.flush(); }

  friendsOf(id) { return this.doc.friends[id] || []; }
  requestsOf(id) { return this.doc.requests[id] || []; }
  sentOf(id) { return this.doc.sent[id] || []; }
  blockedBy(id) { return this.doc.block[id] || []; }
  /** 是否被 `other` 拉黑（他看不见我，我也不能加他）。 */
  isBlockedBy(other, me) { return this.blockedBy(other).includes(me); }

  /**
   * 账号被后台删除时清掉它在社交里的所有痕迹（业主 2026-11-17）：
   * 自己的四张表整条删掉，别人的好友/请求/已发/黑名单里也把它摘掉 —— 否则别人的列表里会留一条指向
   * 不存在账号的死链（好友列表显示「未知博士」、邀请也会失败）。
   * @param {string} id
   * @returns {{ friends: number, requests: number, sent: number, block: number }} 从别人列表里摘掉的条数
   */
  purge(id) {
    const hit = { friends: 0, requests: 0, sent: 0, block: 0 };
    delete this.doc.friends[id];
    delete this.doc.requests[id];
    delete this.doc.sent[id];
    delete this.doc.block[id];
    for (const [owner, list] of Object.entries(this.doc.friends)) {
      if (!Array.isArray(list) || !list.includes(id)) continue;
      this.doc.friends[owner] = list.filter((x) => x !== id);
      hit.friends++;
    }
    for (const [owner, list] of Object.entries(this.doc.requests)) {
      if (!Array.isArray(list)) continue;
      const next = list.filter((r) => r && r.from !== id);
      if (next.length !== list.length) { this.doc.requests[owner] = next; hit.requests++; }
    }
    for (const [owner, list] of Object.entries(this.doc.sent)) {
      if (!Array.isArray(list) || !list.includes(id)) continue;
      this.doc.sent[owner] = list.filter((x) => x !== id);
      hit.sent++;
    }
    for (const [owner, list] of Object.entries(this.doc.block)) {
      if (!Array.isArray(list) || !list.includes(id)) continue;
      this.doc.block[owner] = list.filter((x) => x !== id);
      hit.block++;
    }
    this.touch();
    return hit;
  }
}

/**
 * 社交业务：好友请求/同意/删除、黑名单、邀请。
 * @param {{ store: SocialStore, accounts: import('./service.js').AccountService, network?: any, log?: object }} deps
 */
export class SocialService {
  constructor({ store, accounts, network = null, log = console, messages = null }) {
    this.store = store;
    this.accounts = accounts;
    this.network = network;
    this.log = log;
    this.messages = messages;   // 消息中心（业主 2026-11-21；没接时为 null，静默跳过）
  }

  /** 在线判定：该账号有没有活跃 socket（network.conns 现算，不落盘）。 */
  isOnline(accountId) {
    const net = this.network;
    if (!net || !net.conns) return false;
    for (const conn of net.conns.values()) {
      if (conn && conn.session && conn.session.accountId === accountId && conn.session.connected) return true;
    }
    return false;
  }

  /** 公开身份：昵称#tag（永远不带 QQ 号）。
   *  头像用干员立绘 avatarId（charId）+ 立绘样式 avatarSkin，名片用 cardId（业主 2026-11-14）。 */
  brief(accountId) {
    const a = this.store && this.accounts ? this.accounts.accountById(accountId) : null;
    if (!a) return null;
    return { id: a.id, nickname: a.nickname, tag: a.tag, avatarId: a.avatarId || null, avatarSkin: a.avatarSkin || null, cardId: a.cardId || null, cardVariant: Number.isInteger(a.cardVariant) ? a.cardVariant : null, admin: a.admin === true, online: this.isOnline(a.id), lastSeenAt: a.lastSeenAt || 0 };
  }

  /**
   * 按「QQ 号」或「昵称#tag」或「纯昵称」找人（只返回公开身份）。
   * @param {string} query
   * @returns {any[]} 最多 10 条
   */
  find(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const pub = (a) => ({ id: a.id, nickname: a.nickname, tag: a.tag, avatarId: a.avatarId || null, avatarSkin: a.avatarSkin || null, cardId: a.cardId || null, cardVariant: Number.isInteger(a.cardVariant) ? a.cardVariant : null, admin: a.admin === true, online: this.isOnline(a.id), lastSeenAt: a.lastSeenAt || 0 });
    const m = /^(.+?)#(\d{4})$/.exec(q);
    if (m) {
      const nick = m[1].trim().toLowerCase();
      const tag = m[2];
      return this.accounts.adminList({ limit: 1000 })
        .filter((a) => a.tag === tag && String(a.nickname).toLowerCase() === nick)
        .slice(0, 10)
        .map(pub);
    }
    if (/^[1-9][0-9]{4,11}$/.test(q)) {
      const a = this.accounts.adminList({ query: q, limit: 10 }).filter((x) => x.qq === q);
      return a.map(pub);
    }
    // 纯昵称：模糊匹配（最多 10 条），提示用户用「昵称#tag」更精确
    const needle = q.toLowerCase();
    return this.accounts.adminList({ limit: 1000 })
      .filter((a) => String(a.nickname).toLowerCase().includes(needle))
      .slice(0, 10)
      .map(pub);
  }

  /** 我的好友页数据：好友列表（含在线状态）+ 待处理请求 + 我发出的请求 + 黑名单。 */
  overview(me) {
    const friends = this.store.friendsOf(me).map((id) => this.brief(id)).filter(Boolean);
    const requests = this.store.requestsOf(me)
      .map((r) => ({ ...(this.brief(r.from) || {}), at: r.at }))
      .filter((r) => r.id);
    const sent = this.store.sentOf(me).map((id) => this.brief(id)).filter(Boolean);
    const blocked = this.store.blockedBy(me).map((id) => this.brief(id)).filter(Boolean);
    return { friends, requests, sent, blocked };
  }

  /** 加好友（发请求）。已经互为好友/已发过/被拉黑都有明确回执。 */
  request(me, targetId) {
    if (!targetId || targetId === me) throw fail(400, 'E_SELF', '不能加自己为好友');
    if (!this.accounts.accountById(targetId)) throw fail(404, 'E_NO_ACCOUNT', '没有这个账号');
    if (this.store.isBlockedBy(targetId, me)) throw fail(403, 'E_BLOCKED', '对方已把你拉黑');
    if (this.store.friendsOf(me).includes(targetId)) throw fail(409, 'E_ALREADY_FRIEND', '你们已经是好友了');
    const inbound = this.store.requestsOf(me).some((r) => r.from === targetId);
    if (inbound) return this.accept(me, targetId);          // 对方也请求过我 → 直接成为好友
    if (this.store.sentOf(me).includes(targetId)) throw fail(409, 'E_ALREADY_SENT', '已经发过请求了，等对方同意');
    if (this.store.friendsOf(me).length >= MAX_FRIENDS) throw fail(429, 'E_FRIEND_FULL', `好友上限 ${MAX_FRIENDS}`);
    const list = this.store.doc.requests[targetId] || (this.store.doc.requests[targetId] = []);
    if (list.length >= MAX_REQUESTS) throw fail(429, 'E_REQUEST_FULL', '对方的请求太多，稍后再试');
    list.push({ from: me, at: Date.now() });
    const sent = this.store.doc.sent[me] || (this.store.doc.sent[me] = []);
    if (!sent.includes(targetId)) sent.push(targetId);
    this.store.touch();
    // 对方在线就推一条，前端可以弹「XX 请求加你好友」
    this.notify(targetId, { t: 'social.request', from: this.brief(me) });
    // 业主 2026-11-21：好友请求同时进消息中心（离线也能看到）
    this.pushMessage(targetId, {
      type: 'friend',
      title: '好友请求',
      text: `${this.labelOf(me)} 请求加你为好友`,
      action: { kind: 'friends' },
    });
    return { ok: true, state: 'sent' };
  }

  /** 同意某人（对方必须先请求过我）。 */
  accept(me, fromId) {
    const reqs = this.store.doc.requests[me] || [];
    const idx = reqs.findIndex((r) => r.from === fromId);
    if (idx < 0) throw fail(404, 'E_NO_REQUEST', '没有这条好友请求');
    if (this.store.friendsOf(me).length >= MAX_FRIENDS) throw fail(429, 'E_FRIEND_FULL', `好友上限 ${MAX_FRIENDS}`);
    reqs.splice(idx, 1);
    this.link(me, fromId);
    this.store.touch();
    this.notify(fromId, { t: 'social.accepted', by: this.brief(me) });
    // 业主 2026-11-21：对方同意后也进消息中心
    this.pushMessage(fromId, {
      type: 'friend',
      title: '好友请求已通过',
      text: `${this.labelOf(me)} 同意了你的好友请求`,
      action: { kind: 'friends' },
    });
    return { ok: true, state: 'friend' };
  }

  reject(me, fromId) {
    const reqs = this.store.doc.requests[me] || [];
    const idx = reqs.findIndex((r) => r.from === fromId);
    if (idx >= 0) reqs.splice(idx, 1);
    const sent = this.store.doc.sent[fromId] || [];
    const j = sent.indexOf(me);
    if (j >= 0) sent.splice(j, 1);
    this.store.touch();
    return { ok: true };
  }

  /** 双向建立好友关系。 */
  link(a, b) {
    const add = (x, y) => {
      const list = this.store.doc.friends[x] || (this.store.doc.friends[x] = []);
      if (!list.includes(y)) list.push(y);
    };
    add(a, b); add(b, a);
    const clean = (x, y) => {
      const sent = this.store.doc.sent[x] || [];
      const i = sent.indexOf(y);
      if (i >= 0) sent.splice(i, 1);
      const reqs = this.store.doc.requests[x] || [];
      const j = reqs.findIndex((r) => r.from === y);
      if (j >= 0) reqs.splice(j, 1);
    };
    clean(a, b); clean(b, a);
  }

  remove(me, otherId) {
    const drop = (x, y) => {
      const list = this.store.doc.friends[x] || [];
      const i = list.indexOf(y);
      if (i >= 0) list.splice(i, 1);
    };
    drop(me, otherId); drop(otherId, me);
    this.store.touch();
    return { ok: true };
  }

  block(me, otherId) {
    if (!otherId || otherId === me) throw fail(400, 'E_SELF', '不能拉黑自己');
    const list = this.store.doc.block[me] || (this.store.doc.block[me] = []);
    if (!list.includes(otherId)) list.push(otherId);
    // 拉黑同时解除好友关系与双方未处理的请求
    this.remove(me, otherId);
    this.reject(me, otherId); this.reject(otherId, me);
    this.store.touch();
    return { ok: true, blocked: this.store.blockedBy(me).map((n) => this.brief(n)).filter(Boolean) };
  }

  unblock(me, otherId) {
    const list = this.store.doc.block[me] || [];
    const i = list.indexOf(otherId);
    if (i >= 0) list.splice(i, 1);
    this.store.touch();
    return { ok: true };
  }

  /** 房间可见性：房主 `hostId` 是否对我可见（我被房主拉黑 / 房主被我拉黑 → 都不可见）。 */
  canSeeRoom(me, hostId) {
    if (!me || !hostId) return true;
    return !this.store.isBlockedBy(hostId, me) && !this.store.isBlockedBy(me, hostId);
  }

  /** 邀请好友进房（只允许邀请好友；被拉黑/非好友一律拒绝）。 */
  invite(me, toId, code) {
    if (!this.accounts.accountById(toId)) throw fail(404, 'E_NO_ACCOUNT', '没有这个账号');
    if (!this.store.friendsOf(me).includes(toId)) throw fail(403, 'E_NOT_FRIEND', '只能邀请好友');
    if (this.store.isBlockedBy(toId, me)) throw fail(403, 'E_BLOCKED', '对方已把你拉黑');
    const room = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(room)) throw fail(400, 'E_BAD_CODE', '房间号不对');
    this.notify(toId, { t: 'social.invite', from: this.brief(me), code: room });
    // 业主 2026-11-21：房间邀请也进消息中心，带「加入房间」跳转按钮（对方离线时回来还能看到）
    this.pushMessage(toId, {
      type: 'friend',
      title: '同盟邀请',
      text: `${this.labelOf(me)} 邀请你加入同盟 ${room}`,
      action: { kind: 'room', value: room },
    });
    return { ok: true, delivered: this.isOnline(toId) };
  }

  /** 「昵称#tag」；账号查不到时退回 id。 */
  labelOf(accountId) {
    const b = this.brief(accountId);
    const name = b && (b.nickname || b.name);
    return name ? `${name}${b.tag ? '#' + b.tag : ''}` : String(accountId || '');
  }

  /** 往消息中心追加一条（没接消息存储时静默跳过）。 */
  pushMessage(accountId, msg) {
    try { return this.messages ? this.messages.add(accountId, msg) : null; }
    catch (e) { this.log.error?.('[social] message failed', e); return null; }
  }

  /** 给某个账号的所有在线连接推一条消息。 */
  notify(accountId, msg) {
    try { return this.network && typeof this.network.sendToAccount === 'function' ? this.network.sendToAccount(accountId, msg) : 0; }
    catch (e) { this.log.error?.('[social] notify failed', e); return 0; }
  }
}
