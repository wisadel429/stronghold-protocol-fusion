// server/accounts/service.js — 账号业务：注册 / 登录 / 会话 / 改名 / 资料 / 云存档。
//
// 约定（业主 2026-11-14 定的口径）：
//   · 用户名 + 密码，开放注册；用户名不区分大小写、全服唯一；**昵称不唯一**，靠四位 `#tag` 区分；
//   · 登录多设备并存（业主 2026-11-21 改口径；在此之前是单设备、新登录顶掉旧 token）：
//     同一账号最多 MAX_SESSIONS_PER_ACCOUNT 条会话并存，换设备不会把另一台踢下线；
//   · 昵称/头像/头像框/名片可改；昵称改名 7 天冷却；
//   · 云存档只做「白名单字段 + 体积上限」的透传与合并，字段语义由客户端（ui/cloudSave.js）定义。
import { randomBytes, createHash } from 'node:crypto';
import { hashPassword, verifyPassword, checkPassword } from './passwords.js';
// 固定账号（业主 2026-11-15）：不可修改 / 删除 / 封禁 / 登录 / 撤销管理员 / 重置密码。
import { isProtectedAccount, ensureProtectedAccount, protectedAllowsLogin } from './protected.js';

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;       // 30 天不活跃过期
const RENAME_COOLDOWN_MS = 7 * 24 * 3600 * 1000;    // 改名冷却
// 业主 2026-11-21「账号在其他设备登录时不清空登录状态」：同一账号允许多台设备同时在线，
// 最多保留这么多条会话；超出时淘汰最久没活跃的那条（防止反复登录把会话表撑爆）。
const MAX_SESSIONS_PER_ACCOUNT = 8;
const SAVE_MAX_BYTES = 512 * 1024;
export const SAVE_FIELDS = Object.freeze(['stats', 'loadout', 'skins', 'namecards', 'achievements', 'settings']);

// QQ 号（2026-11-14 业主口径）：5–12 位数字、不以 0 开头。它是登录凭据，**不对外公开**，
// 只用于自己记忆/找回与管理员检索；其他玩家只看得到「昵称#tag」。
const QQ_RE = /^[1-9][0-9]{4,11}$/;
const ID_RE = /^acc_[a-f0-9]{16}$/;
const now = () => Date.now();
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

/** 登录名规范化：去首尾空白与常见分隔符（QQ 号可能被复制成 "123 456" / "123-456"）。 */
export const normalizeUsername = (u) => String(u == null ? '' : u).replace(/[\s-]/g, '').trim();
export const usernameKey = (u) => normalizeUsername(u).toLowerCase();

/** QQ 号校验：返回错误文案或 null。 */
export function checkQQ(qq) {
  const s = normalizeUsername(qq);
  if (!s) return '请输入 QQ 号';
  if (!QQ_RE.test(s)) return 'QQ 号应为 5–12 位数字';
  return null;
}

/** 昵称清洗：1–12 个字符，去掉控制字符与首尾空白；换行折叠成空格。 */
export function sanitizeNickname(nick) {
  const s = String(nick == null ? '' : nick).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...s];
  if (chars.length < 1) return '';
  if (chars.length > 12) return chars.slice(0, 12).join('');
  return s;
}

const fail = (status, code, message) => Object.assign(new Error(message || code), { status, code });

/**
 * 固定账号的写操作守卫（业主 2026-11-15）：命中就抛 403，动作一律不做。
 * @param {any} account @param {string} action 中文动作名（拼进报错文案）
 */
function assertMutable(account, action) {
  if (isProtectedAccount(account)) {
    throw fail(403, 'E_PROTECTED', `这是固定在游戏中的账号，不可${action}`);
  }
}

export class AccountService {
  /**
   * @param {{ store: import('./store.js').AccountStore, now?: () => number }} opts
   */
  constructor({ store, now: clock = now }) {
    this.store = store;
    this.now = clock;
    // 固定账号（业主 2026-11-15）：每次启动按规范记录校正/补回，并作废它的会话。
    // 放在这里（而不是 server/index.js）是为了让测试和任何入口都自动生效。
    this.protectedInfo = ensureProtectedAccount(this);
  }

  // ---- 对外视图 -------------------------------------------------------------
  /**
   * 账号的公开视图。**只有 `self: true`（本人 / 管理员）才带 `qq`**：
   * QQ 号是登录凭据，其他玩家只看得到「昵称#tag」。
   * @param {any} account @param {{ self?: boolean }} [opts]
   */
  static view(account, { self = false } = {}) {
    if (!account) return null;
    return {
      id: account.id,
      ...(self ? { qq: account.username } : {}),
      tag: account.tag,
      nickname: account.nickname,
      avatarId: account.avatarId ?? null,
      avatarSkin: account.avatarSkin ?? null,
      cardId: account.cardId ?? null,
      // 名片差分序号（业主 2026-11-14「名片有差分款式」）：0 起，null = 默认差分
      cardVariant: Number.isInteger(account.cardVariant) ? account.cardVariant : null,
      // 管理员身份（业主 2026-11-14）：后台可设置，客户端头像右上角显示金标
      admin: account.admin === true,
      createdAt: account.createdAt,
      ban: account.ban ? { reason: account.ban.reason || '', at: account.ban.at } : null,
      canRenameAt: (account.nickChangedAt || 0) + RENAME_COOLDOWN_MS,
    };
  }

  // ---- 注册 / 登录 ----------------------------------------------------------
  /**
   * @param {{ username: string, password: string, nickname?: string }} input  username = QQ 号
   * @returns {Promise<any>} 账号视图（self：本人可见 QQ 号）
   */
  async register({ username, password, nickname }) {
    const qq = normalizeUsername(username);
    const qqErr = checkQQ(qq);
    if (qqErr) throw fail(400, 'E_QQ', qqErr);
    const key = usernameKey(qq);
    if (this.store.byName(key)) throw fail(409, 'E_QQ_TAKEN', '这个 QQ 号已经注册过了，直接登录即可');
    const pwErr = checkPassword(password);
    if (pwErr) throw fail(400, 'E_PASSWORD', pwErr);
    // 昵称默认「博士」：QQ 号不公开，所以绝不能拿它当昵称
    const nick = sanitizeNickname(nickname) || '博士';
    const { salt, hash } = await hashPassword(password);
    const account = {
      id: 'acc_' + randomBytes(8).toString('hex'),
      username: qq,
      usernameLower: key,
      salt,
      hash,
      tag: String(1000 + randomBytes(2).readUInt16BE(0) % 9000),
      nickname: nick,
      avatarId: null,
      cardId: null,
      createdAt: this.now(),
      lastSeenAt: this.now(),
      nickChangedAt: 0,
      ban: null,
    };
    this.store.put(account);
    return AccountService.view(account, { self: true });
  }

  /**
   * @param {{ username: string, password: string }} input  username = QQ 号
   * @returns {Promise<{ account: any, token: string, replaced: boolean }>}
   */
  async login({ username, password }) {
    const key = usernameKey(username);
    const account = key ? this.store.byName(key) : null;
    // 固定账号默认不可登录（业主 2026-11-15）：在校验密码**之前**就拒，免得泄露"密码对不对"。
    // 线上那台用 protected-allow-login.flag / SP_PROTECTED_ALLOW_LOGIN=1 放开登录（其余五类照样锁）。
    if (account && !protectedAllowsLogin()) assertMutable(account, '登录');
    // QQ 号不存在与密码错误给同一个错误，避免枚举
    const ok = account ? await verifyPassword(password, account.salt, account.hash) : false;
    if (!ok) throw fail(401, 'E_LOGIN', 'QQ 号或密码不对');
    if (account.ban) throw fail(403, 'E_BANNED', account.ban.reason ? `账号已被封禁：${account.ban.reason}` : '账号已被封禁');
    const { token, replaced } = this.createSession(account.id);
    account.lastSeenAt = this.now();
    this.store.put(account);
    return { account: AccountService.view(account, { self: true }), token, replaced };
  }

  /**
   * 建会话。业主 2026-11-21「账号在其他设备登录时不清空登录状态」：**多设备并存** ——
   * 新登录不再作废旧 token，换手机/换浏览器另一台不会被踢下线。
   * 同一账号最多保留 MAX_SESSIONS_PER_ACCOUNT 条，超出时淘汰最久没活跃的那条
   * （单机反复登录 / 多标签页不会无限增长）。
   * @returns {{ token: string, replaced: boolean }} replaced = 之前是否已有其它会话（仅作提示，不再踢人）
   */
  createSession(accountId) {
    // 固定账号默认不可登录（业主 2026-11-15）：连会话都不给建（放行登录的安装除外）
    if (!protectedAllowsLogin()) assertMutable(this.store.get(accountId), '登录');
    const hashes = this.store.sessionsOf(accountId);
    const replaced = hashes.length > 0;
    const over = hashes.length - MAX_SESSIONS_PER_ACCOUNT + 1;
    if (over > 0) {
      const byAge = hashes
        .map((h) => [h, this.store.sessions.get(h) || {}])
        .sort((a, b) => (a[1].seenAt || a[1].at || 0) - (b[1].seenAt || b[1].at || 0));
      for (const [h] of byAge.slice(0, over)) this.destroySessionByHash(h);
    }
    const token = randomBytes(24).toString('hex');
    const hash = sha256(token);
    const rec = { accountId, at: this.now(), seenAt: this.now() };
    this.store.sessions.set(hash, rec);
    this.store.addSessionOf(accountId, hash);
    this.store.touch('sessions');
    return { token, replaced };
  }

  /** token → 账号（顺带刷新活跃时间；过期即作废）。 */
  resolve(token) {
    if (typeof token !== 'string' || !token) return null;
    const hash = sha256(token);
    const rec = this.store.sessions.get(hash);
    if (!rec) return null;
    if (this.now() - (rec.seenAt || rec.at) > SESSION_TTL_MS) { this.destroySession(token); return null; }
    const account = this.store.get(rec.accountId);
    if (!account) { this.destroySession(token); return null; }
    // 固定账号默认不可登录（业主 2026-11-15）：残留的旧 cookie 也立刻失效（放行登录的安装除外）
    if (isProtectedAccount(account) && !protectedAllowsLogin()) { this.destroySession(token); return null; }
    if (account.ban) return null;
    rec.seenAt = this.now();
    this.store.touch('sessions');
    return account;
  }

  destroySession(token) {
    if (typeof token !== 'string' || !token) return;
    this.destroySessionByHash(sha256(token));
  }

  /** 按 token 的 sha256 作废一条会话（多设备下只掉这一台）。 */
  destroySessionByHash(hash) {
    if (typeof hash !== 'string' || !hash) return;
    const rec = this.store.sessions.get(hash);
    if (!rec) return;
    this.store.sessions.delete(hash);
    const set = this.store.sessionOf.get(rec.accountId);
    if (set instanceof Set) {
      set.delete(hash);
      if (!set.size) this.store.sessionOf.delete(rec.accountId);
    }
    this.store.touch('sessions');
  }

  logout(token) { this.destroySession(token); }

  // ---- 资料 ----------------------------------------------------------------
  rename(accountId, nickname) {
    const account = this.store.get(accountId);
    if (!account) throw fail(401, 'E_AUTH', '请先登录');
    assertMutable(account, '修改昵称');
    const nick = sanitizeNickname(nickname);
    if (!nick) throw fail(400, 'E_NICK', '昵称不能为空');
    if (nick === account.nickname) return AccountService.view(account, { self: true });
    const ready = (account.nickChangedAt || 0) + RENAME_COOLDOWN_MS;
    if (this.now() < ready) throw fail(429, 'E_RENAME_COOLDOWN', `改名冷却中，还要等 ${Math.ceil((ready - this.now()) / 3600000)} 小时`);
    account.nickname = nick;
    account.nickChangedAt = this.now();
    this.store.put(account);
    return AccountService.view(account, { self: true });
  }

  /**
   * 资料：头像用**干员立绘**（avatarId = charId）；头像框按业主口径暂不做（frameId 不再读写）。
   */
  updateProfile(accountId, { avatarId, avatarSkin, cardId, cardVariant } = {}) {
    const account = this.store.get(accountId);
    if (!account) throw fail(401, 'E_AUTH', '请先登录');
    assertMutable(account, '修改资料');
    const clean = (v) => (v == null ? null : String(v).slice(0, 80) || null);
    if (avatarId !== undefined) account.avatarId = clean(avatarId);
    // 立绘样式（业主 2026-11-14）：默认立绘 = null，'__e2' = 精英 2，其余是皮肤 id（chars[charId].skins 的 key）
    if (avatarSkin !== undefined) account.avatarSkin = clean(avatarSkin);
    if (cardId !== undefined) account.cardId = clean(cardId);
    // 名片差分（业主 2026-11-14）：整数序号，交给客户端按 variants 数组取图
    if (cardVariant !== undefined) account.cardVariant = Number.isInteger(cardVariant) ? cardVariant : null;
    this.store.put(account);
    return AccountService.view(account, { self: true });
  }

  accountById(id) { return this.store.get(id) ? AccountService.view(this.store.get(id)) : null; }

  /** 设置/取消管理员（业主 2026-11-14）：只有后台能调，账号本身只存一个布尔。 */
  setAdmin(accountId, on) {
    const account = this.store.get(accountId);
    if (!account) throw fail(404, 'E_NOT_FOUND', '账号不存在');
    // 固定账号不可撤销/授予管理员（业主 2026-11-15）：身份恒为管理员
    assertMutable(account, '修改管理员身份');
    account.admin = !!on;
    this.store.put(account);
    return AccountService.view(account);
  }

  // ---- 管理员 --------------------------------------------------------------
  /** 管理员列表（带 QQ 号与封禁状态；不含哈希）。 */
  adminList({ query = '', limit = 200 } = {}) {
    const q = String(query || '').trim().toLowerCase();
    const rows = [];
    for (const a of this.store.list()) {
      if (q) {
        const hay = `${a.username} ${a.nickname} ${a.tag} ${a.id}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      rows.push({
        id: a.id, qq: a.username, nickname: a.nickname, tag: a.tag,
        // 业主 2026-11-15：后台要按这个字段显示「金色昵称 / ★ 取消管理员 / 置顶」——
        // 之前这里没返回 admin，前端拿到的永远是 undefined，按钮就一直停在「设为管理员」。
        admin: a.admin === true,
        // 固定账号（业主 2026-11-15）：后台据此禁用"封禁 / 重置密码 / 取消管理员"这些按钮
        protected: isProtectedAccount(a),
        createdAt: a.createdAt, lastSeenAt: a.lastSeenAt || 0,
        ban: a.ban ? { reason: a.ban.reason || '', at: a.ban.at, by: a.ban.by || '' } : null,
        hasSave: this.store.getSave(a.id) != null,
        online: false,
      });
    }
    rows.sort((x, y) => (y.lastSeenAt || 0) - (x.lastSeenAt || 0));
    return rows.slice(0, Math.max(1, Math.min(1000, Number(limit) || 200)));
  }

  ban(accountId, { reason = '', by = 'admin' } = {}) {
    const account = this.store.get(accountId);
    if (!account) throw fail(404, 'E_NO_ACCOUNT', '账号不存在');
    assertMutable(account, '封禁');
    account.ban = { at: this.now(), by: String(by).slice(0, 40), reason: String(reason || '').slice(0, 200) };
    this.store.put(account);
    // 封禁即踢下线：该账号的所有会话作废（多设备：全部）
    if (this.store.dropSessionsOf(accountId)) this.store.touch('sessions');
    return this.adminRowsOf(accountId);
  }

  unban(accountId) {
    const account = this.store.get(accountId);
    if (!account) throw fail(404, 'E_NO_ACCOUNT', '账号不存在');
    assertMutable(account, '解封');
    account.ban = null;
    this.store.put(account);
    return this.adminRowsOf(accountId);
  }

  /**
   * 管理员重命名（业主 2026-11-17）：后台直接改昵称，不受玩家侧 7 天改名冷却限制；
   * 但仍走同一套昵称校验与「固定账号不可改」的保护。
   * @param {string} accountId @param {string} nickname
   */
  adminRename(accountId, nickname) {
    const account = this.store.get(accountId);
    if (!account) throw fail(404, 'E_NO_ACCOUNT', '账号不存在');
    assertMutable(account, '修改昵称');
    const nick = sanitizeNickname(nickname);
    if (!nick) throw fail(400, 'E_NICK', '昵称不能为空');
    if (nick === account.nickname) return this.adminRowsOf(accountId);
    account.nickname = nick;
    // 记一次改名时间：避免玩家借后台改名绕过自己的冷却（后台可以反复改，玩家侧照旧按冷却走）
    account.nickChangedAt = this.now();
    this.store.put(account);
    return this.adminRowsOf(accountId);
  }

  /**
   * 管理员删除账号（业主 2026-11-17）：账号 + 云存档 + 会话一起删；固定账号不可删。
   * 社交关系（好友/黑名单/邀请）由调用方调 socialStore.purge 清掉。
   * @param {string} accountId
   * @returns {{ ok: true, id: string, nickname: string, qq: string }}
   */
  remove(accountId) {
    const account = this.store.get(accountId);
    if (!account) throw fail(404, 'E_NO_ACCOUNT', '账号不存在');
    assertMutable(account, '删除账号');
    const info = { ok: /** @type {true} */ (true), id: account.id, nickname: account.nickname, qq: account.username };
    this.store.remove(accountId);
    return info;
  }

  /**
   * 管理员重置密码（不接邮件，业主 2026-11-14 口径）。
   * @param {string} accountId @param {string} newPassword
   */
  async resetPassword(accountId, newPassword) {
    const account = this.store.get(accountId);
    if (!account) throw fail(404, 'E_NO_ACCOUNT', '账号不存在');
    assertMutable(account, '重置密码');
    const err = checkPassword(newPassword);
    if (err) throw fail(400, 'E_PASSWORD', err);
    const { salt, hash } = await hashPassword(newPassword);
    account.salt = salt;
    account.hash = hash;
    this.store.put(account);
    // 改密后旧会话全失效（多设备：每一条都作废，逼所有人重新登录）
    if (this.store.dropSessionsOf(accountId)) this.store.touch('sessions');
    return { ok: true };
  }

  adminRowsOf(accountId) { return this.adminList({ query: accountId, limit: 1 })[0] || null; }

  // ---- 云存档 --------------------------------------------------------------
  getSave(accountId) {
    const save = this.store.getSave(accountId);
    return save ? { ...save, fields: this.pickFields(save) } : null;
  }

  pickFields(save) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const f of SAVE_FIELDS) if (save && save[f] !== undefined) out[f] = save[f];
    return out;
  }

  /** 全量写入（客户端已合并好）。字段白名单 + 512KB 上限。 */
  putSave(accountId, save) {
    const doc = this.validateSave(save);
    return this.store.putSave(accountId, doc);
  }

  validateSave(save) {
    if (!save || typeof save !== 'object') throw fail(400, 'E_SAVE', '存档格式不对');
    /** @type {Record<string, any>} */
    const doc = {};
    for (const f of SAVE_FIELDS) if (save[f] !== undefined && save[f] !== null) doc[f] = save[f];
    let text;
    try { text = JSON.stringify(doc); } catch { throw fail(400, 'E_SAVE', '存档无法序列化'); }
    if (Buffer.byteLength(text, 'utf8') > SAVE_MAX_BYTES) throw fail(413, 'E_SAVE_BIG', '存档超过 512KB 上限');
    return doc;
  }

  /**
   * 首次登录合并：把浏览器里的本地存档并进账号，返回合并结果（客户端据此覆盖本地）。
   * 规则（可预测、不丢数据）：对象递归合并；数字取较大值；数组取并集；其余 incoming 优先。
   */
  mergeSave(accountId, incoming) {
    const base = this.getSave(accountId)?.fields || {};
    const merged = mergeValue(base, this.validateSave(incoming));
    return this.store.putSave(accountId, merged);
  }
}

/** 通用的「取并集、取更大」合并（纯函数，测试单独覆盖）。 */
export function mergeValue(a, b) {
  if (b === undefined) return a;
  if (a === undefined) return b;
  if (Array.isArray(a) && Array.isArray(b)) {
    const out = [...a];
    for (const v of b) {
      const hit = out.findIndex((x) => JSON.stringify(x) === JSON.stringify(v));
      if (hit < 0) out.push(v);
    }
    return out;
  }
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    /** @type {Record<string, any>} */
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = mergeValue(a[k], b[k]);
    return out;
  }
  if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b);
  return b;
}

export { SESSION_TTL_MS, RENAME_COOLDOWN_MS, SAVE_MAX_BYTES, ID_RE, fail };
