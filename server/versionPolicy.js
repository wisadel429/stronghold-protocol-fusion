// server/versionPolicy.js — 业主口径（2026-11-17）：「封禁除第二期下半以外的所有版本，切换时提示暂未开放」。
//
// 为什么要单独一层策略：shared/versions.js 是**注册表**（服务器认识哪些官方版本），
// server/http/config.js 的 versionsFrom 决定**加载并开放**哪些。本文件决定**显示但不上架**哪些：
// 被 locked 的版本不加载数据、不能开局、不能投票切换，但会出现在版本选择器里（灰掉 + 「暂未开放」），
// 这样玩家知道「有这个版本、现在不开」，而不是干脆看不见。
//
// 策略文件：`<dataDir>/versions-policy.json`（默认 data/versions-policy.json，不进分发包）：
//   {
//     "disabled": ["act3autochess", "act2autochess@V2_1", "act1autochess", "act1autochess@V1_1"],
//     "hint": "暂未开放"
//   }
// * 没有这个文件 = 没有封禁（与旧行为逐字节一致）；
// * `disabled` 里的 id 必须在注册表里，未知的会被忽略并 warning；
// * `hint` 是选择器上显示的原因，默认「暂未开放」；
// * 第二期下半（DEFAULT_VERSION）**封不掉**：真写了也会被忽略并 warning（它是服务器的 vanilla 内容）。

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_VERSION, VERSIONS } from '../shared/versions.js';

const REGISTRY_IDS = VERSIONS.map((v) => v.id);
export const DEFAULT_LOCK_HINT = '暂未开放';

/**
 * 读 `<dataDir>/versions-policy.json`。任何读取/解析问题都退回「没有封禁」，绝不让服务器起不来。
 * @param {string} dataDir
 * @param {{ log?: { warn?: Function } }} [o]
 * @returns {{ disabled: string[], hint: string, file: string | null }}
 */
export function readVersionPolicy(dataDir, { log = null } = {}) {
  const file = path.join(dataDir, 'versions-policy.json');
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e && e.code !== 'ENOENT') log?.warn?.(`[versions] 策略文件读取失败（忽略）：${file} ${e.message}`);
    return { disabled: [], hint: DEFAULT_LOCK_HINT, file: null };
  }
  const list = Array.isArray(raw?.disabled) ? raw.disabled : [];
  const disabled = [];
  for (const id of list) {
    if (typeof id !== 'string') continue;
    if (id === DEFAULT_VERSION) { log?.warn?.(`[versions] 策略不能封禁 ${DEFAULT_VERSION}（服务器默认版本），已忽略`); continue; }
    if (!REGISTRY_IDS.includes(id)) { log?.warn?.(`[versions] 策略里有未知版本 "${id}"，已忽略`); continue; }
    if (!disabled.includes(id)) disabled.push(id);
  }
  const hint = typeof raw?.hint === 'string' && raw.hint.trim() ? raw.hint.trim().slice(0, 40) : DEFAULT_LOCK_HINT;
  return { disabled, hint, file };
}

/**
 * 把策略套到 versionsFrom 的结果上：从 enabled 里摘掉 locked，算出按注册表顺序的 locked 列表，
 * 默认版本失效时回退到第一个仍启用的版本（与 versionsFrom 同口径）。
 * @param {{ enabled: string[], default: string, maxHosts: number }} cfg
 * @param {{ disabled: string[], hint: string }} policy
 * @returns {{ enabled: string[], default: string, maxHosts: number, blocked: string[], hint: string }}
 */
export function applyVersionPolicy(cfg, policy) {
  const off = new Set(policy.disabled);
  const enabled = cfg.enabled.filter((id) => !off.has(id));
  if (!enabled.length) enabled.push(DEFAULT_VERSION);
  const blocked = REGISTRY_IDS.filter((id) => off.has(id));
  const def = enabled.includes(cfg.default) ? cfg.default : enabled[0];
  return { enabled, default: def, maxHosts: cfg.maxHosts, blocked, hint: policy.hint };
}
