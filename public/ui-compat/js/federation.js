// public/ui-compat/js/federation.js — 宿主 federation.js + 分享包要的 roomCounts / regionMatching。
export * from '/js/federation.js';
import { enabled, rooms } from '/js/federation.js';

/** 是否处在「跨区匹配」状态：本仓没有跨区排队，恒 false（主题据此隐藏跨区匹配 UI）。 */
export function regionMatching() { return false; }

/**
 * 房间目录（主题把它当「统一匹配队列 + 节点房间数」用）。
 * 本仓 federation 的 rooms() 就是房间目录；拿不到就给空，绝不抛错。
 * @returns {Promise<{ unifiedQueue: null, rooms: any, nodes: any }>}
 */
export async function roomCounts() {
  try {
    const list = typeof rooms === 'function' ? await rooms() : rooms;
    return { unifiedQueue: null, rooms: list || null, nodes: null, enabled: !!enabled };
  } catch {
    return { unifiedQueue: null, rooms: null, nodes: null, enabled: false };
  }
}
