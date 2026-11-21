// public/js/ui/inviteParse.js — 粘贴邀请文本 → 房间码（业主 2026-11-21）
//
// 业主口径：「给客户端做一个邀请粘贴的适配，只取带有网址的部分并进入该房间」。
//
// 玩家从群里复制来的通常长这样（可能带前后中文、多行、甚至表情）：
//   https://mon3tr.fun/?room=9680 Mon3tr邀请你加入卫戍协议：盟约【绝境模拟】
//   mon3tr.fun/?room=9680
//   http://8.134.50.56:3000/ui-theme-closure.html?room=9680&node=xxx
//
// 规则：只在**网址片段**里找 `room=`；找不到 `room=` 时，才退回「整段只有一个 4 位码」的宽松判断
// （直接粘贴密钥的老习惯仍然可用）。纯函数，方便单测。

import { ROOM_CODE_LEN } from '../../../shared/constants.js';

const CODE_LEN = ROOM_CODE_LEN;
const BARE_CODE_RE = new RegExp(`^[A-Za-z0-9]{${CODE_LEN}}$`);
const URL_IN_TEXT_RE = /(?:https?:\/\/)?(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?::\d{2,5})?(?:\/[^\s]*)?|\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{2,5})?(?:\/[^\s]*)?/gi;

/**
 * 从任意文本里取出房间码。
 * @param {string} text 粘贴进来的整段文本
 * @returns {string|null} 4 位（或协议允许的 +0~2 位）房间码；取不到返回 null
 */
export function roomCodeFromText(text) {
  const s = String(text == null ? '' : text);
  if (!s.trim()) return null;

  // 1) 先把文本里的网址片段挑出来，只在网址里找 room=
  for (const chunk of s.match(URL_IN_TEXT_RE) || [s]) {
    const m = chunk.match(/[?&#]room=([A-Za-z0-9]+)/i);
    if (m) {
      const code = m[1].toUpperCase();
      // 协议允许比房间码长 0~2 位（parseRoomParam 的口径）；更长说明不是房间码
      if (code.length >= CODE_LEN && code.length <= CODE_LEN + 2) return code;
    }
  }
  // 2) 整段里任意位置的 ?room=（应对网址被换行/空格切断的情况，例如 "? room=K3K3"）
  const loose = s.match(/[?&#]\s*room\s*=\s*([A-Za-z0-9]+)/i);
  if (loose) {
    const code = loose[1].toUpperCase();
    if (code.length >= CODE_LEN && code.length <= CODE_LEN + 2) return code;
  }
  // 3) 没有 room= 参数：整段就是一个 4 位码（老的粘贴密钥习惯）
  const trimmed = s.trim();
  if (BARE_CODE_RE.test(trimmed)) return trimmed.toUpperCase();
  // 4) 只贴了网址、没有房间码：不猜
  return null;
}

/**
 * 这段文本看起来是不是"邀请链接"（而不是玩家在输密钥）。
 * @param {string} text
 */
export function looksLikeInviteLink(text) {
  const s = String(text == null ? '' : text);
  return /[?&#]room=/i.test(s) || /(?:https?:\/\/|www\.|\b\d{1,3}(?:\.\d{1,3}){3})/i.test(s);
}
