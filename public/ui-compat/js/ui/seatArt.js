// public/ui-compat/js/ui/seatArt.js — 宿主 seatArt.js + 分享包要的 seatPortrait(seat, portraits)。
//
// 主题房间把名片数据打包成 `{ pool, byChar, m, myId, myCard }` 交给 seatPortrait()，本仓宿主里正好有完整链路：
//   seatOperator(seat, {byChar,pool}, {myId,myCard})   → 该座位展示的干员（自己选的名片优先）
//   seatCardSkin(seat, charId, {myId,...})             → 该座位该穿哪套皮肤（自己的本地选择 / 别人公布的）
//   chessPortraitUrl(m, chess, {skin})                 → 立绘 URL（皮肤缺失会自动回退默认）
//   seatArtSrc([url])                                  → 取第一个可用 URL
// 上一版这里返回 null（空桩），房间座位只剩一块被拉高的底板 —— 业主 2026-11-14 报的「模拟准备页立绘有误」。
export * from '/js/ui/seatArt.js';
import { seatOperator, seatCardSkin, seatArtSrc } from '/js/ui/seatArt.js';
import { chessPortraitUrl } from '/js/ui/assetUrls.js';

/**
 * 座位卡上的立绘 URL（分享包 API）。
 * @param {{ playerId?: any, isBot?: boolean, card?: string }|null} seat
 * @param {{ pool?: any[], byChar?: Map<string, any>, m?: any, myId?: any, myCard?: string }|null} portraits
 * @returns {string|null} 解析不出来就 null（座位退回默认头像框，不报错）
 */
export function seatPortrait(seat, portraits) {
  if (!seat || seat.isBot || seat.playerId == null) return null;
  const p = portraits && typeof portraits === 'object' ? portraits : {};
  let op = null;
  try {
    op = seatOperator(seat, { byChar: p.byChar, pool: p.pool }, { myId: p.myId ?? null, myCard: p.myCard ?? '' });
  } catch { op = null; }
  const chess = op && op.chess ? op.chess : null;
  if (!chess) return null;
  const charId = chess.charId || null;
  let skin = null;
  try {
    skin = seatCardSkin(seat, charId, { myId: p.myId ?? null, localSkins: {}, players: [], otherSkins: true });
  } catch { skin = null; }
  let url = null;
  try { url = chessPortraitUrl(p.m, chess, { skin }); } catch { url = null; }
  return seatArtSrc([url]) || null;
}
