// server/matchmaking.js — 排队撮合与自动补位引擎 (Matchmaking Queue Engine)
//
// 职责：
//   1. 维护大厅散人快速匹配队列 (queue = Map<playerId, QueueEntry>)
//   2. 维护同盟房间补人撮合队列 (roomQueue = Map<roomCode, RoomQueueEntry>)
//   3. 按 (mode, difficulty) 分桶进行撮合
//   4. 优先补齐房间：若有房间正处于 matching 状态，优先将匹配池中的散人博士填入房间空位
//   5. 散人组队：凑齐 4 人立即创建新同盟房间
//   6. 超时补位：排队超时（默认 10 秒）且允许 fillBots，自动按已有玩家建房或将房间剩余空位填充 AI 队友并自动开启对局
//   7. 状态同步：下发 match.status / match.found，更新 room.state.matching

import { randomBytes } from 'node:crypto';
import { MAX_SEATS } from '../shared/constants.js';
import { isSoloRoomMode } from '../shared/infiniteMode.js';
import { sendSession } from './net.js';

const MATCHMAKING_DEFAULTS = Object.freeze({
  tickIntervalMs: 1000,
  timeoutMs: 30_000, // 业主 2026-11-26：确认入场倒计时 30 秒（超时踢掉未准备的、保留已准备的继续匹配）
  targetPlayers: MAX_SEATS, // 4 人同盟
});

export class Matchmaker {
  /**
   * @param {import('./lobby.js').Lobby} lobby
   * @param {object} [opts]
   */
  constructor(lobby, opts = {}) {
    this.lobby = lobby;
    this.opts = { ...MATCHMAKING_DEFAULTS, ...opts };
    /** @type {Map<string, { session: any, mode: string, difficulty: string, fillBots: boolean, joinedAt: number }>} */
    this.queue = new Map();
    /** @type {Map<string, { room: any, queueId: string, startedAt: number, deadlineAt: number, fillBots: boolean }>} */
    this.roomQueue = new Map();
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick(), this.opts.tickIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.queue.clear();
    this.roomQueue.clear();
  }

  /**
   * 散人排队（大厅快速匹配）或房主代全队排队
   * @param {any} session
   * @param {{ mode?: string, difficulty?: string, fillBots?: boolean }} msg
   */
  enqueue(session, { mode = 'coop', difficulty = 'FUNNY', fillBots = true, timeoutMs = 0, autoStart = false } = {}) {
    const curRoom = this.lobby.roomOf(session);
    if (curRoom && curRoom.match) {
      return { error: 'ROOM_STARTED', detail: 'leave your running match first' };
    }

    // 场景 A：房主在房间内点击「匹配队友」
    if (curRoom) {
      if (curRoom.hostId !== session.playerId) {
        return { error: 'NOT_HOST', detail: 'only host can queue for party' };
      }
      if (isSoloRoomMode(curRoom.mode)) {
        return { error: 'ROOM_FULL', detail: 'solo room cannot queue party' };
      }
      if (curRoom.private === true) return { error: 'BAD_MSG', detail: '私密房间仅通过房间码或邀请加入，请先关闭私密开关再匹配队友' };
      const now = this.lobby.now();
      const wait = this.waitFor(timeoutMs);
      const queueId = 'q_' + randomBytes(4).toString('hex');
      const entry = {
        room: curRoom,
        queueId,
        startedAt: now,
        deadlineAt: now + wait,
        fillBots: fillBots !== false,
        humansAtStart: curRoom.activeHumans().length,
        // 补齐房间：人数一变多就立刻开局（业主 2026-11-15）
        autoStart: autoStart === true,
      };
      this.roomQueue.set(curRoom.code, entry);
      curRoom.matching = {
        queueId,
        startedAt: now,
        deadlineAt: entry.deadlineAt,
        fillBots: entry.fillBots,
        // 补齐房间：前端据此显示倒计时，并在结束后判断「人数有没有变多」
        humansAtStart: entry.humansAtStart,
      };
      this.start();
      this.lobby.broadcastState(curRoom);
      this.tick();
      return { ok: true };
    }

    // 场景 B：大厅无房散人快速匹配
    const entry = {
      session,
      mode: ['solo', 'coop', 'solo_infinite', 'coop_infinite'].includes(mode) ? String(mode) : 'coop',
      solo: isSoloRoomMode(mode),
      difficulty: String(difficulty),
      fillBots: fillBots !== false,
      joinedAt: this.lobby.now(),
    };

    this.queue.set(session.playerId, entry);
    this.start();

    // 立即下发一次状态
    this.sendStatus(entry);

    // 立即就地撮合
    this.tick();

    return { ok: true };
  }

  /**
   * 玩家退出排队（散人退队或房主取消房间匹配）
   * @param {any} session
   */
  dequeue(session) {
    const curRoom = this.lobby.roomOf(session);
    if (curRoom && this.roomQueue.has(curRoom.code)) {
      if (curRoom.hostId !== session.playerId) {
        return { error: 'NOT_HOST' };
      }
      this.cancelRoomQueue(curRoom);
      return { ok: true };
    }

    if (!this.queue.has(session.playerId)) {
      return { error: 'NOT_IN_QUEUE' };
    }
    this.queue.delete(session.playerId);
    sendSession(session, {
      t: 'match.status',
      status: 'idle',
      mode: null,
      difficulty: null,
      elapsed: 0,
      matched: 0,
      target: this.opts.targetPlayers,
    });
    return { ok: true };
  }

  /**
   * 取消房间的匹配状态
   * @param {any} room
   */
  cancelRoomQueue(room) {
    if (!room) return;
    this.roomQueue.delete(room.code);
    room.matching = null;
    this.lobby.broadcastState(room);
  }

  /**
   * 清理玩家
   * @param {string} playerId
   */
  removePlayer(playerId) {
    this.queue.delete(playerId);
  }

  /**
   * 清空所有排队队列（用于停机维护等场景）
   * @param {string} [reason]
   */
  clearQueue(reason = 'maintenance') {
    for (const entry of this.queue.values()) {
      if (entry.session && entry.session.connected) {
        sendSession(entry.session, { t: 'match.status', status: 'idle', reason });
      }
    }
    this.queue.clear();
    for (const code of [...this.roomQueue.keys()]) {
      const room = this.lobby.getRoom(code);
      this.cancelRoomQueue(room);
    }
  }

  /**
   * 发送当前排队状态给指定玩家
   */
  sendStatus(entry, matchedCount = 1) {
    if (!entry.session || !entry.session.connected) return;
    const now = this.lobby.now();
    const elapsed = Math.max(0, Math.floor((now - entry.joinedAt) / 1000));
    sendSession(entry.session, {
      t: 'match.status',
      status: 'searching',
      mode: entry.mode,
      difficulty: entry.difficulty,
      elapsed,
      matched: matchedCount,
      target: entry.solo ? 1 : this.opts.targetPlayers,
    });
  }

  /**
   * 补齐房间的等待时长（业主 2026-11-15）：调用方可以指定，限幅 5 秒 ~ 5 分钟；
   * 不指定时沿用服务端默认（SP_MATCHMAKE_TIMEOUT_MS，10 秒）。
   * @param {number} asked
   * @returns {number}
   */
  waitFor(asked) {
    const n = Number(asked);
    if (!Number.isFinite(n) || n <= 0) return this.opts.timeoutMs;
    return Math.min(Math.max(Math.round(n), 5000), 300_000);
  }

  /** 把房间当前的人数变化通知到房间里的每个人（补齐失败时用）。 */
  notifyFillFailed(room, humansAtStart = 0) {
    if (!room) return;
    const now = this.lobby.now();
    const humans = typeof room.activeHumans === 'function' ? room.activeHumans() : [];
    for (const s of humans) {
      const sess = this.lobby.registry.byId(s.playerId);
      if (!sess) continue;
      sendSession(sess, {
        t: 'match.status',
        status: 'idle',
        reason: 'fill-failed',
        // 前端据此弹「补齐失败」，并和「开始搜寻」的 timeout 文案区分开
        filled: humans.length,
        needed: humansAtStart,
        at: now,
      });
    }
  }

  /**
   * 撮合核心调度循环
   */
  tick() {
    const now = this.lobby.now();

    // 1. 清理散人队列中无效的 session
    for (const [pid, entry] of [...this.queue.entries()]) {
      if (!entry.session || !entry.session.connected || this.lobby.registry.byId(pid) !== entry.session) {
        this.queue.delete(pid);
      }
    }

    // 2. 清理房间队列中已销毁或对局已开的 room
    for (const [code, rEntry] of [...this.roomQueue.entries()]) {
      const room = rEntry.room;
      if (!room || room.disposed || room.match || room.private === true || room.code !== code) {
        this.roomQueue.delete(code);
        continue;
      }
      // 如果房间已经满了（4 人都齐了），自动退出排队
      if (room.freeSeat() < 0) {
        this.cancelRoomQueue(room);
      }
    }

    // 3. 优先匹配：将散人填入正在匹配的同盟房间
    for (const [code, rEntry] of [...this.roomQueue.entries()]) {
      const room = rEntry.room;
      const targetDiff = room.difficulty;
      const targetMode = room.mode;

      // 寻找相符难度的散人
      for (const [pid, entry] of [...this.queue.entries()]) {
        if (room.freeSeat() < 0) break;
      if (entry.mode === targetMode && entry.difficulty === targetDiff) {
          this.queue.delete(pid);
          // 加入房间（2026-11-26：这是匹配撮合进来的房间，打上持久标记，客户端据此显示「匹配完成」页）
          room.matchmade = true;
          for (const s of room.seats) if (s && !s.isBot) s.ready = false;   // 2026-11-26：进匹配页时全部重置为未准备
          this.lobby.join(entry.session, { code: room.code });
          sendSession(entry.session, {
            t: 'match.found',
            roomCode: room.code,
            mode: room.mode,
            difficulty: room.difficulty,
            humans: room.activeHumans().length,
          });
        }
      }

      const before = rEntry.humansAtStart || 1;
      const humansNow = room.activeHumans().length;
      const hostSession = this.lobby.registry.byId(room.hostId);

      // 补齐房间（业主 2026-11-15）：人数只要比开始时多，就**立刻开局** ——
      // 不用等满员，也不用等倒计时走完。
      if (rEntry.autoStart && humansNow > before) {
        this.cancelRoomQueue(room);
        this.tryStartRoom(room, hostSession);
        continue;
      }

      // 满员（原有的「开始搜寻」语义）：取消匹配，等房主自己点开始
      if (room.freeSeat() < 0) {
        this.cancelRoomQueue(room);
        continue;
      }

      // 超时（业主 2026-11-26 改口径）：**没准备完全时保留已准备的人、踢掉未准备的，房间继续排队补位**。
      // 以前是「有人加入就开，否则取消匹配并提示补齐失败」——现在只有「全体未准备」才走原来的失败分支。
      if (now >= rEntry.deadlineAt) {
        const joined = humansNow > before;
        if (joined && hostSession) {
          this.cancelRoomQueue(room);
          this.tryStartRoom(room, hostSession);
          continue;
        }
        const humans = typeof room.activeHumans === 'function' ? room.activeHumans() : [];
        const readySeats = humans.filter((s) => s && s.ready);
        const unreadySeats = humans.filter((s) => s && !s.ready);
        if (readySeats.length > 0 && unreadySeats.length > 0) {
          // 未准备的回大厅（附一句原因），已准备的留在房间里继续等补位
          for (const seat of unreadySeats) {
            const sess = this.lobby.registry.byId(seat.playerId);
            if (!sess) continue;
            sendSession(sess, {
              t: 'match.status', status: 'idle', reason: 'prep-timeout',
              filled: readySeats.length, needed: humans.length, at: this.lobby.now(),
            });
            this.lobby.leave(sess);
          }
          const now2 = this.lobby.now();
          rEntry.deadlineAt = now2 + this.waitFor(0);
          rEntry.humansAtStart = room.activeHumans().length;
          if (room.matching) {
            room.matching = {
              ...room.matching,
              startedAt: now2,
              deadlineAt: rEntry.deadlineAt,
              humansAtStart: rEntry.humansAtStart,
            };
          }
          this.lobby.broadcastState(room);
          continue;
        }
        this.cancelRoomQueue(room);
        this.notifyFillFailed(room, before);
      }
    }

    // 4. 散人撮合分桶: key = `${mode}:${difficulty}`
    // (a solo / full-room dispatch above may have emptied the roomQueue too — the tail check below still stops the timer)
    if (this.queue.size > 0) {
      const buckets = new Map();
      for (const [pid, entry] of this.queue.entries()) {
        const key = `${entry.mode}:${entry.difficulty}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(entry);
      }

      for (const [key, bucketEntries] of buckets.entries()) {
        // 4.1 单人（含无限单人）: 立即开房
        for (const soloEntry of bucketEntries.filter((e) => e.solo)) {
          this.queue.delete(soloEntry.session.playerId);
          this.formRoom([soloEntry], soloEntry.mode, soloEntry.difficulty, false);
        }
        const entries = bucketEntries.filter((e) => !e.solo);
        if (entries.length === 0) continue;

        // 4.2 满员发车 (4 人)
        while (entries.length >= this.opts.targetPlayers) {
          const matched = entries.splice(0, this.opts.targetPlayers);
          for (const m of matched) this.queue.delete(m.session.playerId);
          this.formRoom(matched, matched[0].mode, matched[0].difficulty, false);
        }

        if (entries.length === 0) continue;

        // 4.3 超时：多出人才开房并直接开局；仍然只有一个人就取消匹配（不补 AI）
        const oldest = entries.reduce((prev, curr) => (curr.joinedAt < prev.joinedAt ? curr : prev), entries[0]);
        const waitTime = now - oldest.joinedAt;

        if (waitTime >= this.opts.timeoutMs) {
          const matched = entries.splice(0, this.opts.targetPlayers);
          for (const m of matched) this.queue.delete(m.session.playerId);
          if (matched.length > 1) {
            // 业主 2026-11-15「常规匹配也要有准备页」：以前这里建完房**直接开局**，
            // 玩家看不到「匹配成功 / 确认入场」那一页。现在只建房，让他们进房间确认后由房主开局。
            this.formRoom(matched, matched[0].mode, matched[0].difficulty, false);
          } else if (matched.length === 1 && matched[0].session?.connected) {
            sendSession(matched[0].session, { t: 'match.status', status: 'idle', reason: 'timeout' });
          }
          continue;
        }
        // 4.4 广播散人排队进度
        for (const entry of entries) {
          this.sendStatus(entry, entries.length);
        }
      }
    }

    // both queues drained: nothing left to match — the 1 s interval only re-arms on the next enqueue
    if (this.queue.size === 0 && this.roomQueue.size === 0) this.stop();
  }

  /** 人数已超过开始搜寻时的人数：把加入的人标为准备并直接开局（不补 AI）。 */
  tryStartRoom(room, hostSession) {
    if (!room || room.match || !hostSession) return;
    try { for (const s of room.activeHumans()) { if (s.playerId !== room.hostId) s.ready = true; } } catch { /* ignore */ }
    const res = this.lobby.start(hostSession);
    if (res && res.error) this.lobby.log?.warn?.('[matchmaker] start refused', res.error, res.detail);
  }

  /**
   * 将散人玩家打包成房间发车
   * @param {Array<{ session: any }>} matched
   * @param {string} mode
   * @param {string} difficulty
   * @param {boolean} fillBotsWithAi
   */
  formRoom(matched, mode, difficulty, fillBotsWithAi) {
    if (!matched || matched.length === 0) return;

    const hostEntry = matched[0];
    const hostSession = hostEntry.session;

      const createRes = this.lobby.create(hostSession, { mode, difficulty });
    if (!createRes || createRes.error) {
      this.lobby.log.error('[matchmaker] failed to create room for match', createRes);
      return;
    }

    const room = this.lobby.roomOf(hostSession);
    if (!room) return;
    // 2026-11-26：散人撮合建出来的房，打上持久标记（客户端据此显示「匹配完成」页）
    room.matchmade = true;
    for (const s of room.seats) if (s && !s.isBot) s.ready = false;   // 2026-11-26：匹配成立 → 全部未准备

    for (let i = 1; i < matched.length; i++) {
      const guestSession = matched[i].session;
      this.lobby.join(guestSession, { code: room.code });
    }

    if (fillBotsWithAi && !isSoloRoomMode(room.mode)) {
      while (room.freeSeat() >= 0) {
        const botRes = this.lobby.addBot(hostSession);
        if (!botRes || botRes.error) break;
      }
    }

    for (const m of matched) {
      sendSession(m.session, {
        t: 'match.found',
        roomCode: room.code,
        mode: room.mode,
        difficulty: room.difficulty,
        humans: matched.length,
      });
    }

    this.lobby.broadcastState(room);
  }
}
