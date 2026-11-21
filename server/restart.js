// server/restart.js — 远程自重启（业主 2026-11-14）。
//
// 场景：Win10 上手动双击 Stronghold.exe 起服，没有 NSSM / 计划任务之类的守护进程，
// 所以「重启」不能简单 process.exit —— 退了就没人拉起来。
//
// 做法（不依赖任何守护进程、也不改启动器）：
//   1. 先做语法自检：对 server/**、shared/** 的 .js/.mjs 跑 `node --check`。任何一个不过就**拒绝重启**
//      （这条最关键：否则重启后新进程直接崩，网站就真挂了）。
//   2. 写一个极小的中继脚本到 .cache/restart-relay.mjs，用 detached 方式拉起它；中继等上一小会儿
//      （让旧进程先把 3000 端口放掉）再 spawn 一个新的 `node server/index.js`，输出重定向到
//      .cache/restart.log。
//   3. 旧进程回完 HTTP 响应后退出。新进程与启动器无关，启动器窗口就算显示「已停止」也不影响服务。
//
// 失败兜底：日志写在 .cache/restart.log；真起不来时人工双击 Stronghold.exe 即可恢复（文件都在磁盘上）。

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

/** 需要自检的目录（相对安装根目录）。 */
const CHECK_DIRS = ['server', 'shared'];
const CHECK_EXT = new Set(['.js', '.mjs']);

function walk(dir, rel, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.cache') continue;
      walk(abs, childRel, out);
    } else if (e.isFile() && CHECK_EXT.has(path.extname(e.name))) {
      out.push(childRel);
    }
  }
}

/**
 * 语法自检：只检查**最近改过**的文件（默认 15 分钟内）+ 入口文件 server/index.js。
 * 全量检 600 多个文件要 spawn 600 次 node，二十多秒太久；热更刚写完的文件才是风险点。
 * @param {string} root
 * @param {{ newerThan?: number, always?: string[] }} [o]
 * @returns {{ checked: number, bad: {file: string, message: string}[] }}
 */
export function syntaxCheck(root, { newerThan = Date.now() - 15 * 60 * 1000, always = ['server/index.js'] } = {}) {
  const all = [];
  for (const d of CHECK_DIRS) walk(path.join(root, d), d, all);
  const files = [];
  for (const rel of all) {
    if (always.includes(rel)) { files.push(rel); continue; }
    let st;
    try { st = fs.statSync(path.join(root, ...rel.split('/'))); } catch { continue; }
    if (st.mtimeMs >= newerThan) files.push(rel);
  }
  const bad = [];
  for (const rel of files) {
    const abs = path.join(root, ...rel.split('/'));
    try {
      execFileSync(process.execPath, ['--check', abs], { stdio: 'ignore', timeout: 20000 });
    } catch (e) {
      const msg = String((e && (e.stderr || e.message)) || e).split('\n').slice(0, 3).join(' ').slice(0, 300);
      bad.push({ file: rel, message: msg });
    }
  }
  return { checked: files.length, bad };
}

const RELAY = String.raw`
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [root, logPath, delayMs, port] = process.argv.slice(2);
await new Promise((r) => setTimeout(r, Number(delayMs) || 1500));
fs.mkdirSync(root + '/.cache', { recursive: true });
const out = fs.openSync(logPath, 'a');
const stamp = () => new Date().toISOString();
fs.writeSync(out, '\n[relay ' + stamp() + '] 旧进程已退出，启动新服务器…\n');
const child = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(port || process.env.PORT || 3000) },
  detached: true,
  stdio: ['ignore', out, out],
});
child.unref();
fs.writeSync(out, '[relay ' + stamp() + '] 新进程 pid=' + child.pid + '\n');
`;

/**
 * 安排一次自重启：先写中继脚本并 detached 拉起，然后调用方应尽快 `process.exit(0)`。
 * @param {{ root: string, port?: number|string, delayMs?: number, log?: any }} o
 * @returns {{ ok: true, relayPid: number, logFile: string } | { ok: false, error: string }}
 */
export function scheduleRestart({ root, port = 3000, delayMs = 1800, log = console } = {}) {
  try {
    const cacheDir = path.join(root, '.cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const relayPath = path.join(cacheDir, 'restart-relay.mjs');
    const logFile = path.join(cacheDir, 'restart.log');
    fs.writeFileSync(relayPath, RELAY, 'utf8');
    const child = spawn(process.execPath, [relayPath, root, logFile, String(delayMs), String(port)], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    try {
      fs.appendFileSync(logFile, `[restart ${new Date().toISOString()}] 收到重启请求，旧进程准备退出（中继 pid=${child.pid}）\n`);
    } catch { /* ignore */ }
    log.info?.(`[restart] 已安排自重启（中继 pid=${child.pid}，${delayMs}ms 后拉起新进程）`);
    return { ok: true, relayPid: child.pid, logFile };
  } catch (e) {
    log.error?.('[restart] 安排重启失败', e);
    return { ok: false, error: String(e?.message || e) };
  }
}
