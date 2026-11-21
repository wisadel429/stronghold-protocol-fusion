// server/accounts/protected.js — 固定账号（业主 2026-11-15）
//
// 游戏里有一条**动不了**的账号（彩蛋 / 纪念碑）：
//   不可修改、不可删除、不可封禁、不可登录、不可撤销管理员、不可重置密码。
//
// 两层实现：
//   ① 每个会改账号的入口先过 `isProtectedAccount()`，命中就抛 403 E_PROTECTED
//      （登录 / 建会话 / token 解析 / 改名 / 改资料 / 封禁 / 解封 / 设撤管理员 / 重置密码）；
//   ② 启动时 `ensureProtectedAccount()` 按下面的**规范记录**校正并补回这条账号。
//      所以直接改 data/accounts.json 把它删掉、把 admin 改成 false、或换掉密码哈希，
//      重启后都会被改回规范值 —— 这就是「不可删除」的兜底（本仓目前没有删除账号的接口，
//      将来就算加了，重启也会把它补回来）。
//
// 「不可登录」还顺带废掉了密码：规范记录里的 salt/hash 是**永远匹配不上任何口令**的占位值，
// 而且登录在人脸校验密码**之前**就拒（不会泄露"密码对不对"）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 固定账号的 id。 */
export const PROTECTED_ACCOUNT_IDS = Object.freeze(['acc_8306d7fa085a8514']);
/** 固定账号的 QQ 号（双保险：id 或 QQ 任一对上都算固定账号）。 */
export const PROTECTED_USERNAMES = Object.freeze(['2331528852']);

// ---- 「允许登录」开关（业主 2026-11-15）---------------------------------------------------------
//
// 默认（任何分发包 / 本机）：**连登录都锁死**。
// 线上那台要保留业主自己的登录，因此给一个显式开关，两种写法任一即可：
//   ① 环境变量 `SP_PROTECTED_ALLOW_LOGIN=1`
//   ② 安装根目录放一个标记文件 `protected-allow-login.flag`（热更就能上传，不需要改启动方式）
// 打开后只放开「登录 / 会话」，删改封/撤管理员/改名改资料/重置密码**照样拦**，
// 并且启动校正时**不碰密码哈希、不清会话**（否则一重启就把自己锁在外面）。
const FLAG_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'protected-allow-login.flag');

/** 这台安装是不是允许固定账号登录（默认 false = 全锁）。 */
export function protectedAllowsLogin() {
  if (/^(1|true|yes|on)$/i.test(String(process.env.SP_PROTECTED_ALLOW_LOGIN || '').trim())) return true;
  try { return fs.existsSync(FLAG_FILE); } catch { return false; }
}

/**
 * 规范记录：启动时按它校正。`salt` / `hash` 是全零占位（scrypt 结果不可能等于它），
 * 所以即使有人绕过「不可登录」的守卫，也验不过任何密码。
 */
export const PROTECTED_ACCOUNT_SEED = Object.freeze({
  id: 'acc_8306d7fa085a8514',
  username: '2331528852',
  usernameLower: '2331528852',
  tag: '3250',
  nickname: 'Mon3tr',
  avatarId: 'char_4179_monstr',
  avatarSkin: '__e2',
  cardId: 'card_e6d26fa1',
  cardVariant: 1,
  admin: true,
  ban: null,
  nickChangedAt: 0,
  // 占位哈希：不可用（登录已被拒绝，这串也验不通任何口令）
  salt: '00000000000000000000000000000000',
  hash: '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
});

/**
 * 这条账号是不是固定账号（按 id 或 QQ 号判断）。
 * @param {{ id?: string, username?: string }|null|undefined} account
 * @returns {boolean}
 */
export function isProtectedAccount(account) {
  if (!account) return false;
  if (PROTECTED_ACCOUNT_IDS.includes(String(account.id || ''))) return true;
  return PROTECTED_USERNAMES.includes(String(account.username || ''));
}

/** 规范记录里那些「必须一致」的字段（比对用）。 */
const CANON_FIELDS = ['id', 'username', 'usernameLower', 'tag', 'nickname', 'avatarId', 'avatarSkin', 'cardId', 'cardVariant', 'admin', 'ban'];

/**
 * 启动时调用：把固定账号校正成规范记录（不在就补回来）；不允许登录时顺带作废它的会话。
 * 允许登录的安装（线上）**不动 salt/hash、不清会话**，否则一重启业主自己就登不进去了。
 * 失败只返回结果，不抛——不能因为这条账号拖垮整个服务启动。
 * @param {{ store: { get: Function, byName?: Function, put: Function, sessions?: Map, sessionOf?: Map, touch?: Function } }} service
 * @returns {{ created: boolean, fixed: boolean, ok: boolean, allowLogin: boolean }}
 */
export function ensureProtectedAccount(service) {
  const store = service && service.store;
  const allowLogin = protectedAllowsLogin();
  if (!store || typeof store.put !== 'function' || typeof store.get !== 'function') {
    return { created: false, fixed: false, ok: false, allowLogin };
  }
  const want = PROTECTED_ACCOUNT_SEED;
  let cur = null;
  try {
    cur = store.get(want.id) || (typeof store.byName === 'function' ? store.byName(want.usernameLower) : null) || null;
  } catch { cur = null; }

  const created = !cur;
  // 允许登录时：不动密码；也不拿占位哈希去覆盖真实密码
  const canonical = allowLogin ? { ...want, salt: (cur && cur.salt) || want.salt, hash: (cur && cur.hash) || want.hash } : want;
  const fixed = !cur || CANON_FIELDS.some((k) => JSON.stringify(cur[k] ?? null) !== JSON.stringify(want[k] ?? null))
    || (!allowLogin && (cur.salt !== want.salt || cur.hash !== want.hash));
  if (fixed) {
    const next = {
      ...(cur || {}),
      ...canonical,
      // 这些「出生信息」只补不覆盖：老账号有就保留
      createdAt: (cur && Number.isFinite(cur.createdAt)) ? cur.createdAt : 1794642537261,
      lastSeenAt: cur && Number.isFinite(cur.lastSeenAt) ? cur.lastSeenAt : 0,
    };
    try { store.put(next); } catch { return { created, fixed: false, ok: false, allowLogin }; }
  }

  // 不可登录的安装：这个账号名下的会话一律作废（旧 cookie 立刻失效）
  if (!allowLogin) {
    try {
      if (store.sessions instanceof Map && store.sessionOf instanceof Map) {
        let dropped = 0;
        for (const [hash, rec] of [...store.sessions]) {
          if (rec && (rec.accountId === want.id || String(rec.accountId || '') === want.id)) { store.sessions.delete(hash); dropped++; }
        }
        // 多设备（业主 2026-11-21）：sessionOf 里每个账号对应的是 tokenHash 集合，逐条删
        for (const [accountId, val] of [...store.sessionOf]) {
          if (accountId !== want.id) continue;
          const hashes = val instanceof Set ? [...val] : [val];
          for (const h of hashes) if (h && store.sessions.delete(h)) dropped++;
          store.sessionOf.delete(accountId);
        }
        if (dropped && typeof store.touch === 'function') store.touch('sessions');
      }
    } catch { /* 会话清理失败不影响结论 */ }
  }

  return { created, fixed, ok: true, allowLogin };
}
