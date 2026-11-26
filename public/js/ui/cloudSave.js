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

/**
 * 这份**本地**存档属于哪个账号（业主 2026-11-24：切号后成就统计读的还是本地的）。
 * 不参与云端同步（不在 FIELD_KEYS 里），只用来判断「本地数据是不是上一个账号的」。
 */
const SAVE_OWNER_KEY = 'sp.saveOwner';
const SWITCH_MARK = 'sp.saveSwitched';
const readOwner = () => { try { return globalThis.localStorage?.getItem(SAVE_OWNER_KEY) || null; } catch { return null; } };
const writeOwner = (id) => {
  if (!id) return;
  try { globalThis.localStorage?.setItem(SAVE_OWNER_KEY, String(id)); } catch { /* ignore */ }
};
/** 清空全部受云同步管理的本地字段（换号时用：上一个账号的数据不能留在本机）。 */
const clearLocalFields = () => {
  for (const keys of Object.values(FIELD_KEYS)) for (const k of keys) writeRaw(k, undefined);
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
 * @param {{ api: any, onError?: (e: any) => void, log?: any, accountId?: string|null, onAccountSwitched?: () => void }} opts
 *   `accountId`：当前登录账号。带上它才能判断本地存档是不是**上一个账号**的（换号时以云端为准、不合并本地）；
 *   `onAccountSwitched`：检测到「换号并已换成云端数据」时调一次（通常让页面刷新，把内存里的旧统计/调配换掉）。
 * @returns {{ flush: () => Promise<void>, dispose: () => void }}
 */
export function installCloudSave({ api, onError = () => {}, log = console, accountId = null, onAccountSwitched = null }) {
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

  // 首次：看本地存档属于哪个账号 ——
  //   · 没有归属 / 就是这个账号：拿云端 + 合并本地（老玩家首次登录把本地战绩迁上去，之后取大/并集）；
  //   · 归属是**别的**账号（业主 2026-11-24「登录其他账号时成就统计读的还是本地的」）：
  //     本地那份是上一个账号的，**绝不合并**——清空本地受管字段，直接以该账号的云端存档为准。
  (async () => {
    const owner = readOwner();
    const foreign = !!(accountId && owner && owner !== accountId);
    try {
      if (foreign) {
        clearLocalFields();
        const res = await api.getSave();
        const cloud = res && res.save ? (res.save.fields || res.save) : null;
        if (cloud) applySnapshot(cloud);
        last = localSnapshot();
        writeOwner(accountId);
        log.debug?.('[cloudSave] 换号：已改用该账号的云端存档');
        if (typeof onAccountSwitched === 'function') {
          let marked = null;
          try { marked = globalThis.sessionStorage?.getItem(SWITCH_MARK) || null; } catch { /* ignore */ }
          if (marked !== String(accountId)) {
            try { globalThis.sessionStorage?.setItem(SWITCH_MARK, String(accountId)); } catch { /* ignore */ }
            try { onAccountSwitched(); } catch { /* ignore */ }
          }
        }
      } else {
        const res = await api.getSave();
        const local = localSnapshot();
        const r = await api.mergeSave(local);
        const merged = r.save?.fields || r.save || null;
        if (merged) { applySnapshot(merged); last = localSnapshot(); }
        else last = localSnapshot();
        writeOwner(accountId);
      }
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
