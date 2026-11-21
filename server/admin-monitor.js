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

/** The cumulative CPU times of every core, as one `{ idle, total }` pair (ms). */
function cpuTimes() {
  const cpus = os.cpus() || [];
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times || {};
    const sum = (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.irq || 0) + (t.idle || 0);
    total += sum;
    idle += t.idle || 0;
  }
  return { idle, total, cores: cpus.length, model: cpus[0]?.model || '' };
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

    // ---- CPU: whole machine over the window since the previous snapshot, and this process over the same window ----
    const cpus = cpuTimes();
    let systemPct = null;
    if (lastCpu && at > lastCpuAt) {
      // a very short window is dominated by sampling noise: keep the previous figure instead
      if (at - lastCpuAt >= 200) systemPct = cpuPct(lastCpu, cpus);
    }
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

    // ---- memory ----
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = Math.max(0, totalMem - freeMem);
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
        processPct: round1(processPct),
        // processPct is a share of ONE core (the usual `top` convention); this one is of the whole machine
        processPctOfHost: round1(processPct === null ? null : processPct / Math.max(1, cpus.cores)),
        cores: cpus.cores,
        model: cpus.model,
        loadavg: os.loadavg().map((n) => round1(n)),
      },
      memory: {
        totalBytes: totalMem,
        freeBytes: freeMem,
        usedBytes: usedMem,
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
