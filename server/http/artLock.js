// server/http/artLock.js — 美术资源「落盘加密、服务端透明解密」（业主 2026-11-15）。
//
// 目标：有人从安装包里直接拷走 `public/assets/char/*.png` 时，拿到的是密文，双击打不开。
//       浏览器/游戏照常显示，因为请求会到这里被解开。
//
// 设计（刻意做得极简、可增量、零配置）：
//   · 加密文件自带魔数头 `SPLOCK1`，**不需要清单文件** —— 服务端读到魔数就解密，没加密的照常走原流程。
//   · 所以可以分批加密（先角色立绘，以后再加别的），未加密的文件行为完全不变。
//   · 密钥放在 `data/art-key.json`（base64 的 32 字节），**不进分发包**；没有这个文件就整个功能自动关闭。
//   · 只拦指定前缀（默认 /assets/char/、/assets/spine/），音频不加密（音频要支持 Range 拖动）。
//
// 文件格式：`SPLOCK1`(7) | iv(12) | authTag(16) | ciphertext
// 算法：AES-256-GCM（带认证，改一个字节就解不开）

import fs from 'node:fs';
import path from 'node:path';
import { createDecipheriv } from 'node:crypto';
import { MIME } from './files.js';
import { splitHashedPath } from '../../shared/assetPaths.js';

export const ART_MAGIC = Buffer.from('SPLOCK1', 'utf8');
export const ART_HEADER = 7 + 12 + 16; // 35

/** 读 data/art-key.json；读不到 / 格式不对 → null */
export function loadArtKey(root) {
  try {
    const p = path.join(root, 'data', 'art-key.json');
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!j || typeof j.key !== 'string') return null;
    const buf = Buffer.from(j.key, 'base64');
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

/** 明文是否被加密过（读前 7 字节判断，用于加密工具的幂等判断） */
export function isEncrypted(buf) {
  return buf.length > ART_HEADER && buf.subarray(0, 7).equals(ART_MAGIC);
}

/**
 * @param {{ root: string, prefixes?: string[], log?: any }} opts
 * @returns {{ enabled: boolean, handle: (req, res, rawPath: string) => Promise<boolean> }}
 */
export function createArtLock({ root, prefixes = ['/assets/char/', '/assets/spine/', '/assets/skins/', '/assets/namecard/', '/assets/ui/', '/assets/skill/', '/assets/enemy/', '/assets/relics/', '/assets/band/', '/assets/bond/', '/assets/item/', '/assets/token/', '/assets/annihilation-intro/', '/ui-art/img/', '/ui-art/fonts-ark/'], log = null } = {}) {
  const key = loadArtKey(root);
  const pub = path.join(root, 'public');
  const list = prefixes.map((p) => (p.startsWith('/') ? p : '/' + p));

  if (!key) {
    return {
      enabled: false,
      handle: async () => false,
    };
  }
  log?.info?.(`[artlock] 已启用：前缀 ${list.join(', ')}`);

  return {
    enabled: true,
    /**
     * 命中并处理了返回 true；否则 false（交给原来的静态流程）。
     */
    async handle(req, res, rawPath) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return false;
      let p = rawPath.split('?')[0];
      try { p = decodeURIComponent(p); } catch { /* 保持原样 */ }
      // 服务端下发的清单给的是内容哈希 URL（/assets/~<16位hex>/char/... ，shared/assetPaths.js）。
      // static.js 是先调 artLock、之后才 stripHashedPath，所以这里必须自己剥掉那一段，
      // 否则前缀匹配不上 → 密文被当成原文件直接发出去 → 浏览器解码失败（卡牌头像黑块）。
      p = splitHashedPath(p).path;
      if (!p.startsWith('/') || !list.some((pre) => p.startsWith(pre))) return false;

      const abs = path.normalize(path.join(pub, p.slice(1)));
      if (!abs.startsWith(pub)) return false; // 目录穿越保护

      let buf;
      let st;
      try {
        st = await fs.promises.stat(abs);
        if (!st.isFile()) return false;
        if (st.size < ART_HEADER + 8) return false;
        buf = await fs.promises.readFile(abs);
      } catch {
        return false; // 文件不存在 → 让原流程去 404
      }
      if (!isEncrypted(buf)) return false; // 未加密：原流程照常

      const iv = buf.subarray(7, 19);
      const tag = buf.subarray(19, 35);
      const body = buf.subarray(35);
      let plain;
      try {
        const d = createDecipheriv('aes-256-gcm', key, iv);
        d.setAuthTag(tag);
        plain = Buffer.concat([d.update(body), d.final()]);
      } catch (e) {
        log?.warn?.('[artlock] 解密失败（密钥不匹配或文件损坏）', p, e && e.message);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('art decrypt failed');
        return true;
      }

      const ext = path.extname(abs).toLowerCase();
      // 版本前缀 art2：修复「哈希段 URL 返回密文」那次事故前，浏览器按旧 ETag 缓存了密文响应，
      // 而密文的大小/mtime 都没变，不换前缀就会一直命中旧缓存（图片显示成文字/黑块）。改前缀 = 强制重新取。
      const etag = `"art2-${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': plain.length,
        ETag: etag,
        'Last-Modified': st.mtime.toUTCString(),
        'Cache-Control': 'public, max-age=3600',
        'X-Art-Lock': '1',
      };
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        res.end();
        return true;
      }
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : plain);
      return true;
    },
  };
}
