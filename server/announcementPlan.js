// 公告写入的「口径」都在这里：给定当前条目 + 这次要发的内容，算出写盘后的整份 doc。
// 抽成纯函数的原因：这段逻辑踩过一次真事故（2026-11-26 跨天时把上一条 927 字的更新说明整条换掉），
// 而它以前埋在 admin.js 的路由里，没法单测。纯函数不碰文件、不看时钟，`nowMs` 由调用方传入。
import { parseAnnouncements, activeAnnouncement } from '../shared/announcements.js';

/** 本地自然日的比较（与后台「每天一条」口径同一套算法）。 */
export function sameLocalDay(a, b) {
  const d1 = new Date(a);
  const d2 = new Date(b);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return false;
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

/** 新条目的 id：`admin-<日期>-<随机>`，与 parseAnnouncements 的 [A-Za-z0-9_-]{1,64} 兼容且不与已有条目重复。 */
export function makeAnnouncementId(rows, nowMs) {
  const d = new Date(nowMs);
  const p = (v) => String(v).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const taken = new Set((Array.isArray(rows) ? rows : []).map((r) => r && r.id));
  let id = '';
  do { id = `admin-${stamp}-${Math.random().toString(36).slice(2, 6)}`; } while (taken.has(id));
  return id;
}

/** 服务器时区 ISO（带 +08:00 之类的显式时区），与 parseAnnouncements 的校验一致。 */
export function announcementStartIso(ms) {
  return new Date(ms).toISOString().replace('Z', '+00:00');
}

/**
 * 追加 / 覆盖 / 撤下 的计算（业主 2026-11-26 的「每天一条」口径）。
 *
 * - 同一天：在**当天那条**上追加（mode='append'）或整段覆盖（mode='replace'），沿用它的 id；
 * - 换天了：当天**新起一条**，把当前正在显示的那条**停用**（不动正文、不删除）；
 * - 空正文（撤下）：只停用正在生效的条目，正文一律保留 —— 以前是整表清空，撤下就再也找不回。
 *
 * @param {{
 *   rows?: any[], text?: string, title?: string, level?: string, hours?: number,
 *   permanent?: boolean, mode?: string, nowMs?: number, newId?: (rows: any[], nowMs: number) => string,
 * }} input
 * @returns {{ doc: { announcements: any[] }, row: any, appended: boolean, sameDay: boolean, chars: number, note: string }}
 */
export function planAnnouncementWrite({
  rows = [], text = '', title = '', level = 'info', hours = 720,
  permanent = false, mode = 'append', nowMs = Date.now(), newId = makeAnnouncementId,
} = {}) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object' && typeof r.id === 'string') : [];
  const body = typeof text === 'string' ? text.trim() : '';
  const heading = typeof text === 'string' ? title.trim() : '';
  const levelName = ['info', 'warning', 'urgent'].includes(level) ? level : 'info';
  const hoursNum = Number(hours);
  const forever = permanent === true || hoursNum === 0;
  const hoursClamped = forever ? 720 : (Number.isFinite(hoursNum) ? Math.max(1, Math.min(720, hoursNum)) : 720);
  const sameId = mode === 'replace' ? 'replace' : 'append';

  const todayRow = list
    .filter((r) => typeof r.startAt === 'string' && sameLocalDay(r.startAt, nowMs))
    .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))[0] || null;
  const sameDay = !!todayRow;

  let finalText = body;
  let appended = false;
  if (body && todayRow && sameId === 'append') {
    if (todayRow.text.indexOf(body) >= 0) {
      finalText = todayRow.text;               // 已经加过同样的内容：不重复追加
    } else {
      finalText = String(todayRow.text || '').replace(/[\s\u3000]+$/, '') + '\n' + body;
      appended = true;
    }
  }
  const carryTitle = sameDay && todayRow && appended ? (todayRow.title || '') : '';
  const finalTitle = body ? (heading || carryTitle) : '';
  const carryLevel = sameDay && todayRow && appended ? (todayRow.level || levelName) : levelName;
  const finalLevel = body ? (carryLevel || levelName) : levelName;
  // 追加时保留当天的 startAt（同一天一条公告），只把截止时间顺延到「现在 + 时长」
  const startAtMs = sameDay && todayRow && appended ? Date.parse(todayRow.startAt) : nowMs - 60_000;
  // 追加会保留当天的 startAt，再顺延 720 小时可能超过 30 天上限 → 截到 2592000 秒（parseAnnouncements 的上限）
  const durationSeconds = forever ? 0
    : Math.min(2592000, Math.max(60, Math.round((nowMs + hoursClamped * 3600_000 - startAtMs) / 1000)));
  const row = {
    // 同一天沿用当天那条的 id；换天用新 id，避免与上一条混淆（后台按 id 删 / 启停）
    id: sameDay && todayRow.id ? todayRow.id : newId(list, nowMs),
    ...(finalTitle ? { title: finalTitle } : {}),
    text: finalText,
    startAt: announcementStartIso(startAtMs),
    durationSeconds,
    level: finalLevel,
    enabled: true,
  };

  let nextRows;
  if (!body) {
    // 撤下：只停用正在生效的条目，正文保留（后台可再启用）
    nextRows = list.map((r) => (r.enabled ? { ...r, enabled: false } : r));
  } else if (sameDay) {
    nextRows = list.map((r) => (r.id === todayRow.id ? row : r));
  } else {
    // 换天了：把当前正在显示的那条退役（只停用、正文保留），当天新起一条放最前
    // —— 后台「弹窗公告」表单载入的是 announcements[0]，放最后会让表单显示上一条旧公告
    let liveId = '';
    try {
      const live = activeAnnouncement(parseAnnouncements({ announcements: list }), nowMs);
      liveId = live && live.id ? live.id : '';
    } catch { /* 旧文件本身不合法就判断不出 —— 宁可不动其它条目 */ }
    nextRows = list.map((r) => (r.id === liveId ? { ...r, enabled: false } : r));
    nextRows.unshift(row);
    if (nextRows.length > 100) nextRows = nextRows.slice(0, 100);
  }
  const doc = { announcements: nextRows };
  const chars = [...finalText].length;
  const flag = forever ? '，永久有效' : '';
  const note = !body ? '已撤下公告（正文保留，可在列表里再启用）'
    : appended ? `已追加到今天的公告（现在共 ${chars} 字${flag}，约 2 秒内对全服生效）`
      : sameDay ? `已覆盖今天的公告（共 ${chars} 字${flag}，约 2 秒内生效）`
        : `今天还没有公告，已新起一条（共 ${chars} 字${flag}；上一条只停用、没删，历史里也在）`;
  return { doc, row, appended, sameDay, chars, note };
}
