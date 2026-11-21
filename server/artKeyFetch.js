// server/artKeyFetch.js — 美术资源密钥：优先用「包体内自带」，缺失时才联网领取
//
// 背景：资源是加密落盘的（见 http/artLock.js）。
//
// 业主 2026-11-21「将解密用的密钥直接放到游戏包体里吧」：
//   分发包里带一份 `packed/art-key.json`，启动时直接拷进 data/art-key.json 并生效，
//   不再依赖那次联网领取 —— 断网、领钥匙接口按 IP 限流（每小时 5 次）、
//   或者主服务器临时不可用，都不会再出现「素材破图 / 未获取密钥」。
//
// 代价（业主已知情并确认）：包里带钥匙，等于拿到包的人就能解开美术资源，
//   原先「必须装一次、连一次网才拿得到钥匙」的防盗拷作用随之取消。
//
// 失败处理：连包里的也没有、又领不到时**不要卡死启动**，只打警告；
//   资源解不开表现为破图，不会让整个游戏起不来。

import fs from 'node:fs';
import path from 'node:path';

/** 主服务器地址：可用环境变量 SP_ART_KEY_URL 覆盖（默认指向线上）。 */
export const DEFAULT_KEY_URL = 'http://8.134.50.56:3000/api/art-key';

/** 包体内自带密钥的位置（相对安装根目录）；旧包可能没有这个文件。 */
export const BUNDLED_KEY_FILE = path.join('packed', 'art-key.json');

function keyPath(root) {
  return path.join(root, 'data', 'art-key.json');
}

function readKeyFile(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const candidate of [j && j.key, typeof j === 'string' ? j : null]) {
      if (typeof candidate !== 'string' || !candidate) continue;
      const buf = Buffer.from(candidate.trim(), 'base64');
      if (buf.length === 32) return buf.toString('base64');
    }
  } catch { /* 文件不存在或不是 JSON */ }
  return null;
}

/** 读包体内自带的密钥；没有 / 损坏 → null。 */
export function loadBundledKey(root) {
  return readKeyFile(path.join(root, BUNDLED_KEY_FILE));
}

/** 本地是否已有合法密钥（32 字节 base64）。 */
export function hasArtKey(root) {
  return readKeyFile(keyPath(root)) !== null;
}

/** 把密钥写进 data/art-key.json。 */
function writeKey(root, keyBase64, from) {
  const target = keyPath(root);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ v: 1, key: keyBase64, from, at: new Date().toISOString() }, null, 2), 'utf8');
}

/**
 * 保证本地有密钥：已有 → 包体内自带 → 联网领取。
 * @param {{ root: string, url?: string, log?: any, timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function ensureArtKey({ root, url = process.env.SP_ART_KEY_URL || DEFAULT_KEY_URL, log = null, timeoutMs = 8000 } = {}) {
  if (hasArtKey(root)) return { ok: true, reason: 'cached' };

  // 包体内自带（业主 2026-11-21）：直接落盘，不联网
  const bundled = loadBundledKey(root);
  if (bundled) {
    try {
      writeKey(root, bundled, 'bundled');
      log?.info?.('[artkey] 已使用包体内自带的资源密钥（无需联网领取）');
      return { ok: true, reason: 'bundled' };
    } catch (e) {
      log?.warn?.(`[artkey] 包内密钥写入失败：${e && e.message || e}`);
    }
  }

  // 服务器自己就是主服务器（或明确关掉）时不必去要
  if (String(process.env.SP_ART_KEY_FETCH || '1') === '0') return { ok: false, reason: 'disabled' };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { 'user-agent': 'Stronghold-Protocol-artkey/1' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const buf = Buffer.from(String(j.key || ''), 'base64');
      if (buf.length !== 32) throw new Error('密钥长度不对');
      writeKey(root, buf.toString('base64'), 'remote');
      log?.info?.(`[artkey] 已从主服务器领取资源密钥（第 ${attempt} 次尝试）`);
      return { ok: true, reason: 'fetched' };
    } catch (e) {
      log?.warn?.(`[artkey] 第 ${attempt}/3 次领取失败：${e && e.message || e}`);
      if (attempt < 3) await new Promise((res) => setTimeout(res, 1200 * attempt));
    }
  }
  log?.warn?.('[artkey] 没能领到资源密钥：加密资源将显示为破图。联网后重开一次即可。');
  return { ok: false, reason: 'unreachable' };
}
