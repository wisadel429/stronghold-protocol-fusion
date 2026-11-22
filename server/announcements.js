import { open, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseAnnouncements, activeAnnouncement } from '../shared/announcements.js';

export const ANNOUNCEMENT_POLL_MS = 2000;
export const ANNOUNCEMENT_MAX_BYTES = 128 * 1024;
/** 历史公告最多留这么多条（业主 2026-11-22：玩家能在弹窗右侧翻回去看，后台能删） */
export const ANNOUNCEMENT_HISTORY_MAX = 40;
const quiet = { info() {}, warn() {}, error() {} };

/** 本地自然日的键（YYYY-MM-DD）：历史公告按「天」归并，同一天只留最新一版。 */
function dayKey(ms) {
  const d = new Date(Number(ms) || 0);
  if (Number.isNaN(d.getTime())) return '';
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 公告的内容指纹（业主 2026-11-21 起客户端靠它判断"公告更新了"）。
 * 与 /api/announcement 下发的 id 同一个算法 —— 历史条目也用它，玩家翻历史时点开的和当初看到的是同一条。
 * @param {{ title?: string, text?: string, endAt?: number } | null} notice
 */
export function announcementContentId(notice) {
  if (!notice || typeof notice.text !== 'string') return null;
  const content = { title: notice.title || '维护公告', text: notice.text, expiresAt: notice.endAt };
  return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 24);
}

/** Read-only config service: content polling also catches atomic replacements inside Docker bind mounts. */
export class Announcements {
  constructor({ file, historyFile = null, broadcast = () => {}, now = Date.now, log = quiet, pollMs = ANNOUNCEMENT_POLL_MS } = {}) {
    this.file = file;
    /**
     * 历史公告文件（业主 2026-11-22）：`data/announcement.json` 只存"当前一条"，被覆盖就没了 ——
     * 玩家要在弹窗右侧翻历史、后台要能删，就得由服务端自己累积并落盘。
     */
    this.historyFile = historyFile;
    /** @type {{ id: string, title?: string, text: string, level: string, startAt: number|null, endAt: number|null, at: number }[]} */
    this.history = [];
    /** 当前公告的内容指纹（与 /api/announcement 的 id 同一个算法） */
    this.currentId = null;
    this.historyLoaded = false;
    this.broadcast = broadcast;
    this.now = now;
    this.log = log;
    this.pollMs = pollMs;
    this.rows = [];
    this.current = null;
    this.key = 'null';
    this.raw = null;
    this.loaded = false;
    this.lastError = null;
    this.started = false;
    this.stopped = false;
    this.pollTimer = null;
    this.boundaryTimer = null;
    this.pending = null;
  }

  async start() {
    if (this.started || this.stopped) return;
    this.started = true;
    await this._loadHistory();
    await this.reload();
    if (!this.stopped && this.file) {
      this.pollTimer = setInterval(() => { this.reload(); }, this.pollMs);
      this.pollTimer.unref?.();
    }
    this.refresh();
  }

  // ---- 历史公告（业主 2026-11-22） ------------------------------------------------------

  /** 读出历史；坏文件当空表，不影响公告本身。 */
  async _loadHistory() {
    this.historyLoaded = true;
    if (!this.historyFile) return;
    try {
      const raw = await readFile(this.historyFile, 'utf8');
      const doc = JSON.parse(raw);
      const rows = Array.isArray(doc) ? doc : (doc && Array.isArray(doc.history) ? doc.history : []);
      this.history = rows
        .filter((r) => r && typeof r.id === 'string' && typeof r.text === 'string' && r.text)
        .map((r) => ({
          id: r.id,
          ...(typeof r.title === 'string' && r.title ? { title: r.title } : {}),
          text: r.text,
          level: ['info', 'warning', 'urgent'].includes(r.level) ? r.level : 'info',
          startAt: Number.isFinite(r.startAt) ? r.startAt : null,
          endAt: Number.isFinite(r.endAt) ? r.endAt : null,
          at: Number.isFinite(r.at) ? r.at : null,
        }))
        .slice(0, ANNOUNCEMENT_HISTORY_MAX);
    } catch (e) {
      if (e && e.code !== 'ENOENT') this.log.warn?.(`[announcements] 历史读取失败（按空处理）: ${e.code || e.message}`);
      this.history = [];
    }
  }

  async _saveHistory() {
    if (!this.historyFile) return;
    try {
      await mkdir(path.dirname(this.historyFile), { recursive: true });
      const tmp = `${this.historyFile}.tmp`;
      await writeFile(tmp, JSON.stringify({ version: 1, history: this.history }), 'utf8');
      await rename(tmp, this.historyFile);
    } catch (e) { this.log.warn?.('[announcements] 历史写盘失败', e); }
  }

  /** 上一条公告退休时记进历史（同 id 不重复记；**同一天只留最新一版**）。 */
  _remember(notice, id) {
    if (!notice || !id || !notice.text) return;
    if (this.history.some((h) => h && h.id === id)) return;
    // 业主 2026-11-22：公告改成「同一天在一条上追加」之后，同一天会连续换好几个 id，
    // 历史里就会堆出好几条同名公告 —— 按自然日归并，只保留当天最后一版。
    const key = dayKey(notice.startAt || this.now());
    if (key) this.history = this.history.filter((h) => !h || dayKey(h.startAt || h.at || 0) !== key);
    this.history.unshift({
      id,
      ...(typeof notice.title === 'string' && notice.title ? { title: notice.title } : {}),
      text: notice.text,
      level: ['info', 'warning', 'urgent'].includes(notice.level) ? notice.level : 'info',
      startAt: Number.isFinite(notice.startAt) ? notice.startAt : null,
      endAt: Number.isFinite(notice.endAt) ? notice.endAt : null,
      at: this.now(),
    });
    if (this.history.length > ANNOUNCEMENT_HISTORY_MAX) this.history.length = ANNOUNCEMENT_HISTORY_MAX;
    void this._saveHistory();
  }

  /** 玩家侧看的历史（新的在前）。 */
  historyList() { return this.history.map((h) => ({ ...h })); }

  /** 后台删除一条历史。@returns {boolean} 是否真的删掉了 */
  removeHistory(id) {
    const key = String(id || '');
    const i = this.history.findIndex((h) => h && h.id === key);
    if (i < 0) return false;
    this.history.splice(i, 1);
    void this._saveHistory();
    return true;
  }

  reload() {
    if (this.pending) return this.pending;
    if (this.stopped || !this.file) return Promise.resolve(false);
    this.pending = this._read().finally(() => { this.pending = null; });
    return this.pending;
  }

  async _read() {
    let handle;
    try {
      handle = await open(this.file, 'r');
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > ANNOUNCEMENT_MAX_BYTES) throw new Error('announcement file must be at most 128 KiB');
      const buffer = Buffer.alloc(ANNOUNCEMENT_MAX_BYTES + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const chunk = await handle.read(buffer, bytes, buffer.length - bytes, null);
        if (!chunk.bytesRead) break;
        bytes += chunk.bytesRead;
      }
      if (bytes > ANNOUNCEMENT_MAX_BYTES) throw new Error('announcement file must be at most 128 KiB');
      const raw = buffer.toString('utf8', 0, bytes).replace(/^\uFEFF/, '');
      if (this.stopped) return false;
      if (raw !== this.raw) {
        const rows = parseAnnouncements(JSON.parse(raw));
        this.rows = rows;
        this.raw = raw;
        this.loaded = true;
      }
      this.lastError = null;
      this.refresh();
      return true;
    } catch (err) {
      if (!this.stopped) {
        const message = err.code || err.message;
        if (message !== this.lastError && !(message === 'ENOENT' && !this.loaded)) {
          this.log.warn(`[announcements] config rejected (${message}); keeping last valid schedule`);
        }
        this.lastError = message;
      }
      return false;
    } finally { await handle?.close().catch(() => {}); }
  }

  refresh() {
    if (this.stopped) return;
    const now = this.now();
    const previous = this.current;
    const previousId = this.currentId;
    const current = activeAnnouncement(this.rows, now);
    const id = announcementContentId(current);
    this.current = current;
    this.currentId = id;
    // 换了一条公告（或公告被撤下）：把上一条记进历史，玩家才能在弹窗右侧翻回去看（业主 2026-11-22）
    if (id !== previousId && previous && previousId) this._remember(previous, previousId);
    const key = JSON.stringify(current);
    if (key !== this.key) {
      this.key = key;
      try { this.broadcast(this.message()); } catch (err) { this.log.error('[announcements] broadcast failed', err); }
    }
    clearTimeout(this.boundaryTimer);
    this.boundaryTimer = null;
    let next = Infinity;
    for (const row of this.rows) if (row.enabled) {
      if (row.startAt > now) next = Math.min(next, row.startAt);
      if (row.endAt > now) next = Math.min(next, row.endAt);
    }
    if (Number.isFinite(next)) {
      // Recheck absolute wall time as well as boundaries: clock changes do not leave a long stale timer.
      this.boundaryTimer = setTimeout(() => this.refresh(), Math.max(1, Math.min(30000, next - now)));
      this.boundaryTimer.unref?.();
    }
  }

  message() { return { t: 'site.announcement', serverNow: this.now(), announcement: this.current }; }
  stats() { return { configured: !!this.file, loaded: this.loaded, entries: this.rows.length, activeId: this.current?.id || null, history: this.history.length, configError: this.lastError }; }

  async stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearTimeout(this.boundaryTimer);
    this.pollTimer = this.boundaryTimer = null;
    await this.pending;
  }
}
