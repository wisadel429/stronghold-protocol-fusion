// public/ui-compat/shared/unifiedRegion-20261024.js — 分享包「统一区服房间号」的降级桩。
/**
 * 本仓房间号全局唯一（服务端以 code 作键），邀请链接也按纯 code 解析；
 * 加节点前缀会让邀请链接失效，所以原样返回。
 * @param {string|null} node
 * @param {string} code
 * @returns {string}
 */
export function publicRoomCode(node, code) {
  const c = code == null ? '' : String(code);
  void node;
  return c;
}
