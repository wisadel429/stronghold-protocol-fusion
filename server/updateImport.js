// server/updateImport.js — 热更包的解压与分类（启动器接口 server/updateApi.js 与服务器后台 server/admin.js 共用）。
//
// 只做四件事，全部与「谁来触发」无关：
//   1. readRawBody   读请求体（带上限）
//   2. listZip       用 bsdtar 列条目 —— 不解压就能先查路径安全
//   3. importZip     校验 + 解压到安装根目录，并按目录前缀分类
//   4. classify      把路径分成 public / data / shared / server / other
//
// 为什么分类很重要（业主 2026-11-14「在不重启服务器的前提下热更」）：
//   * public/**、data/**  —— 静态文件从磁盘现读，**立即生效**，玩家刷新页面就拿到新代码；
//   * server/**  —— 运行中的 Node 进程不会重新 import，**必须重启**才生效（覆盖到磁盘是无害的）；
//   * shared/**  —— 浏览器和服务端都引用：磁盘改了浏览器立刻拿到新版本，而服务端还是旧的，
//                   **可能两边不一致**，所以要显式提示尽快重启。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const MAX_FILES = 200_000;
export const MAX_TOTAL = 6 * 1024 * 1024 * 1024;

/** 读请求体；超过 limit 返回 null。 */
export function readRawBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { finish(null); try { req.destroy(); } catch { /* ignore */ } return; }
      chunks.push(c);
    });
    req.on('end', () => finish(Buffer.concat(chunks)));
    req.on('error', () => finish(null));
  });
}

/**
 * 列出 zip 条目：[{ kind, size, name }]；解析失败返回 null。
 * -v 才有类型与大小，所以用 `tar -tvf`。
 */
export function listZip(file) {
  let out;
  try {
    out = execFileSync('tar', ['-t', '-v', '-f', file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch { return null; }
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // bsdtar -tv 形如：-rw-r--r--  0 user  group  1234 Oct 25 16:52 name
    const m = /^([dlbcps-])[rwxsStT-]{9}\s+\S+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.*)$/.exec(line);
    if (!m) return null;
    rows.push({ kind: m[1], size: Number(m[2]), name: m[3] });
  }
  return rows;
}

/** 所有条目都在同一个顶层文件夹里时返回该文件夹名，否则 null。 */
export function commonPrefix(names) {
  if (!names.length) return null;
  const parts = names.map((n) => n.split('/'));
  if (parts.some((p) => p.length < 2)) return null;
  const first = parts[0][0];
  return parts.every((p) => p[0] === first) ? first : null;
}

/** 安全与体量检查；通过返回 null，否则返回 { error, message }。 */
export function checkEntries(rows) {
  if (!rows || !rows.length) return { error: 'BAD_ZIP', message: '压缩包读不出来（损坏或不是 zip）' };
  if (rows.length > MAX_FILES) return { error: 'TOO_MANY_FILES', message: `条目太多（${rows.length}）` };
  for (const r of rows) {
    if (r.kind !== '-' && r.kind !== 'd') return { error: 'UNSAFE_ENTRY', message: `含符号链接/特殊文件：${r.name}` };
    if (r.name.startsWith('/') || r.name.split('/').includes('..')) return { error: 'UNSAFE_PATH', message: `含越界路径：${r.name}` };
  }
  const total = rows.reduce((s, r) => s + (r.kind === '-' ? r.size : 0), 0);
  if (total > MAX_TOTAL) return { error: 'TOO_BIG', message: '解压后体积过大' };
  return null;
}

/** 路径分类：决定「要不要重启」和「玩家刷新能不能拿到」。 */
export function classify(rel) {
  if (rel.startsWith('public/')) return 'public';
  if (rel.startsWith('data/')) return 'data';
  if (rel.startsWith('shared/')) return 'shared';
  if (rel.startsWith('server/')) return 'server';
  return 'other';
}

/**
 * 解压一个热更包到 `root`。
 * @param {{ root: string, file: string, log?: any }} o
 * @returns {{ ok: true, kind: string, files: number, dirs: number, bytes: number, strip: number,
 *             changed: Record<string, number>, needsRestart: boolean, warnings: string[] }
 *          | { ok: false, error: string, message: string }}
 */
export function importZip({ root, file, log = console }) {
  const rows = listZip(file);
  const bad = checkEntries(rows);
  if (bad) return { ok: false, ...bad };

  const names = rows.map((r) => r.name);
  const prefix = commonPrefix(names);
  const strip = prefix ? 1 : 0;
  const relOf = (n) => (strip ? n.split('/').slice(1).join('/') : n);

  const isUpdatePackage = names.some((n) => {
    const p = relOf(n);
    return p === 'UPDATE.json' || p === 'MANIFEST.json';
  });

  const changed = { public: 0, data: 0, shared: 0, server: 0, other: 0 };
  const warnings = [];
  for (const r of rows) {
    if (r.kind !== '-') continue;
    const rel = relOf(r.name);
    if (!rel) continue;
    changed[classify(rel)]++;
  }

  try {
    const args = ['-x', '-f', file, '-C', root, '--no-same-owner'];
    if (strip) args.push('--strip-components', '1');
    execFileSync('tar', args, { stdio: 'ignore' });
  } catch (e) {
    log.error?.(`[update] 解压失败：${e?.message || e}`);
    return { ok: false, error: 'EXTRACT_FAILED', message: String(e?.message || e) };
  }

  if (changed.server) warnings.push(`server/ 有 ${changed.server} 个文件：运行中的进程不会立即生效，重启服务器后才会用上新代码`);
  if (changed.shared) warnings.push(`shared/ 有 ${changed.shared} 个文件：浏览器会立刻拿到新版本而服务端仍是旧的，两边可能不一致，请尽快重启`);

  const files = rows.filter((r) => r.kind === '-').length;
  const dirs = rows.length - files;
  const bytes = rows.reduce((s, r) => s + (r.kind === '-' ? r.size : 0), 0);
  return {
    ok: true,
    kind: isUpdatePackage ? 'update' : 'patch',
    files, dirs, bytes, strip, changed,
    needsRestart: !!(changed.server || changed.shared),
    warnings,
  };
}

/** 临时文件路径（用完必须删）。 */
export function tempZipPath(root) {
  const dir = path.join(root, '.cache');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `incoming-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`);
}
