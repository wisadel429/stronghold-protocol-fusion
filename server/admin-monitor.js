// server/admin-monitor.js — 服务器资源检测器 (resource monitor) for the admin backend.
//
// What it reports, all from this process / this machine (nothing is stored, nothing is sent anywhere):
//   * CPU    — 整机占用率 from two os.cpus() samples, and this process's own share (process.cpuUsage());
//   * 内存   — system total / used, and the process's RSS / heap;
//   * 带宽   — bytes this server sent and received over HTTP and WebSocket, from server/http/traffic.js, as a rate
//              over the window between two snapshots (the admin page polls every 2 s) plus the totals since start;
//   * 访问量 — 游戏网站 (not the admin page): page opens of `/`, distinct client addresses, WebSocket connections.
//
// It is deliberately pull-based: no timer runs while nobody watches the admin page, and the first snapshot after a
// quiet period reports the rates over that longer window (windowSec says which).
//
// Used by server/admin-live.js (snapshot().resource) and by server/index.js (noteHttp / the page-view count).

import fs from 'node:fs';
import os from 'node:os';
import { clientAddress } from './net.js';

/** `YYYY-MM-DD` in local time — the key of the per-day visit counters. */
const dayKey = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** A client address, without the IPv4-mapped prefix, or '?' when the socket already went away. */
const addrOf = (req, trustProxy) => String(clientAddress(req, trustProxy).ip || '?').replace(/^::ffff:/, '');

/**
 * 整机累计 CPU 时间（毫秒）。优先直接读 `/proc/stat`：它带 iowait / steal，
 * 和 `top` 的口径一致；Node 的 `os.cpus()` 少了这两项，在云主机上会把占用率算高（业主 2026-11-28「探测不准确」）。
 * 读不到（非 Linux）再退回 `os.cpus()`。
 */
function cpuTimes() {
  const cpus = os.cpus() || [];
  const cores = cpus.length || 1;
  const model = cpus[0]?.model || '';
  try {
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n').find((l) => l.startsWith('cpu '));
    if (line) {
      const v = line.trim().split(/\s+/).slice(1).map(Number);
      // user nice system idle iowait irq softirq steal
      const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = v;
      return { idle: idle + iowait, total: user + nice + system + idle + iowait + irq + softirq + steal, cores, model, source: 'proc' };
    }
  } catch { /* 非 Linux：用 os.cpus() */ }
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times || {};
    total += (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.irq || 0) + (t.idle || 0);
    idle += t.idle || 0;
  }
  return { idle, total, cores, model, source: 'os' };
}

/** `/proc/meminfo` 的 MemTotal / MemAvailable（字节）；读不到返回 null。 */
let memInfoError = null;
function memInfo() {
  try {
    const txt = fs.readFileSync('/proc/meminfo', 'utf8');
    const kb = (key) => {
      const m = txt.match(new RegExp('^' + key + ':\\s+(\\d+)\\s+kB', 'm'));
      return m ? Number(m[1]) * 1024 : null;
    };
    const total = kb('MemTotal');
    const available = kb('MemAvailable');
    if (total && available != null) return { total, available, used: Math.max(0, total - available) };
  } catch (e) { memInfoError = String((e && (e.code || e.message)) || e); }
  return null;
}

/** Two cumulative CPU samples → whole-machine usage in percent (0–100). null when the window is too short. */
function cpuPct(prev, next) {
  const dt = next.total - prev.total;
  const di = next.idle - prev.idle;
  if (!(dt > 0)) return null;
  return Math.max(0, Math.min(100, (1 - di / dt) * 100));
}

const round1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const MB = 1024 * 1024;

/**
 * Build the monitor. Every dependency is optional: without a traffic counter the bandwidth fields are null, so the
 * page can still show CPU / memory.
 * @param {{
 *   traffic?: ReturnType<typeof import('./http/traffic.js').createTrafficCounter> | null,
 *   network?: import('./net.js').Network | null,
 *   registry?: import('./net.js').SessionRegistry | null,
 *   lobby?: import('./lobby.js').Lobby | null,
 *   startedAt?: number, now?: () => number, log?: object,
 *   maxUniqueVisitors?: number,
 * }} [opts]
 */
export function createResourceMonitor({
  traffic = null, network = null, registry = null, lobby = null,
  startedAt = Date.now(), now = () => Date.now(), log = null, maxUniqueVisitors = 5000, trustProxy = 'auto',
} = {}) {
  /** @type {{ idle: number, total: number, cores: number, model: string } | null} */
  let lastCpu = null;
  let lastCpuAt = 0;
  /** 1 秒一次的采样环形缓冲：整机占用率按 5 秒均值上报，避免 2 秒轮询窗口的抖动（业主 2026-11-28） */
  /** @type {{ at: number, pct: number }[]} */
  const cpuHist = [];
  const CPU_SAMPLE_MS = 1000;
  const CPU_HIST_MAX = 120;
  const CPU_IDLE_STOP_MS = 30_000;
  let cpuTimer = null;
  let lastSnapshotAt = 0;
  /** 取最近 ms 毫秒内的采样均值；没有样本时 null。 */
  const meanSince = (ms) => {
    const from = now() - ms;
    const xs = cpuHist.filter((x) => x.at >= from);
    return xs.length ? xs.reduce((a, x) => a + x.pct, 0) / xs.length : null;
  };
  const pushCpuSample = () => {
    const at = now();
    const t = cpuTimes();
    if (lastCpu && at > lastCpuAt) {
      const pct = cpuPct(lastCpu, t);
      if (pct !== null) {
        cpuHist.push({ at, pct });
        while (cpuHist.length > CPU_HIST_MAX) cpuHist.shift();
      }
    }
    lastCpu = t;
    lastCpuAt = at;
    // 没人看后台就停掉采样（这份检测器原本是纯拉取式，不常驻跑定时器）
    if (cpuTimer && at - lastSnapshotAt > CPU_IDLE_STOP_MS) { clearInterval(cpuTimer); cpuTimer = null; cpuHist.length = 0; }
  };
  const ensureCpuSampler = () => {
    if (cpuTimer) return;
    pushCpuSample();
    cpuTimer = setInterval(pushCpuSample, CPU_SAMPLE_MS);
    cpuTimer.unref?.();
  };
  /** @type {{ user: number, system: number, at: number } | null} */
  let lastProc = null;
  /** @type {{ out: number, in: number, at: number } | null} */
  let lastBytes = null;
  /** @type {Map<string, { total: number, today: number }>} page opens per local day */
  const days = new Map();
  let pageViews = 0;
  let lastPageAt = 0;
  const visitors = new Set();
  /** Yesterday's key, so a process running past midnight still resets "today" on read. */
  let todayKey = dayKey(Date.now());

  /**
   * Count one HTTP request of the GAME site (the admin pages are not counted). A page view is a GET / (the title
   * screen); /index.html is the same page when the static handler answers it directly.
   * @param {import('node:http').IncomingMessage} req
   */
  function noteHttp(req) {
    try {
      if (!req || req.method !== 'GET') return;
      const raw = String(req.url || '/');
      const path = raw.split('?')[0].split('#')[0];
      // only the game's own entry page; its assets / API / /healthz are not "访问量"
      if (path !== '/' && path !== '/index.html') return;
      const at = now();
      pageViews++;
      lastPageAt = at;
      const key = dayKey(at);
      todayKey = key;
      const day = days.get(key) || { total: 0, today: 0 };
      day.total++;
      days.set(key, day);
      if (visitors.size < maxUniqueVisitors) visitors.add(addrOf(req, trustProxy));
    } catch (e) {
      log?.debug?.('[monitor] noteHttp failed', e?.message || e);
    }
  }

  /** Bytes this server moved so far (HTTP bodies + WebSocket wire both ways). null without a traffic counter. */
  function totalsNow() {
    if (!traffic) return null;
    const snap = traffic.snapshot();
    const httpBytes = Number(snap.http?.total?.bytes) || 0;
    const wireOut = Number(snap.ws?.wireOut) || 0;
    const wireIn = Number(snap.ws?.wireIn) || 0;
    return {
      out: httpBytes + wireOut,
      in: wireIn,
      httpRequests: Number(snap.http?.total?.requests) || 0,
      httpByCategory: snap.http || null,
      ws: snap.ws || null,
      since: snap.since || null,
      seconds: Number(snap.seconds) || null,
    };
  }

  /** The whole report (the page reads `state.resource`). */
  function snapshot() {
    const at = now();
    const nowKey = dayKey(at);
    if (nowKey !== todayKey) todayKey = nowKey;

    // ---- CPU: 整机占用率取 5 秒均值（1 秒采样），本进程仍按同一窗口算 ----
    ensureCpuSampler();
    lastSnapshotAt = at;
    const cpus = cpuTimes();
    let systemPct = meanSince(5000);
    // 刚启动 / 采样还没攒够时，退回「距上次快照的差值」
    if (systemPct === null && lastCpu && at - lastCpuAt >= 200) systemPct = cpuPct(lastCpu, cpus);
    const systemPct1m = meanSince(60_000);
    lastCpu = cpus;
    lastCpuAt = at;
    const usage = process.cpuUsage();
    let processPct = null;
    if (lastProc) {
      const elapsedMs = Math.max(1, at - lastProc.at);
      const spentMs = (usage.user - lastProc.user + usage.system - lastProc.system) / 1000;
      processPct = (spentMs / elapsedMs) * 100;
    }
    lastProc = { user: usage.user, system: usage.system, at };

    // ---- memory: 有 MemAvailable 就用它算（缓存不算"已用"，和 free -h / top 一致）----
    const mi = memInfo();
    const totalMem = mi ? mi.total : os.totalmem();
    const usedMem = mi ? mi.used : Math.max(0, os.totalmem() - os.freemem());
    const freeMem = Math.max(0, totalMem - usedMem);
    const mem = process.memoryUsage();

    // ---- bandwidth ----
    const totals = totalsNow();
    let bandwidth = null;
    if (totals) {
      const prev = lastBytes;
      const dtSec = prev ? Math.max(0.05, (at - prev.at) / 1000) : null;
      const dOut = prev ? Math.max(0, totals.out - prev.out) : 0;
      const dIn = prev ? Math.max(0, totals.in - prev.in) : 0;
      bandwidth = {
        windowSec: dtSec === null ? null : round1(dtSec),
        outBytesPerSec: dtSec === null ? null : Math.round(dOut / dtSec),
        inBytesPerSec: dtSec === null ? null : Math.round(dIn / dtSec),
        outBytes: totals.out,
        inBytes: totals.in,
        httpRequests: totals.httpRequests,
        byCategory: totals.httpByCategory,
        ws: totals.ws,
        since: totals.since,
      };
      lastBytes = { out: totals.out, in: totals.in, at };
    }

    // ---- game site visits (this process) ----
    let onlinePlayers = null;
    let roomsOnline = null;
    let roomsTotal = null;
    try { onlinePlayers = network ? network.onlineCount : null; } catch { onlinePlayers = null; }
    try {
      if (lobby) {
        roomsTotal = lobby.rooms.size;
        let n = 0;
        for (const room of lobby.rooms.values()) {
          if (!room || room.disposed) continue;
          if (room.activeHumans?.().some((s) => s && s.connected)) n++;
        }
        roomsOnline = n;
      }
    } catch { /* the hall may be halfway built during boot */ }

    const today = days.get(nowKey) || { total: 0 };

    return {
      ok: true,
      at,
      cpu: {
        systemPct: round1(systemPct),
        systemPct1m: round1(systemPct1m),
        processPct: round1(processPct),
        // processPct is a share of ONE core (the usual `top` convention); this one is of the whole machine
        processPctOfHost: round1(processPct === null ? null : processPct / Math.max(1, cpus.cores)),
        source: cpus.source || null,
        cores: cpus.cores,
        model: cpus.model,
        loadavg: os.loadavg().map((n) => round1(n)),
      },
      memory: {
        totalBytes: totalMem,
        freeBytes: freeMem,
        usedBytes: usedMem,
        // 'proc' = 用了 /proc/meminfo 的 MemAvailable；'os' = 退回 os.totalmem()/os.freemem()（容器里 /proc/meminfo 常被屏蔽）
        source: mi ? 'proc' : 'os',
        error: mi ? undefined : memInfoError,
        availableBytes: mi ? mi.available : Math.max(0, os.freemem()),
        usedPct: totalMem > 0 ? round1((usedMem / totalMem) * 100) : null,
        process: {
          rssBytes: mem.rss,
          heapTotalBytes: mem.heapTotal,
          heapUsedBytes: mem.heapUsed,
          externalBytes: mem.external,
          arrayBuffersBytes: mem.arrayBuffers || 0,
          rssPctOfSystem: totalMem > 0 ? round1((mem.rss / totalMem) * 100) : null,
        },
      },
      bandwidth,
      site: {
        pageViews,
        todayPageViews: today.total,
        uniqueVisitors: visitors.size,
        uniqueVisitorsCapped: visitors.size >= maxUniqueVisitors,
        lastPageAt: lastPageAt || null,
        wsConnections: totals && totals.ws ? Number(totals.ws.connections) || 0 : null,
        wsOpen: totals && totals.ws ? Number(totals.ws.open) || 0 : null,
        onlinePlayers,
        roomsOnline,
        roomsTotal,
      },
      process: {
        pid: process.pid,
        uptimeSec: Math.round((at - startedAt) / 1000),
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    };
  }

  return {
    noteHttp,
    snapshot,
    /** Bytes / rates are meaningless without the traffic counter; the page hides those tiles then. */
    get hasTraffic() { return !!traffic; },
    /** A compact line for a log, or null when nothing can be measured. */
    summary() {
      const s = snapshot();
      const pct = s.cpu.systemPct === null ? '?' : s.cpu.systemPct;
      const memPct = s.memory.usedPct === null ? '?' : s.memory.usedPct;
      const mb = (n) => (Number.isFinite(n) ? Math.round(n / MB) : '?');
      return `[monitor] cpu=${pct}% proc=${s.cpu.processPct ?? '?'}% mem=${memPct}% rss=${mb(s.memory.process.rssBytes)}MB`
        + (s.bandwidth ? ` net=${Math.round((s.bandwidth.outBytesPerSec || 0) / 1024)}KB/s` : '');
    },
  };
}
