// 「全能的」可露希尔 theme — Closure's lines (audio/theme/ac_s_closur/CN_0xx.wav), played on the game's voice channel
// (js/audio.js: the 语音 volume, mute, one line on air at a time). Replaces the theme pack's first acClosureVoice.js, which
// guessed the lines by their length and played them on clicks (a buy line on the first tap, before anything was bought).
// Here the theme's own components call `closureVo(event)` when the thing has happened:
//   buy       调度干员  (CN_012 / 013) — an operator bought (its slot turned sold), not every time (BUY_CHANCE) — acClosureShop.js
//   upgrade   升级中心  (CN_014 / 017) — the 调度中心 level went up — acClosureShop.js
//   freeze    冻结      (CN_021)       — the shop frozen — acClosureShop.js
//   promo     晋升机会  (CN_010 / 011) — the shop shows the copy that completes a triple — acClosureShop.js
//   countdown 倒计时    (CN_018)       — 10 s left in 休整期 — acClosureTv.js
//   perfect / imperfect (CN_004–007)  — the actual round result — acClosureRound.js
//   bossRound 领袖回合  (CN_008)       — final-assault introduction — acClosureBoss.js
// Which file says what: the theme's 卫戍语音 page (footage 2026-11-10 06-34-06, README「参考视频 2026-11-10」); when they
// play: the user (2026-11-10). The rest of the table (模拟开始, 隐秘回合, 晋升成功, 盟约叠加) is not
// wired yet. Lives in work/common (shopBar.js → acClosureShop.js imports it under every theme); silent unless the
// Closure theme is on. Keeps the old module's exports (acThemeAudio.js imports them): an unknown event plays nothing.

import { audio } from '/js/audio.js';
import { AC_THEME, acThemeId } from '/js/ui/acTheme.js';

const DIR = new URL('/ui-art/audio/theme/ac_s_closur/', location.origin).href;

/** event → its lines (one drawn at random) */
export const CLOSURE_VO_MAP = Object.freeze({
  start: ['CN_001', 'CN_002', 'CN_003'],
  perfect: ['CN_004', 'CN_005'],
  imperfect: ['CN_006', 'CN_007'],
  bossRound: ['CN_008'],
  hiddenRound: ['CN_009'],
  promo: ['CN_010', 'CN_011'],
  buy: ['CN_012', 'CN_013'],
  upgrade: ['CN_014', 'CN_017'],
  countdown: ['CN_018'],
  elite: ['CN_019'],
  bond: ['CN_020'],
  freeze: ['CN_021'],
});

/** Share of operator purchases that get a 调度干员 line (the user: "不是每次购买都有"). */
export const BUY_CHANCE = 0.4;
/** Events that cut in on a line already on air; the others wait their turn (nothing plays). */
const PREEMPT = new Set(['countdown', 'start', 'perfect', 'imperfect', 'bossRound']);

let last = '';

/**
 * Play one line of `event` if the theme is on and the voice channel can take it.
 * @param {string} event a CLOSURE_VO_MAP key
 * @returns {boolean} whether a line started
 */
export function closureVo(event) {
  const ids = CLOSURE_VO_MAP[event];
  if (!ids || acThemeId() !== AC_THEME.CLOSURE) return false;
  const a = audio;
  try {
    if (!a.ctx || !a.voiceGain || a.volumes.muted || a.volumes.voice <= 0) return false;
    if (a.voiceNode && !PREEMPT.has(event)) return false;
    // two lines of a pair: not the same one twice running
    const pool = ids.length > 1 ? ids.filter((id) => id !== last) : ids;
    const id = pool[Math.floor(Math.random() * pool.length)];
    last = id;
    a._stopVoice();
    a.voiceGate.start('select', null, typeof performance !== 'undefined' ? performance.now() : Date.now());
    a._playVoice(`${DIR}${id}.wav`, ++a.voiceToken, 1);
    return true;
  } catch (err) {
    console.warn('[closure-vo]', event, err?.message || err);
    return false;
  }
}

/** The old module's name (acThemeAudio.js). */
export const playClosureVo = closureVo;
