// server/accounts/passwords.js — 密码哈希（node:crypto 的 scrypt，零依赖）。
//
// 参数取 OWASP 建议区间：N=2^15, r=8, p=1，单次约 50–80ms（够挡离线爆破，又不至于登录明显卡顿）。
// 存的是 `salt`（16 字节随机 hex）与 `hash`（64 字节 hex），校验用 timingSafeEqual 防时序侧信道。
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 96 * 1024 * 1024;

const scrypt = (password, salt, keylen) => new Promise((resolve, reject) => {
  scryptCb(password, salt, keylen, { N, r: R, p: P, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
});

/** 密码格式校验（长度按字符计，8–128；不强制复杂度，避免把玩家挡在门外）。 */
export function checkPassword(password) {
  if (typeof password !== 'string') return '密码必须是字符串';
  const n = [...password].length;
  if (n < 8) return '密码至少 8 位';
  if (n > 128) return '密码最长 128 位';
  return null;
}

/**
 * @param {string} password
 * @returns {Promise<{ salt: string, hash: string }>}
 */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN);
  return { salt: salt.toString('hex'), hash: key.toString('hex') };
}

/**
 * @param {string} password
 * @param {string} saltHex
 * @param {string} hashHex
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, saltHex, hashHex) {
  try {
    const salt = Buffer.from(String(saltHex || ''), 'hex');
    const want = Buffer.from(String(hashHex || ''), 'hex');
    if (!salt.length || want.length !== KEYLEN) return false;
    const got = await scrypt(password, salt, KEYLEN);
    return timingSafeEqual(got, want);
  } catch {
    return false;
  }
}
