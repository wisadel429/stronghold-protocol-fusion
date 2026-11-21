// server/updateApi.js — 启动器 / 浏览器用的「导入热更包」接口。
//
//   POST /api/update/import        body = zip 原始字节（content-type 不限）
//   响应 { ok, kind, files, dirs, bytes, restart, message }
//
// 为什么放在服务端：启动器宿主 Stronghold.exe 是编译好的薄壳，没有导入消息可接；
// 而 server/update.js 本来就有「覆盖解压 → 启动时校验 MANIFEST/UPDATE」的完整机制。
// 于是让本地服务代劳解压，宿主与页面都不用改代码：
//   1. 官方热更包（根目录带 UPDATE.json + MANIFEST.json）→ 解压后由下次启动的
//      applyPendingUpdate 校验、删旧文件、完成更新；
//   2. WinRAR 随手做的「纯文件覆盖包」（只有改动文件）→ 直接覆盖，下次启动照常。
//
// 安全（只给本机用）：
//   * 仅接受回环地址（127.0.0.1 / ::1）发起的请求，外网/局域网一律 403；
//   * 只接受 POST；
//   * 大小上限（默认 512 MB，SP_UPDATE_MAX_MB 可调）；
//   * 解压前先用 `tar -t -v` 列目录，拒绝绝对路径、`..`、符号链接/设备文件；
//     条目数与解压后总量都设上限，防压缩炸弹；
//   * 压缩包若统一包在单个顶层文件夹里（比如整包 zip），自动剥掉这一层。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isLocalIp, clientAddress } from './net.js';

const FIELD = '/api/update/import';
const MAX_FILES = 200_000;
const MAX_TOTAL = 6 * 1024 * 1024 * 1024;

const json = (res, status, body) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(text);
};

/** 读请求体，超过 limit 直接拒绝（返回 null）。 */
function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { finish(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => finish(Buffer.concat(chunks)));
    req.on('error', () => finish(null));
  });
}

/** 列出 zip 条目：[{ name, dir, size, link }]；解析失败返回 null。 */
function listZip(file) {
  let out;
  try {
    out = execFileSync('tar', ['-t', '-v', '-f', file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch { return null; }
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // bsdtar -tv 形如：-rw-r--r--  0 user  group  1234 Oct 25 16:52 name
    const m = /^([dlbcps-])[rwxsStT-]{9}\s+\S+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.*)$/.exec(line);
    if (!m) return null;                       // 看不懂的格式：宁可拒绝
    rows.push({ kind: m[1], size: Number(m[2]), name: m[3] });
  }
  return rows;
}

/** 统一的前缀（所有条目都在同一个顶层文件夹里时返回该文件夹名）。 */
function commonPrefix(names) {
  const parts = names.map((n) => n.split('/'));
  if (parts.some((p) => p.length < 2)) return null;
  const first = parts[0][0];
  return parts.every((p) => p[0] === first) ? first : null;
}

/**
 * @param {{ root: string, log?: any, trustProxy?: any, maxBytes?: number }} opts
 * @returns {{ handles: (p: string) => boolean, handle: (req: any, res: any, p: string) => Promise<void> }}
 */
export function createUpdateApi({ root, log = console, trustProxy = 'auto', maxBytes = 0 }) {
  const limit = maxBytes || (Number(process.env.SP_UPDATE_MAX_MB) || 512) * 1024 * 1024;

  return {
    handles: (rawPath) => rawPath === FIELD || rawPath === `${FIELD}/`,

    async handle(req, res, rawPath) {
      void rawPath;
      const ip = (() => { try { return clientAddress(req, trustProxy).ip; } catch { return ''; } })();
      if (!isLocalIp(ip)) { json(res, 403, { ok: false, error: 'LOCAL_ONLY', message: '只有本机可以导入热更包' }); return; }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' });
        res.end(); return;
      }
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST');
        json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
        return;
      }

      const body = await readBody(req, limit);
      if (!body) { json(res, 413, { ok: false, error: 'TOO_LARGE', message: `热更包超过 ${Math.round(limit / 1024 / 1024)} MB` }); return; }
      if (body.length < 4 || body[0] !== 0x50 || body[1] !== 0x4b) { json(res, 400, { ok: false, error: 'NOT_ZIP', message: '不是 zip 文件' }); return; }

      const tmpDir = path.join(root, '.cache');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmp = path.join(tmpDir, `incoming-${Date.now()}.zip`);
      fs.writeFileSync(tmp, body);

      try {
        const rows = listZip(tmp);
        if (!rows || !rows.length) { json(res, 400, { ok: false, error: 'BAD_ZIP', message: '压缩包读不出来（损坏或不是 zip）' }); return; }

        if (rows.length > MAX_FILES) { json(res, 400, { ok: false, error: 'TOO_MANY_FILES', message: `条目太多（${rows.length}）` }); return; }
        for (const r of rows) {
          if (r.kind !== '-' && r.kind !== 'd') { json(res, 400, { ok: false, error: 'UNSAFE_ENTRY', message: `含符号链接/特殊文件：${r.name}` }); return; }
          if (r.name.startsWith('/') || r.name.split('/').includes('..')) { json(res, 400, { ok: false, error: 'UNSAFE_PATH', message: `含越界路径：${r.name}` }); return; }
        }
        const total = rows.reduce((s, r) => s + (r.kind === '-' ? r.size : 0), 0);
        if (total > MAX_TOTAL) { json(res, 400, { ok: false, error: 'TOO_BIG', message: '解压后体积过大' }); return; }

        const names = rows.map((r) => r.name);
        const prefix = commonPrefix(names);
        const strip = prefix ? 1 : 0;
        const hasMeta = names.some((n) => {
          const p = strip ? n.split('/').slice(1).join('/') : n;
          return p === 'UPDATE.json' || p === 'MANIFEST.json';
        });
        const kind = hasMeta ? 'update' : 'patch';

        const args = ['-x', '-f', tmp, '-C', root, '--no-same-owner'];
        if (strip) args.push('--strip-components', '1');
        execFileSync('tar', args, { stdio: 'ignore' });

        const fileCount = rows.filter((r) => r.kind === '-').length;
        const dirCount = rows.length - fileCount;
        log.info?.(`[update] 已导入热更包：${fileCount} 个文件${dirCount ? ` / ${dirCount} 个目录` : ''}（${kind}）`);
        json(res, 200, {
          ok: true, kind, files: fileCount, dirs: dirCount, bytes: total, strip,
          restart: true,
          message: kind === 'update'
            ? '已导入更新包，重启启动器后自动校验并应用'
            : '已覆盖文件，重启启动器后生效',
        });
      } catch (e) {
        log.error?.(`[update] 导入失败：${e?.message || e}`);
        json(res, 500, { ok: false, error: 'IMPORT_FAILED', message: String(e?.message || e) });
      } finally {
        try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      }
    },
  };
}
