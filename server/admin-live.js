// server/admin-live.js — the adapter between the admin backend (server/admin.js) and THIS tree's live state.
//
// ADMIN-DESIGN.md §3 names the only coupling point between a game and the backend: seven functions over the game's
// memory (snapshot / setOpen / announce / warn / kick / closeRoom / broadcast). THIS file is that adapter for the
// 0.3.3-Fusion tree. It imports nothing from server/admin.js and admin.js imports nothing from here but the object it
// builds, so the backend stays portable (swap this file for another game).
//
// What 0.3.3's upstream Lobby has, and what this tree therefore gets honestly:
//   * `lobby.stats()` counts ROOMS TOTAL, not "rooms with an online human" — the handoff's §四/§七.7 says the page's
//     `rooms` must be the latter, so roomsOnline() is computed here and `roomsTotal` kept beside it;
//   * `lobby` has no `onlineSummary()` in 0.3.3 — playersOnline() counts sessions with `connected === true` itself
//     (the handoff's "血泪口径": `stats.humans` is seats in rooms, NOT people online);
//   * there is NO /test lane in this tree, so nothing here needs (or pretends) to exempt one;
//   * `Network.close(code)` marks the whole network closed and stops its timers — it is the SHUTDOWN path, not a gate.
//     Closing the server therefore closes each socket through its own Connection (4004), leaving the network able to
//     serve the reopened gate and the admin page;
//   * a socket that arrives while the gate is shut is upgraded, told `server.closed` and closed with 4004 BEFORE any
//     hello — a 503 at the upgrade would reach the browser as a bare connection failure with no reason (handoff §七.1);
//   * the resource figures (CPU / memory / bandwidth / game-site visits) come from server/admin-monitor.js.
//
// The 后台 frames are plain S2C pushes (`notice`, `server.warn`, `server.closed`); the game page's net.js dispatches
// every frame it gets: 0.3.3-Fusion shows `notice` as the scrolling 全服公告条 (public/js/ui/notice.js), `server.warn`
// as the 闪断更新预警条 (public/js/main.js FlashWarnBar) and `server.closed` as the closed-server notice.

import { PHASE_NAMES } from '../shared/constants.js';

/** Close code the clients treat as "the server was shut" (2.1's 4004; net.js stops auto-reconnect from it). */
export const CLOSE_SERVER_CLOSED = 4004;
/** Close code for "an admin kicked you" (2.1's 4003). */
export const CLOSE_KICKED = 4003;

/** Announcement text cap (the page may paste a long notice; the frame stays small). */
const NOTICE_MAX = 2000;
/** Delay between "the server is closing" and the sockets actually being closed: the frame must go out first. */
const CLOSE_GRACE_MS = 300;

/**
 * Build the live admin state + the seven adapter functions.
 * @param {{
 *   lobby: import('./lobby.js').Lobby,
 *   registry: import('./net.js').SessionRegistry,
 *   network: import('./net.js').Network,
 *   monitor?: ReturnType<typeof import('./admin-monitor.js').createResourceMonitor> | null,
 *   log?: { info: Function, warn: Function, error: Function, debug?: Function },
 *   serverName?: string,
 *   now?: () => number,
 * }} opts
 */
export function createAdminLive({ lobby, registry, network, monitor = null, log, serverName = 'server1', now = () => Date.now() }) {
  const send = (ws, frame) => { try { ws?.send?.(JSON.stringify(frame)); } catch { /* the socket is gone */ } };

  /** @type {{ open: boolean, text: string, since: number }} */
  const gate = { open: true, text: '', since: now() };
  /** @type {{ text: string, at: number, until: number } | null} */
  let notice = null;
  /** @type {{ text: string, at: number, until: number, closeOnExpire: boolean, timer: any } | null} */
  let warn = null;
  let closedTimer = null;

  // -------------------------------------------------------------------------------------------------
  // broadcast (adapter #7): every open socket, handshaken or not — a player still on the title screen has no session
  // yet, and that is exactly who must see an announcement.
  // -------------------------------------------------------------------------------------------------
  /**
   * @param {object} frame
   * @returns {number} how many sockets took it
   */
  function broadcast(frame) {
    let n = 0;
    for (const conn of network.conns.values()) {
      if (conn.closing) continue;
      send(conn.ws, frame);
      n++;
    }
    return n;
  }

  // -------------------------------------------------------------------------------------------------
  // late joiners (a client that connects AFTER an announcement / countdown)
  // -------------------------------------------------------------------------------------------------
  // `broadcast` can only reach sockets that already exist, so a player who opens the page later would never hear the
  // announcement. The lobby's post-welcome hook is wrapped: it is where net.js has just sent `welcome` and the session
  // knows its socket. (A shut gate never reaches here: such a socket is told and closed in onConnect below.)
  const baseOnHello = lobby.onHello?.bind(lobby);
  lobby.onHello = (session, info) => {
    baseOnHello?.(session, info);
    try {
      if (notice) send(session.ws, noticeFrame());
      if (warn && warn.until > now()) send(session.ws, warnFrame());
    } catch (e) { log?.warn?.('[admin] 新连接的状态补发失败', e?.message || e); }
  };

  // -------------------------------------------------------------------------------------------------
  // announcement (adapter #3)
  // -------------------------------------------------------------------------------------------------
  const noticeFrame = () => (notice
    ? { t: 'notice', text: notice.text, at: notice.at, until: notice.until }
    : { t: 'notice', text: '', at: 0, until: 0 });

  /**
   * Publish (empty text = clear) the scrolling announcement. `ttlMin` > 0 makes it expire on its own.
   * @param {string} text @param {number} [ttlMin]
   */
  function announce(text, ttlMin) {
    const t = typeof text === 'string' ? text.trim().slice(0, NOTICE_MAX) : '';
    if (!t) { notice = null; broadcast(noticeFrame()); return null; }
    const at = now();
    const minutes = Number(ttlMin);
    const until = Number.isFinite(minutes) && minutes > 0 ? at + Math.round(minutes * 60_000) : 0;
    notice = { text: t, at, until };
    broadcast(noticeFrame());
    log?.info?.(`[admin] 公告: ${t.slice(0, 40)}${t.length > 40 ? '…' : ''}${until ? ` (${minutes} 分钟)` : ''}`);
    return notice;
  }

  /** Drop an expired announcement (called from the snapshot: a read must not need a timer). */
  function expireNotice() {
    if (notice && notice.until && notice.until <= now()) { notice = null; broadcast(noticeFrame()); }
  }

  // -------------------------------------------------------------------------------------------------
  // flash-warn (adapter #4)
  // -------------------------------------------------------------------------------------------------
  const warnFrame = () => (warn
    ? { t: 'server.warn', until: warn.until, text: warn.text, closeOnExpire: warn.closeOnExpire }
    : { t: 'server.warn', until: 0, text: '', closeOnExpire: false });

  function clearWarn() {
    if (warn?.timer) clearTimeout(warn.timer);
    const had = !!warn;
    warn = null;
    if (had) broadcast(warnFrame());
    return null;
  }

  /**
   * Arm the 闪断更新预警 countdown; `closeOnExpire` shuts the server when it runs out.
   * @param {number} seconds @param {{ text?: string|null, closeOnExpire?: boolean }} [opts]
   */
  function armFlashWarn(seconds, { text = null, closeOnExpire = true } = {}) {
    clearWarn();
    const secs = Math.max(1, Math.round(Number(seconds) || 0));
    const at = now();
    const until = at + secs * 1000;
    warn = { text: typeof text === 'string' ? text.slice(0, 200) : '', at, until, closeOnExpire: closeOnExpire !== false, timer: null };
    warn.timer = setTimeout(() => {
      if (!warn) return;
      const w = warn;
      warn = null;
      log?.info?.('[admin] 预警到期');
      if (w.closeOnExpire) setOpen(false, { text: w.text || '服务器闪断更新，请稍后重新连接', reason: 'warn' });
      else broadcast(warnFrame());
    }, secs * 1000);
    warn.timer.unref?.();
    broadcast(warnFrame());
    return warnState();
  }

  /** The current countdown as the page and the frame see it. */
  function warnState() {
    if (!warn) return null;
    return {
      text: warn.text, at: warn.at, until: warn.until, closeOnExpire: warn.closeOnExpire,
      remainingSec: Math.max(0, Math.round((warn.until - now()) / 1000)),
    };
  }

  // -------------------------------------------------------------------------------------------------
  // 开 / 关服务器 (adapter #2)
  // -------------------------------------------------------------------------------------------------
  /** Close every live socket (not the network: its timers must keep running for the reopened gate). */
  function closeSockets(code, reason) {
    let n = 0;
    for (const conn of [...network.conns.values()]) {
      if (conn.closing) continue;
      try { conn.close(code, reason); n++; } catch { /* a socket that died meanwhile */ }
    }
    return n;
  }

  /**
   * Open or shut the gate. Shutting it tells every player why (`server.closed`, a popup) and then drops their sockets
   * with 4004 after a short grace, so the message is on the wire before the connection dies. This tree has no test
   * lane, so everyone is subject to the gate; the admin page itself is plain HTTP and keeps working.
   * @param {boolean} open @param {{ text?: string|null, reason?: string }} [opts]
   */
  function setOpen(open, { text = null, reason = 'admin' } = {}) {
    const next = !!open;
    gate.open = next;
    gate.text = next ? '' : (typeof text === 'string' ? text.slice(0, 200) : '');
    gate.since = now();
    // 业主 2026-11-14「关服后服务器列表仍显示在线」：把开服状态镜像到 lobby，/api/ping 与 /healthz 就能读到。
    // 列表探的是 HTTP（/api/ping），进程还在跑，所以只看进程活不活永远判不出「已关服」。
    if (lobby) lobby.gate = { open: next, text: gate.text, since: gate.since, reason };
    const frame = { t: 'server.closed', text: gate.text, at: now(), open: next };
    broadcast(frame);
    if (next) {
      if (closedTimer) { clearTimeout(closedTimer); closedTimer = null; }
      log?.info?.('[admin] 服务器已开启');
      return { open: true, text: '' };
    }
    log?.warn?.(`[admin] 关闭服务器 (${reason}): ${gate.text || '无原因'}`);
    if (closedTimer) clearTimeout(closedTimer);
    closedTimer = setTimeout(() => {
      closedTimer = null;
      const n = closeSockets(CLOSE_SERVER_CLOSED, 'server closed');
      log?.info?.(`[admin] 已断开全部连接（${n} 个）`);
    }, CLOSE_GRACE_MS);
    closedTimer.unref?.();
    return { open: false, text: gate.text };
  }

  /**
   * A socket just connected (server/index.js wraps network.handleConnection with it). While the gate is shut the
   * socket is told why and closed with 4004 **before** any hello, so it never becomes a session and never receives a
   * `welcome` (a welcome would tell the page it is online).
   *
   * @param {import('ws').WebSocket} ws
   * @returns {boolean} true when the caller should adopt the socket
   */
  function onConnect(ws) {
    try {
      if (!gate.open) {
        send(ws, { t: 'server.closed', text: gate.text, at: now(), open: false });
        try { ws.close(CLOSE_SERVER_CLOSED, 'server closed'); } catch { /* ignore */ }
        return false;
      }
      // A page that opens (or reloads) while an announcement / countdown is up must see it: 0.3.3's client connects
      // on the title screen WITHOUT a hello, so the onHello resend below never runs for it. Send right away; the
      // onHello hook still covers a page that enters later (the client ignores a repeated identical frame).
      if (notice) send(ws, noticeFrame());
      if (warn && warn.until > now()) send(ws, warnFrame());
    } catch { /* a socket that died mid-handshake costs nothing */ }
    return true;
  }

  // -------------------------------------------------------------------------------------------------
  // 踢人 (adapter #5) / 关房间 (adapter #6)
  // -------------------------------------------------------------------------------------------------
  /**
   * Kick one player: in a room → out of the room (still connected); otherwise → the socket closes with 4003.
   * @param {string} playerId
   * @returns {{ playerId: string, name: string, action: 'room'|'disconnect' } | null} null when unknown
   */
  function kick(playerId) {
    const session = registry.byId(String(playerId || ''));
    if (!session) return null;
    const name = session.name;
    const room = session.roomCode ? lobby.getRoom(session.roomCode) : null;
    if (room) {
      const code = room.code;
      lobby.removeMember(room, session.playerId);
      send(session.ws, { t: 'room.closed', reason: 'kicked' });
      log?.info?.(`[admin] 踢出房间 ${code}: ${name}`);
      return { playerId: session.playerId, name, action: 'room' };
    }
    const conn = session.ws ? network.conns.get(session.ws) : null;
    if (conn) conn.close(CLOSE_KICKED, 'kicked');
    else if (session.ws) { try { session.ws.close(CLOSE_KICKED, 'kicked'); } catch { /* ignore */ } }
    try { registry.remove(session); } catch { /* ignore */ }
    log?.info?.(`[admin] 踢出服务器: ${name}`);
    return { playerId: session.playerId, name, action: 'disconnect' };
  }

  /**
   * Disband a room by code (a running match ends with it).
   * @param {string} code
   * @returns {{ code: string } | null} null when there is no such room
   */
  function closeRoom(code) {
    const room = lobby.getRoom(String(code || ''));
    if (!room || room.disposed) return null;
    const c = room.code;
    lobby.disposeRoom(room, 'admin');
    log?.info?.(`[admin] 关闭房间 ${c}`);
    return { code: c };
  }

  // -------------------------------------------------------------------------------------------------
  // counters (ADMIN-DESIGN.md §4; `admin.js` prefers these over its own fallback)
  // -------------------------------------------------------------------------------------------------
  /** Online sessions (connected === true) and their names. */
  function online() {
    let players = 0;
    const names = [];
    for (const s of registry.all()) {
      if (!s.connected) continue;
      players++;
      if (names.length < 40) names.push(s.name);
    }
    return { players, names };
  }

  /** Rooms that hold at least one CONNECTED human (not the total — handoff §七.7). */
  function roomsOnline() {
    let n = 0;
    for (const room of lobby.rooms.values()) {
      if (!room || room.disposed) continue;
      if (room.activeHumans?.().some((s) => s && s.connected)) n++;
    }
    return n;
  }

  /** The counters `/healthz` and the page's top card read (the admin's statsOf merges its own fields over these). */
  function stats() {
    const base = lobby.stats();
    const on = online();
    const onlineRooms = roomsOnline();
    return {
      ...base,
      rooms: onlineRooms,
      roomsTotal: base.rooms,
      playersOnline: on.players,
      onlineNames: on.names,
      serverName,
    };
  }

  // -------------------------------------------------------------------------------------------------
  // snapshot (adapter #1) — ADMIN-DESIGN.md §4, the field contract the page is written against
  // -------------------------------------------------------------------------------------------------
  /** One room of the snapshot. @param {any} room */
  function roomSnapshot(room) {
    const m = room.match;
    const humans = room.activeHumans();
    const bots = room.seats.filter((s) => s && s.isBot).length;
    const hostSeat = room.hostId ? room.seatOf(room.hostId) : null;
    const seats = room.seats.filter(Boolean);
    let match = null;
    if (m) {
      const deadline = Number.isFinite(m.deadline) ? m.deadline : 0;
      match = {
        round: Number.isFinite(m.round) ? m.round : 0,
        // 总回合数：Match 上真实字段是 gd.lastRound（= m.public.lastRound）。**没有 m.totalRounds 这个字段**
        // —— 2026-11-26 修：后台「回合 N/总」一直显示 /0，就是因为这里读了一个不存在的属性。
        // 超限 / 无尽湮灭没有回合上限（lastRound 为 null）→ 返回 null，页面显示「–」。
        lastRound: (m.gd && Number.isFinite(m.gd.lastRound)) ? m.gd.lastRound : null,
        phase: m.phase || '',
        phaseLabel: PHASE_NAMES[m.phase] || m.phase || '',
        kind: m.phase === 'PREP' ? 'prep' : (m.phase === 'COMBAT' || m.phase === 'UNITE' || m.phase === 'FINAL_ASSAULT' || m.phase === 'HIDDEN_CORE' ? 'combat' : 'other'),
        group: m.phase === 'PREP' ? '修整期' : (m.phase === 'COMBAT' || m.phase === 'UNITE' ? '战斗阶段' : (m.phase === 'BAND_DRAFT' || m.phase === 'SP_DRAFT' ? '选择阶段' : '其它')),
        paused: !!m.paused,
        deadline,
        // 0 when the phase has no countdown (the page draws "—"): ADMIN-DESIGN §4
        remainingSec: deadline > 0 ? Math.max(0, Math.round((deadline - now()) / 1000)) : 0,
        players: seats.map((s) => ({
          playerId: s.playerId, seat: s.seat, name: s.name, isBot: !!s.isBot,
          connected: !!s.connected && !s.left, alive: !s.left, lp: null, ready: !!s.ready,
        })),
      };
    }
    return {
      code: room.code,
      mode: room.mode,
      difficulty: room.difficulty,
      inMatch: !!room.match,
      matchNo: room.matchCount,
      humans: humans.length,
      bots,
      spectators: room.spectators.length,
      // solo rooms hold one human and nothing else: the page shows 1/1 (requirement: 独立模拟房间上限显示为 1);
      // a co-op room reports the 4-seat cap this tree builds (MAX_SEATS)
      seats: room.mode === 'solo' ? 1 : room.seats.length,
      hostName: hostSeat ? hostSeat.name : '',
      hostId: room.hostId,
      // 0.3.3 has no private rooms; the page's badge simply never shows
      private: false,
      createdAt: room.createdAt,
      // the people in the room even before a match (requirement: 后台显示未开局房内玩家)
      players: seats.map((s) => ({
        playerId: s.playerId, name: s.name, seat: s.seat, host: s.playerId === room.hostId,
        ready: !!s.ready, connected: !!s.connected && !s.left,
      })),
      match,
    };
  }

  /** The §4 snapshot: pure read, cheap enough for the page's 2 s poll. */
  function snapshot() {
    expireNotice();
    const at = now();
    const players = [];
    for (const s of registry.all()) {
      players.push({
        playerId: s.playerId,
        name: s.name,
        connected: !!s.connected,
        inRoom: !!s.roomCode,
        roomCode: s.roomCode || null,
        addr: s.addr || '?',
        idleSec: Math.max(0, Math.round((at - (s.lastSeen || at)) / 1000)),
      });
    }
    // connected first, then by name — the page keeps this order
    players.sort((a, b) => (Number(b.connected) - Number(a.connected)) || String(a.name).localeCompare(String(b.name)));
    const rooms = [...lobby.rooms.values()].filter((r) => !r.disposed).map(roomSnapshot);
    rooms.sort((a, b) => (Number(b.inMatch) - Number(a.inMatch)) || (b.createdAt - a.createdAt));
    return {
      ok: true,
      now: at,
      players,
      rooms,
      gate: { open: gate.open, text: gate.text, testPort: 0, testPath: null },
      warn: warnState(),
      notice: notice ? { text: notice.text, at: notice.at, until: notice.until } : null,
      // 资源检测 (server/admin-monitor.js): null only when the backend was built without a monitor
      resource: monitor ? monitor.snapshot() : null,
    };
  }

  return {
    snapshot, stats, setOpen, announce, armFlashWarn, clearWarn, warnState, kick, closeRoom, broadcast, onConnect,
    gate, notice: () => notice, warn: warnState, serverName,
    /** True while the gate is shut (server/index.js shows it in the banner). */
    get closed() { return !gate.open; },
    /** Stop the countdown timers when the process goes down. */
    close() {
      if (warn?.timer) clearTimeout(warn.timer);
      warn = null;
      if (closedTimer) clearTimeout(closedTimer);
      closedTimer = null;
    },
  };
}
