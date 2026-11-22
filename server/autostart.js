// server/autostart.js — 游戏服开机自启（业主 2026-11-22 决策，待办 T-06）
//
// 问题：教程里每次服务器重启/重开机都得手动跑 `node\node.exe server\index.js`，忘了就是域名 502、IP 连不上。
//
// 做法：**服务端自己注册自己**。每次启动时查一遍「有没有我这条计划任务」，没有就建一个；
// 这样只要热更一次 + 重启，任务就落地了 —— 不需要业主上 RDP 手敲 schtasks。
// 建任务需要管理员权限；拿不到权限不报错、不阻断启动，只在 /healthz 里如实写 'denied'，
// 业主看到就知道要手动跑一次 `install-autostart.ps1`。
//
// 配置：data/autostart.json
//   { "enabled": true, "name": "StrongholdGameServer", "delaySec": 30 }
//   enabled=false 关掉自检（不想让服务端碰系统计划任务时用）；文件不存在按默认值（启用）。
//
// 任务：`schtasks /SC ONSTART`，以 SYSTEM 运行，开机延迟 delaySec 秒 —— 等网卡和磁盘就绪再起，
// 否则 node 可能抢在网络之前绑端口，域名入口会短时间 502。
//
// 与启动器的关系：启动器拉起的 node 和这条任务拉起的 node 是同一个入口，
// 端口已被占用时启动器侧走 Host.PortOpen() 判定「服务器本来就在跑」，不会双开。

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_NAME = 'StrongholdGameServer';
const DEFAULT_DELAY_SEC = 30;
const EXEC_TIMEOUT_MS = 12000;

/**
 * schtasks 在中文 Windows 上输出的是 **GBK**，直接按 UTF-8 解码会得到乱码，
 * 于是「拒绝访问」这种关键信息就认不出来了（实测踩到）。先按 UTF-8 试，出现替换字符再退回 GBK。
 */
function decodeOutput(buf) {
  if (!buf || !buf.length) return '';
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  try { return new TextDecoder('gbk').decode(buf); } catch { return utf8; }
}

/** 跑一条命令，永不让它把调用方带崩。@returns {Promise<{ ok: boolean, code: number|null, out: string, err: string }>} */
function run(file, args) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    try {
      execFile(file, args, { windowsHide: true, timeout: EXEC_TIMEOUT_MS, encoding: 'buffer' }, (e, stdout, stderr) => {
        finish({
          ok: !e,
          code: e && typeof e.code === 'number' ? e.code : (e ? null : 0),
          out: decodeOutput(stdout),
          err: decodeOutput(stderr),
        });
      });
    } catch (e) {
      finish({ ok: false, code: null, out: '', err: String(e && e.message || e) });
    }
  });
}

/** `/DELAY` 要 `mmmm:ss` 形式。 */
function delaySpec(sec) {
  const s = Math.max(0, Math.min(9999, Math.round(Number(sec) || 0)));
  return `0000:${String(s).padStart(2, '0')}`;
}

/**
 * @param {{ root: string, dataDir: string, log?: any, platform?: string, name?: string }} o
 */
export function createAutostart({ root, dataDir, log = console, platform = process.platform, name }) {
  const file = path.join(dataDir, 'autostart.json');
  const readConfig = () => {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        enabled: j && j.enabled === false ? false : true,
        name: String((j && j.name) || name || DEFAULT_NAME),
        delaySec: Number.isFinite(j && j.delaySec) ? j.delaySec : DEFAULT_DELAY_SEC,
      };
    } catch {
      // 文件不存在 / 坏 JSON 都按默认走（启用 + 默认任务名）：自启是「该有」的东西，不该因为少个配置文件就没
      return { enabled: true, name: name || DEFAULT_NAME, delaySec: DEFAULT_DELAY_SEC };
    }
  };
  const cfg0 = readConfig();
  const taskName = cfg0.name;
  /** @type {'unknown'|'ok'|'missing'|'disabled'|'denied'|'unsupported'|'error'} */
  let state = 'unknown';
  let detail = '';
  let inflight = null;

  const unsupported = platform !== 'win32';

  /** 任务在不在。@returns {Promise<boolean>} */
  async function exists() {
    const r = await run('schtasks', ['/Query', '/TN', taskName]);
    return r.ok;
  }

  /** 建任务。@returns {Promise<{ ok: boolean, denied?: boolean, detail: string }>} */
  async function install() {
    if (unsupported) return { ok: false, detail: 'only windows' };
    const nodeExe = process.execPath;
    const entry = path.join(root, 'server', 'index.js');
    if (!fs.existsSync(nodeExe)) return { ok: false, detail: `node 不存在：${nodeExe}` };
    if (!fs.existsSync(entry)) return { ok: false, detail: `入口不存在：${entry}` };
    // /TR 的值本身含引号：schtasks 会把它原样写进任务，执行时由系统的命令行解析处理
    const cmd = `"${nodeExe}" "${entry}"`;
    const r = await run('schtasks', [
      '/Create', '/TN', taskName, '/TR', cmd, '/SC', 'ONSTART',
      '/DELAY', delaySpec(cfg0.delaySec), '/RU', 'SYSTEM', '/RL', 'HIGHEST', '/F',
    ]);
    if (r.ok) return { ok: true, detail: cmd };
    // 权限不足是最可能的失败：给一句能直接照做的提示（注意 schtasks 的中文输出是 GBK，见 decodeOutput）
    const denied = /denied|拒绝访问|拒绝|Access is denied|权限|特权/i.test(`${r.err} ${r.out}`);
    return {
      ok: false,
      denied,
      detail: denied ? '需要管理员权限（用 install-autostart.ps1 以管理员运行一次）' : (r.err || r.out || `exit ${r.code}`).trim().slice(0, 300),
    };
  }

  /** 删任务。@returns {Promise<{ ok: boolean, detail: string }>} */
  async function remove() {
    if (unsupported) return { ok: false, detail: 'only windows' };
    const r = await run('schtasks', ['/Delete', '/TN', taskName, '/F']);
    return { ok: r.ok, detail: r.ok ? 'deleted' : (r.err || r.out || '').trim().slice(0, 300) };
  }

  /**
   * 自检 + 缺了就建。启动时调用一次即可（可重复调用，进行中会复用同一个 Promise）。
   * @returns {Promise<string>} 结束时的状态
   */
  function ensure() {
    if (inflight) return inflight;
    inflight = (async () => {
      if (unsupported) { state = 'unsupported'; return state; }
      if (!cfg0.enabled) { state = 'disabled'; return state; }
      try {
        if (await exists()) {
          state = 'ok';
          log.info?.(`[autostart] 开机自启已就位（计划任务 ${taskName}）`);
          return state;
        }
        const r = await install();
        if (r.ok) {
          state = 'ok';
          detail = r.detail;
          log.info?.(`[autostart] 已注册开机自启（计划任务 ${taskName}，开机延迟 ${cfg0.delaySec}s）`);
        } else {
          state = r.denied ? 'denied' : 'error';
          detail = r.detail;
          log.warn?.(`[autostart] 注册开机自启失败：${r.detail}（不影响运行；可手动跑 install-autostart.ps1）`);
        }
      } catch (e) {
        state = 'error';
        detail = String(e && e.message || e);
        log.warn?.('[autostart] 自检异常', e);
      }
      return state;
    })();
    return inflight;
  }

  /** /healthz 用：当前状态（不触发动作）。 */
  const status = () => ({ state, task: taskName, delaySec: cfg0.delaySec, ...(detail ? { detail } : {}) });

  return { ensure, install, remove, exists, status, taskName, config: cfg0 };
}
