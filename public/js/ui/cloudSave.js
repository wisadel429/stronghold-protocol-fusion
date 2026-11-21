// public/js/ui/cloudSave.js — 云存档同步（账号系统第一期）。
//
// 口径（业主 2026-11-14 定的）：
//   · 云端同步：战绩与统计、干员调配、皮肤/名片、成就、设置；头像与头像框走账号资料（不在这里）。
//   · 首次登录**自动合并**：把浏览器里的本地存档 merge 进账号（服务端规则：数字取大、数组并集、其余以新值优先），
//     再把合并结果写回本地 —— 老玩家的战绩不会白丢，新账号也不会被旧数据清空。
//   · 之后：本地每次变动节流 3 秒 PUT 一次；页面隐藏/关闭前尽量 flush 一次。
//
// 本地存档的键（public/js/store.js 的 `sp.pref.<key>`）：
//   stats（战绩/成就都在里面）· loadout · skins · room.card + card（名片）· settings
import { SKINS_PREF } from './skins.js';
import { LOADOUT_PREF } from './loadoutModel.js';
import { CARD_PREF, CARD_KEY } from './seatArt.js';
import { STATS_PREF_KEY } from './stats.js';

const PREF = 'sp.pref.';
const FLUSH_MS = 3000;
const SETTINGS_PREF = 'settings';

/** 云端字段 → 本地键（一个云端字段可以对应多个本地键）。 */
const FIELD_KEYS = {
  stats: [STATS_PREF_KEY],
  loadout: [LOADOUT_PREF],
  skins: [SKINS_PREF],
  namecards: [CARD_PREF, CARD_KEY],
  achievements: [STATS_PREF_KEY],     // 成就记录在 stats 里，先随统计一起同步
  settings: [SETTINGS_PREF],
};

const readRaw = (key) => {
  try {
    const v = globalThis.localStorage?.getItem(PREF + key);
    return v == null ? undefined : JSON.parse(v);
  } catch { return undefined; }
};
const writeRaw = (key, value) => {
  try {
    if (value === undefined) globalThis.localStorage?.removeItem(PREF + key);
    else globalThis.localStorage?.setItem(PREF + key, JSON.stringify(value));
  } catch { /* 隐私模式/配额：静默，下一次还会再试 */ }
};

/** 把本地存档拍成云端结构。 */
export function localSnapshot() {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [field, keys] of Object.entries(FIELD_KEYS)) {
    if (keys.length === 1) {
      const v = readRaw(keys[0]);
      if (v !== undefined) out[field] = v;
    } else {
      /** @type {Record<string, any>} */
      const bag = {};
      for (const k of keys) { const v = readRaw(k); if (v !== undefined) bag[k] = v; }
      if (Object.keys(bag).length) out[field] = bag;
    }
  }
  return out;
}

/** 把云端结构写回本地（合并后的结果）。 */
export function applySnapshot(save) {
  if (!save || typeof save !== 'object') return;
  for (const [field, keys] of Object.entries(FIELD_KEYS)) {
    const v = save[field];
    if (v === undefined) continue;
    if (keys.length === 1) writeRaw(keys[0], v);
    else if (v && typeof v === 'object') for (const k of keys) if (v[k] !== undefined) writeRaw(k, v[k]);
  }
}

const same = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };

/**
 * 登录后调用：拉取 → 首次合并 → 挂钩同步。
 * @param {{ api: any, onError?: (e: any) => void, log?: any }} opts
 * @returns {{ flush: () => Promise<void>, dispose: () => void }}
 */
export function installCloudSave({ api, onError = () => {}, log = console }) {
  let timer = null;
  let last = null;
  let disposed = false;
  let syncing = null;

  const flush = async () => {
    if (disposed) return;
    if (timer) { clearTimeout(timer); timer = null; }
    const snap = localSnapshot();
    if (last && same(snap, last)) return;
    if (syncing) { try { await syncing; } catch { /* 上一轮失败，重新发 */ } }
    syncing = (async () => {
      try { await api.putSave(snap); last = snap; } catch (e) { try { onError(e); } catch { /* ignore */ } }
      finally { syncing = null; }
    })();
    try { await syncing; } catch { /* onError 里已处理 */ }
  };

  const schedule = () => {
    if (disposed || timer) return;
    timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, FLUSH_MS);
  };

  // 首次：拿云端存档；没有就合并本地（= 迁移），有就把两边合并（取大/并集）后写回本地
  (async () => {
    try {
      const res = await api.getSave();
      const local = localSnapshot();
      let merged = null;
      if (!res.save) {
        const r = await api.mergeSave(local);
        merged = r.save?.fields || r.save || null;
      } else {
        const r = await api.mergeSave(local);
        merged = r.save?.fields || r.save || null;
      }
      if (merged) { applySnapshot(merged); last = localSnapshot(); }
      else last = localSnapshot();
    } catch (e) {
      try { onError(e); } catch { /* ignore */ }
      last = localSnapshot();
    }
    if (!disposed) {
      // 本地变动：storage 事件（跨标签）+ 定时比对（同标签内的 savePref 没有事件）
      globalThis.addEventListener?.('storage', (ev) => { if (ev && typeof ev.key === 'string' && ev.key.startsWith(PREF)) schedule(); });
      setInterval(() => { if (!disposed) schedule(); }, 5000).unref?.();
      globalThis.addEventListener?.('pagehide', () => { void flush(); });
      log.debug?.('[cloudSave] 已启用');
    }
  })();

  return {
    flush,
    dispose: () => { disposed = true; if (timer) { clearTimeout(timer); timer = null; } },
  };
}
