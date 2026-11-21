// server/accounts/store.js — 账号 / 云存档 / 会话的持久化（零依赖 JSON 文件，原子写）。
//
// 设计取舍（业主 2026-11-14 定的「零依赖 data/accounts.json」）：
//   * 三个文件分开，避免单文件过大与互相拖累：
//       data/accounts.json          账号凭据与资料
//       data/saves.json             云存档（战绩/调配/皮肤/名片/成就/设置）
//       data/account-sessions.json  账号会话（只存 token 的 sha256，不落明文）
//   * 写入一律「临时文件 → fsync → rename」，进程崩在写一半也不会留下半截 JSON；
//     读到损坏文件时先把它另存为 `.corrupt-<时间戳>` 再回落默认值，绝不因一次坏文件让服务器起不来。
//   * 所有写操作在进程内串行（单写者），并用 120ms 合并窗口把一轮里的多次改动合成一次落盘。
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ACCOUNTS = () => ({ version: 1, accounts: {} });
const DEFAULT_SAVES = () => ({ version: 1, saves: {} });
const DEFAULT_SESSIONS = () => ({ version: 1, sessions: {} });

export function readJson(file, fallback) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const doc = JSON.parse(text);
    if (!doc || typeof doc !== 'object') throw new Error('not an object');
    return doc;
  } catch (e) {
    if (e && e.code === 'ENOENT') return fallback();
    // 损坏：保留现场，再用默认结构继续跑（最坏情况是丢一次外部损坏的内容，也不会卡住服务器）
    try {
      const backup = `${file}.corrupt-${Date.now()}`;
      fs.copyFileSync(file, backup);
      console.error(`[accounts] ${path.basename(file)} 损坏，已备份到 ${backup}`, e && e.message);
    } catch { /* 备份失败也不拦启动 */ }
    return fallback();
  }
}

/** 原子写：同目录临时文件 + fsync 后 rename（跨平台，Windows 上 rename 覆盖前需先 unlink）。 */
export function writeJson(file, doc) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const text = JSON.stringify(doc);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, text, 'utf8');
    try { fs.fsyncSync(fd); } catch { /* 某些文件系统不支持，忽略 */ }
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows：目标存在时 rename 可能失败，退回「删除后改名」
    try { fs.unlinkSync(file); } catch { /* ignore */ }
    fs.renameSync(tmp, file);
  }
}

export class AccountStore {
  /**
   * @param {{ dir: string, log?: { error?: Function }, flushDelayMs?: number }} opts
   */
  constructor({ dir, log = console, flushDelayMs = 120 }) {
    this.dir = dir;
    this.log = log;
    this.flushDelayMs = flushDelayMs;
    this.fileAccounts = path.join(dir, 'accounts.json');
    this.fileSaves = path.join(dir, 'saves.json');
    this.fileSessions = path.join(dir, 'account-sessions.json');
    /** @type {Map<string, any>} accountId → account */
    this.accounts = new Map();
    /** @type {Map<string, string>} usernameLower → accountId */
    this.byUsername = new Map();
    /** @type {Map<string, any>} accountId → save */
    this.saves = new Map();
    /** @type {Map<string, any>} tokenHash → session */
    this.sessions = new Map();
    /** @type {Map<string, Set<string>>} accountId → 该账号的 tokenHash 集合（业主 2026-11-21：多设备并存） */
    this.sessionOf = new Map();
    this._timer = null;
    this._dirty = { accounts: false, saves: false, sessions: false };
    this.load();
  }

  load() {
    const accounts = readJson(this.fileAccounts, DEFAULT_ACCOUNTS);
    for (const [id, a] of Object.entries(accounts.accounts || {})) {
      if (!a || typeof a !== 'object' || typeof a.id !== 'string') continue;
      this.accounts.set(id, a);
      if (typeof a.usernameLower === 'string') this.byUsername.set(a.usernameLower, id);
    }
    const saves = readJson(this.fileSaves, DEFAULT_SAVES);
    for (const [id, s] of Object.entries(saves.saves || {})) {
      if (!s || typeof s !== 'object') continue;
      this.saves.set(id, s);
    }
    const sessions = readJson(this.fileSessions, DEFAULT_SESSIONS);
    const now = Date.now();
    for (const [tokenHash, s] of Object.entries(sessions.sessions || {})) {
      if (!s || typeof s.accountId !== 'string') continue;
      if (!Number.isFinite(s.seenAt) || now - s.seenAt > 30 * 24 * 3600 * 1000) continue;   // 过期清掉
      this.sessions.set(tokenHash, s);
      this.addSessionOf(s.accountId, tokenHash);
    }
  }

  /** 安排一次合并落盘（一轮消息里的多次改动只写一次）。 */
  touch(which) {
    this._dirty[which] = true;
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, this.flushDelayMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  flush() {
    if (this._dirty.accounts) {
      /** @type {Record<string, any>} */
      const accounts = {};
      for (const [id, a] of this.accounts) accounts[id] = a;
      writeJson(this.fileAccounts, { version: 1, accounts });
      this._dirty.accounts = false;
    }
    if (this._dirty.saves) {
      /** @type {Record<string, any>} */
      const saves = {};
      for (const [id, s] of this.saves) saves[id] = s;
      writeJson(this.fileSaves, { version: 1, saves });
      this._dirty.saves = false;
    }
    if (this._dirty.sessions) {
      /** @type {Record<string, any>} */
      const sessions = {};
      for (const [hash, s] of this.sessions) sessions[hash] = s;
      writeJson(this.fileSessions, { version: 1, sessions });
      this._dirty.sessions = false;
    }
  }

  /** 进程退出前把脏数据写完（index.js 的优雅退出会调）。 */
  close() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this.flush();
  }

  // ---- 账号 -----------------------------------------------------------------
  get(id) { return this.accounts.get(id) || null; }
  byName(usernameLower) { const id = this.byUsername.get(String(usernameLower || '')); return id ? this.get(id) : null; }
  put(account) {
    this.accounts.set(account.id, account);
    if (typeof account.usernameLower === 'string') this.byUsername.set(account.usernameLower, account.id);
    this.touch('accounts');
    return account;
  }
  list() { return [...this.accounts.values()]; }

  /**
   * 后台「删除账号」（业主 2026-11-17）：账号本体 + 云存档 + 会话一起删，三份文件都会落盘。
   * QQ 号（usernameLower）也要从索引里摘掉，否则同一个号再注册会被当成「已存在」。
   * 好友/黑名单由调用方（admin.js）调 socialStore.purge 清理。
   * @param {string} id
   * @returns {boolean} 是否真的删掉了
   */
  remove(id) {
    const account = this.accounts.get(id);
    if (!account) return false;
    this.accounts.delete(id);
    if (typeof account.usernameLower === 'string') this.byUsername.delete(account.usernameLower);
    this.saves.delete(id);
    if (this.dropSessionsOf(id)) this.touch('sessions');
    this.touch('accounts');
    this.touch('saves');
    return true;
  }

  // ---- 账号会话（业主 2026-11-21「其他设备登录时不要清空登录状态」：一个账号可有多条会话）----

  /** 记一条会话归属（accountId → tokenHash 集合）。 */
  addSessionOf(accountId, tokenHash) {
    let set = this.sessionOf.get(accountId);
    if (!(set instanceof Set)) { set = new Set(); this.sessionOf.set(accountId, set); }
    set.add(tokenHash);
  }

  /** 某账号当前所有会话 tokenHash（副本，随便改）。 */
  sessionsOf(accountId) {
    const set = this.sessionOf.get(accountId);
    return set instanceof Set ? [...set] : [];
  }

  /** 删掉某账号的全部会话，返回删掉的条数。 */
  dropSessionsOf(accountId) {
    let dropped = 0;
    for (const hash of this.sessionsOf(accountId)) if (this.sessions.delete(hash)) dropped++;
    this.sessionOf.delete(accountId);
    return dropped;
  }

  // ---- 云存档 ---------------------------------------------------------------
  getSave(id) { return this.saves.get(id) || null; }
  putSave(id, save) {
    const doc = { ...save, updatedAt: Date.now() };
    this.saves.set(id, doc);
    this.touch('saves');
    return doc;
  }
  deleteSave(id) { this.saves.delete(id); this.touch('saves'); }
}
