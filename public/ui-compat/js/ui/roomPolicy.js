// public/ui-compat/js/ui/roomPolicy.js — 分享包「房间倒转策略」文案。
/**
 * @param {{ allowReverse?: boolean, reverse?: boolean }|null} room
 * @returns {string}
 */
export function reversePolicyLabel(room) {
  return room && (room.allowReverse === true || room.reverse === true) ? '允许倒转' : '禁止倒转';
}
